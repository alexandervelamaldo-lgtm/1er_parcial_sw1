# Lanza Flutter con el entorno que esta máquina necesita.
#
# No es azúcar: sin las dos primeras variables el APK no compila aquí, y el
# mensaje que da Gradle —«Unable to establish loopback connection»— manda a
# buscar un problema de red que no existe. Ver docs/06-despliegue.md §6.9.
#
# Uso:
#   .\compilar.ps1                    # instala y arranca en el móvil conectado
#   .\compilar.ps1 build apk --debug  # cualquier otro comando de flutter
#
# Nada de lo que hace es permanente: todas las variables valen solo para este
# proceso de PowerShell, así que no toca la configuración del sistema.

$ErrorActionPreference = 'Stop'

# 1. Dónde crea Java sus sockets AF_UNIX internos.
#
#    `Selector.open()` —lo que Gradle usa para que su cliente y su demonio se
#    hablen— falla en este equipo con «Invalid argument: connect» siempre que el
#    directorio temporal cuelga de `AppData\Local`, que es donde apunta %TEMP%
#    por defecto. Fuera de ahí funciona. Medido: 0/20 dentro, 20/20 fuera.
#    Como el JDK lee el temporal del entorno y no de `-Djava.io.tmpdir`, la vía
#    que funciona es mover TEMP y TMP, no pasarle una opción a la JVM.
$tempJava = 'C:\gradle-tmp'
if (-not (Test-Path $tempJava)) { New-Item -ItemType Directory $tempJava | Out-Null }
$env:TEMP = $tempJava
$env:TMP = $tempJava

# 2. Qué JDK usa el proceso que lanza Gradle.
#
#    JAVA_HOME apunta a Temurin 17, donde además falla `Pipe.open()`. El JBR que
#    trae Android Studio no tiene ese problema. Se cambia solo para este proceso;
#    el JAVA_HOME del sistema se queda como está, que otras cosas dependen de él.
$jbr = 'C:\Program Files\Android\Android Studio\jbr'
if (Test-Path $jbr) { $env:JAVA_HOME = $jbr }

$env:PATH = "C:\Users\ALEXANDER\flutter\bin;$env:JAVA_HOME\bin;$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:PATH"

# 3. El túnel por cable.
#
#    El teléfono pide `http://localhost:3001` y `adb reverse` lo saca por el USB
#    hasta el portátil. Hay que repetirlo cada vez que se desconecta el cable, y
#    es el motivo número uno de que la app aparezca con la pantalla de error.
#    Falla si no hay ningún dispositivo, y eso no debe cortar la compilación.
try {
    adb reverse tcp:3001 tcp:3001 | Out-Null
    Write-Host 'adb reverse tcp:3001 -> listo' -ForegroundColor DarkGray
} catch {
    Write-Host 'adb reverse no se pudo hacer (¿hay un móvil conectado?)' -ForegroundColor Yellow
}

$argumentos = if ($args.Count -gt 0) { $args } else { @('run', '--dart-define=APP_URL=http://localhost:3001') }
Write-Host "flutter $($argumentos -join ' ')" -ForegroundColor Cyan
& flutter @argumentos
exit $LASTEXITCODE
