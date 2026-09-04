# Comprobación de extremo a extremo del manifiesto y de la idempotencia.
#
# Qué verifica y por qué importa. El manifiesto es lo que permite que exista una
# sola app móvil para todos los proyectos generados, y la idempotencia es lo que
# impide que reenviar una orden dictada sin cobertura cree tres registros. Las
# dos cosas se pueden probar en TypeScript hasta cierto punto —y se prueban, en
# `generator/src/asistente/manifiesto.test.ts`—, pero ninguna prueba de
# TypeScript demuestra que el filtro de Java reserve de verdad una fila y que el
# reenvío devuelva la respuesta guardada. Eso hay que ejercitarlo contra el
# servidor levantado y contra PostgreSQL de verdad.
#
# Uso:
#     powershell -ExecutionPolicy Bypass -File generator\scripts\probar-asistente.ps1
#
# La contraseña se pide con `Read-Host -AsSecureString`: no se escribe en
# pantalla, no queda en el historial de la consola y no aparece en el registro.
# No se guarda en ningún fichero. Si el proyecto se despliega en la nube, esa
# contraseña debe ser distinta de la de desarrollo.

$ErrorActionPreference = 'Stop'

# La consola de Windows viene en una página de códigos heredada, y tanto npm como
# el propio script escriben acentos. Sin esto, «Tienda» sale como «┬½Tienda┬╗» y
# el informe se lee peor de lo que es.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Raiz     = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Proyecto = Join-Path $Raiz 'generator\salida\tienda'
$Base     = 'http://localhost:8080'
$Mvn      = 'C:\Program Files\NetBeans-25\netbeans\java\maven\bin\mvn.cmd'
$Jdk      = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot'
$Registro = Join-Path $Proyecto 'target\arranque.log'

$fallos = 0

function Comprobar {
    param([string]$Que, [bool]$Bien, [string]$Detalle = '')
    if ($Bien) {
        Write-Host ("  OK    " + $Que) -ForegroundColor Green
    } else {
        Write-Host ("  FALLA " + $Que) -ForegroundColor Red
        if ($Detalle) { Write-Host ("        " + $Detalle) -ForegroundColor DarkGray }
        $script:fallos++
    }
}

# Invoke-WebRequest lanza ante cualquier código que no sea 2xx, incluido el 304
# que aquí es justamente el resultado esperado. Esta envoltura devuelve el
# código y el cuerpo en los dos caminos para poder afirmar sobre ellos.
function Peticion {
    param(
        [string]$Metodo,
        [string]$Ruta,
        [string]$Cuerpo = $null,
        [hashtable]$Cabeceras = $null
    )
    $parametros = @{
        Uri             = "$Base$Ruta"
        Method          = $Metodo
        UseBasicParsing = $true
        TimeoutSec      = 30
    }
    if ($Cabeceras) { $parametros.Headers = $Cabeceras }
    if ($Cuerpo) {
        $parametros.ContentType = 'application/json; charset=utf-8'
        $parametros.Body = [System.Text.Encoding]::UTF8.GetBytes($Cuerpo)
    }
    try {
        $r = Invoke-WebRequest @parametros
        return [pscustomobject]@{ Estado = [int]$r.StatusCode; Cuerpo = $r.Content; Cabeceras = $r.Headers }
    } catch {
        $respuesta = $_.Exception.Response
        if ($null -eq $respuesta) { throw }
        $texto = ''
        try {
            $lector = New-Object System.IO.StreamReader($respuesta.GetResponseStream())
            $texto = $lector.ReadToEnd()
        } catch { }
        $mapa = @{}
        foreach ($nombre in $respuesta.Headers.AllKeys) { $mapa[$nombre] = $respuesta.Headers[$nombre] }
        return [pscustomobject]@{ Estado = [int]$respuesta.StatusCode; Cuerpo = $texto; Cabeceras = $mapa }
    }
}

function Cabecera {
    param($Respuesta, [string]$Nombre)
    $valor = $Respuesta.Cabeceras[$Nombre]
    if ($valor -is [array]) { return $valor[0] }
    return $valor
}

# ---------------------------------------------------------------------------
Write-Host "`n== 1. Parar la instancia anterior ==" -ForegroundColor Cyan

# El JVM en marcha mantiene abierto el jar y `mvn package` no puede renombrarlo.
Get-Process java -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($Jdk) } |
    ForEach-Object {
        Write-Host "  parando java (pid $($_.Id))"
        Stop-Process -Id $_.Id -Force
    }
Start-Sleep -Seconds 2

# ---------------------------------------------------------------------------
Write-Host "`n== 2. Regenerar y empaquetar ==" -ForegroundColor Cyan

Push-Location $Raiz
npm run demo -w @app/generator -- --corpus tienda --out ./salida/tienda | Select-String 'Generados'
Pop-Location

$env:JAVA_HOME = $Jdk
Push-Location $Proyecto
& $Mvn -q -o -DskipTests package
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'El empaquetado falló' }
Pop-Location
Write-Host '  jar construido' -ForegroundColor Green

# ---------------------------------------------------------------------------
Write-Host "`n== 3. Arrancar ==" -ForegroundColor Cyan

$secreta = Read-Host 'Contraseña de PostgreSQL (no se muestra)' -AsSecureString
$puntero = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secreta)
try {
    $env:DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($puntero)
} finally {
    # Se libera la memoria nativa en cuanto deja de hacer falta; el valor sigue
    # en la variable de entorno de este proceso, que muere con el script.
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($puntero)
}

$jar = Join-Path $Proyecto 'target\tienda-0.0.1-SNAPSHOT.jar'
$java = Join-Path $Jdk 'bin\java.exe'

# El argumento va entrecomillado a mano. `Start-Process` une la lista con espacios
# y no entrecomilla nada, así que una ruta con un espacio —«1er parcial»— llega
# partida en dos argumentos y java responde «Unable to access jarfile ...\1er».
$proceso = Start-Process -FilePath $java -ArgumentList @('-jar', "`"$jar`"") `
    -WorkingDirectory $Proyecto -PassThru -NoNewWindow `
    -RedirectStandardOutput $Registro -RedirectStandardError "$Registro.err"

$listo = $false
foreach ($intento in 1..40) {
    Start-Sleep -Seconds 2
    if ($proceso.HasExited) { break }
    try {
        Invoke-WebRequest -Uri "$Base/asistente/manifiesto" -UseBasicParsing -TimeoutSec 3 | Out-Null
        $listo = $true
        break
    } catch { }
}

if (-not $listo) {
    Write-Host '  no arrancó; últimas líneas del registro:' -ForegroundColor Red
    Get-Content $Registro -Tail 40 -ErrorAction SilentlyContinue
    Get-Content "$Registro.err" -Tail 20 -ErrorAction SilentlyContinue
    exit 1
}
Write-Host '  en pie' -ForegroundColor Green

try {
    # -----------------------------------------------------------------------
    Write-Host "`n== 4. Manifiesto ==" -ForegroundColor Cyan

    $m = Peticion GET '/asistente/manifiesto'
    Comprobar 'responde 200' ($m.Estado -eq 200) "estado $($m.Estado)"

    $doc = $m.Cuerpo | ConvertFrom-Json
    Comprobar 'declara la versión 1'            ($doc.version -eq 1)
    Comprobar 'trae las cinco entidades'        ($doc.entidades.Count -eq 5) "$($doc.entidades.Count)"
    Comprobar 'anuncia Idempotency-Key'         ($doc.cabeceraIdempotencia -eq 'Idempotency-Key')

    $pedido = $doc.entidades | Where-Object { $_.nombre -eq 'Pedido' }
    Comprobar 'Pedido avisa del borrado en cascada de LineaPedido' `
        ($pedido.borradoEnCascada -contains 'LineaPedido')
    $estado = $pedido.campos | Where-Object { $_.nombre -eq 'estado' }
    Comprobar 'el enumerado llega con sus valores' ($estado.valores.Count -eq 5)

    $etag = Cabecera $m 'ETag'
    Comprobar 'lleva ETag' ($null -ne $etag) 'sin ETag no hay 304 y el móvil redescarga en cada arranque'

    $condicional = Peticion GET '/asistente/manifiesto' -Cabeceras @{ 'If-None-Match' = $etag }
    Comprobar 'con If-None-Match devuelve 304' ($condicional.Estado -eq 304) "estado $($condicional.Estado)"

    # -----------------------------------------------------------------------
    Write-Host "`n== 5. Idempotencia ==" -ForegroundColor Cyan

    $antes = (Peticion GET '/api/clientes?size=1').Cuerpo | ConvertFrom-Json
    $clave = 'dictado-' + [guid]::NewGuid().ToString('N')
    $cuerpo = '{"nombre":"Ana Idempotente","email":"ana.' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '@example.com"}'

    $primera = Peticion POST '/api/clientes' $cuerpo @{ 'Idempotency-Key' = $clave }
    Comprobar 'la primera petición crea (201)' ($primera.Estado -eq 201) "$($primera.Estado) $($primera.Cuerpo)"
    $creado = $primera.Cuerpo | ConvertFrom-Json

    $repetida = Peticion POST '/api/clientes' $cuerpo @{ 'Idempotency-Key' = $clave }
    Comprobar 'el reenvío devuelve el mismo estado' ($repetida.Estado -eq $primera.Estado) "$($repetida.Estado)"
    Comprobar 'el reenvío devuelve el mismo cuerpo' ($repetida.Cuerpo -eq $primera.Cuerpo)
    Comprobar 'el reenvío se marca como repetición' ((Cabecera $repetida 'Idempotent-Replay') -eq 'true')

    $despues = (Peticion GET '/api/clientes?size=1').Cuerpo | ConvertFrom-Json
    Comprobar 'solo se creó un cliente, no dos' `
        ($despues.totalElements -eq $antes.totalElements + 1) `
        "antes $($antes.totalElements), después $($despues.totalElements)"

    $otroCuerpo = '{"nombre":"Otra Persona","email":"otra.' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '@example.com"}'
    $chocada = Peticion POST '/api/clientes' $otroCuerpo @{ 'Idempotency-Key' = $clave }
    Comprobar 'la misma clave con otro cuerpo da 409' ($chocada.Estado -eq 409) "$($chocada.Estado)"

    $malaClave = Peticion POST '/api/clientes' $cuerpo @{ 'Idempotency-Key' = 'corta' }
    Comprobar 'una clave con forma inválida da 400' ($malaClave.Estado -eq 400) "$($malaClave.Estado)"
    Comprobar 'y el error usa el formato de ErrorResponse' `
        ($malaClave.Cuerpo -like '*"fieldErrors"*')

    $sinClave = '{"nombre":"Sin Clave","email":"sin.' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '@example.com"}'
    $libre = Peticion POST '/api/clientes' $sinClave
    Comprobar 'sin cabecera todo sigue funcionando' ($libre.Estado -eq 201) "$($libre.Estado)"

    $limpieza = Peticion DELETE "/api/clientes/$($creado.id)" $null @{ 'Idempotency-Key' = 'limpieza-' + [guid]::NewGuid().ToString('N') }
    Comprobar 'el DELETE también admite la cabecera' ($limpieza.Estado -eq 204) "$($limpieza.Estado)"

} finally {
    Write-Host "`n== 6. Parar ==" -ForegroundColor Cyan
    if (-not $proceso.HasExited) { Stop-Process -Id $proceso.Id -Force }
    $env:DB_PASSWORD = $null
}

Write-Host ''
if ($fallos -eq 0) {
    Write-Host 'Todo correcto.' -ForegroundColor Green
    exit 0
}
Write-Host "$fallos comprobaciones fallidas." -ForegroundColor Red
exit 1
