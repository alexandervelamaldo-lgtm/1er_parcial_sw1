/**
 * Los catorce casos de uso del sistema, descritos una sola vez.
 *
 * ## De dónde sale cada cosa
 *
 * Este catálogo no se inventó: se leyó del código. Cada caso de uso corresponde a
 * una ruta real de la API o a una pantalla real del frontend, y cada participante
 * lleva en `origen` el fichero del que sale. Esa atadura es lo que separa un
 * análisis de una redacción paralela: si un participante no sabe decir de dónde
 * viene, es que no existe en el sistema y sobra en el diagrama.
 *
 * Las clases, en cambio, **no** son las del código. Son clases de análisis al
 * estilo de Jacobson —«boundary», «control», «entity»—, que es lo que pide el
 * método: `GestorDeAcceso` y no `LocalIdentityProvider`. El `origen` dice de qué
 * fichero salió; el nombre dice qué papel juega.
 *
 * ## Por qué un fichero de datos y no catorce ficheros de dibujo
 *
 * De cada caso salen cuatro diagramas —comunicación, secuencia, actividad y
 * análisis de clases— que cuentan lo mismo con distinta forma. Mantenerlos a mano
 * es mantener cuatro copias de una verdad, y se desincronizan siempre. El sitio
 * donde se nota es la defensa: alguien pregunta por qué el diagrama de secuencia
 * tiene un paso que el de comunicación no. Aquí el caso se describe una vez y los
 * cuatro se derivan.
 *
 * ## Los retornos están marcados
 *
 * Un paso con `retorno: true` es la vuelta de una llamada anterior: se dibuja con
 * línea discontinua y **no** genera operación en el diagrama de análisis. Si no se
 * marcaran, `RepositorioDeIdentidades` acabaría con un método `devolverCuenta`,
 * que es el nombre del valor que devuelve `buscarPorCorreo` y no una operación que
 * nadie llama.
 *
 * ## Qué se comprueba y qué no
 *
 * Nada de aquí se dibuja sin pasar antes por `revisarModelo`. La prueba de al lado
 * lo hace sobre el catálogo entero y falla si un paso apunta a un alias que no
 * participa, si una decisión tiene una rama sin condición o si un participante no
 * manda ni recibe nada. Es a propósito que la comprobación viva fuera de este
 * fichero: los datos se equivocan callando, y un fichero de datos que se valida a
 * sí mismo no se valida.
 */

import type { CasoDeUso, ModeloDeCasosDeUso } from './analisis.js';

// ---------------------------------------------------------------------------
// CU1 — Iniciar sesión
// ---------------------------------------------------------------------------

const cu1: CasoDeUso = {
  id: 'CU1',
  nombre: 'Iniciar sesión',
  paquete: 'Acceso y cuentas',
  actor: 'Usuario',
  descripcion:
    'El usuario entra al sistema con su correo y su contraseña, y recibe una ' +
    'sesión firmada con la que el resto de peticiones se identifican.',
  precondicion: 'La cuenta existe y no está bloqueada.',
  postcondicion:
    'El navegador guarda una sesión firmada y vigente, y se muestra la lista de proyectos.',
  participantes: [
    { alias: 'usuario', clase: 'Usuario', estereotipo: 'actor' },
    {
      alias: 'pantalla',
      clase: 'PantallaAcceso',
      estereotipo: 'boundary',
      origen: 'frontend/src/components/PantallaAcceso.tsx',
    },
    {
      alias: 'gestor',
      clase: 'GestorDeAcceso',
      estereotipo: 'control',
      origen: 'backend-tool/src/api/auth.ts',
    },
    {
      alias: 'identidades',
      clase: 'RepositorioDeIdentidades',
      estereotipo: 'entity',
      origen: 'backend-tool/src/auth/identity.ts',
    },
    {
      alias: 'sesion',
      clase: 'SesionFirmada',
      estereotipo: 'entity',
      origen: 'backend-tool/src/auth/identity.ts',
    },
  ],
  pasos: [
    { numero: '1', de: 'usuario', a: 'pantalla', mensaje: 'escribirCredenciales(correo, clave)' },
    { numero: '2', de: 'pantalla', a: 'gestor', mensaje: 'acceder(correo, clave)' },
    { numero: '3', de: 'gestor', a: 'identidades', mensaje: 'buscarPorCorreo(correo)' },
    {
      numero: '3.1',
      de: 'identidades',
      a: 'gestor',
      mensaje: 'devolverCuenta(cuenta)',
      retorno: true,
    },
    { numero: '4', de: 'gestor', a: 'identidades', mensaje: 'comprobarClave(clave)' },
    {
      numero: '4.1',
      de: 'identidades',
      a: 'gestor',
      mensaje: 'confirmarCredencial(valida)',
      retorno: true,
    },
    { numero: '5', de: 'gestor', a: 'sesion', mensaje: 'firmar(cuenta, caducidad)' },
    { numero: '5.1', de: 'sesion', a: 'gestor', mensaje: 'devolverTestigo(testigo)', retorno: true },
    {
      numero: '6',
      de: 'gestor',
      a: 'pantalla',
      mensaje: 'entregarSesion(testigo)',
      retorno: true,
    },
    { numero: '7', de: 'pantalla', a: 'usuario', mensaje: 'abrirListaDeProyectos()', retorno: true },
  ],
  alternativos: [
    {
      nombre: 'Credenciales incorrectas',
      texto:
        'El sistema responde con el mismo mensaje tanto si el correo no existe como si la ' +
        'contraseña no coincide, para no revelar qué correos están dados de alta.',
    },
    {
      nombre: 'Contraseña cambiada en otro dispositivo',
      texto:
        'La marca de credencial de la sesión ya no coincide y la sesión se rechaza: hay que ' +
        'volver a entrar.',
    },
  ],
  actividad: {
    nodos: [
      { id: 'n0', tipo: 'inicio', calle: 'Usuario' },
      { id: 'n1', tipo: 'accion', calle: 'Usuario', texto: 'Abrir la pantalla de acceso' },
      { id: 'n2', tipo: 'accion', calle: 'Usuario', texto: 'Escribir el correo y la contraseña' },
      { id: 'n3', tipo: 'accion', calle: 'Sistema', texto: 'Comprobar las credenciales' },
      { id: 'n4', tipo: 'decision', calle: 'Sistema', texto: 'Credenciales válidas' },
      {
        id: 'n5',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Firmar la sesión y abrir la lista de proyectos',
      },
      { id: 'n6', tipo: 'accion', calle: 'Sistema', texto: 'Rechazar el acceso sin dar detalles' },
      { id: 'n7', tipo: 'fin', calle: 'Sistema' },
    ],
    flujos: [
      { de: 'n0', a: 'n1' },
      { de: 'n1', a: 'n2' },
      { de: 'n2', a: 'n3' },
      { de: 'n3', a: 'n4' },
      { de: 'n4', a: 'n5', guarda: 'Sí' },
      { de: 'n4', a: 'n6', guarda: 'No' },
      { de: 'n5', a: 'n7' },
      { de: 'n6', a: 'n2' },
    ],
  },
};

// ---------------------------------------------------------------------------
// CU2 — Registrar cuenta
// ---------------------------------------------------------------------------

const cu2: CasoDeUso = {
  id: 'CU2',
  nombre: 'Registrar cuenta',
  paquete: 'Acceso y cuentas',
  actor: 'Usuario',
  descripcion:
    'Alguien sin cuenta se da de alta con nombre, correo y contraseña, y entra ' +
    'directamente sin tener que iniciar sesión aparte.',
  precondicion: 'No hay ninguna cuenta con ese correo.',
  postcondicion: 'La cuenta queda guardada con la contraseña resumida y el usuario entra.',
  participantes: [
    { alias: 'usuario', clase: 'Usuario', estereotipo: 'actor' },
    {
      alias: 'pantalla',
      clase: 'PantallaAcceso',
      estereotipo: 'boundary',
      origen: 'frontend/src/components/PantallaAcceso.tsx',
    },
    {
      alias: 'gestor',
      clase: 'GestorDeAcceso',
      estereotipo: 'control',
      origen: 'backend-tool/src/api/auth.ts',
    },
    {
      alias: 'identidades',
      clase: 'RepositorioDeIdentidades',
      estereotipo: 'entity',
      origen: 'backend-tool/src/auth/identity.ts',
    },
    {
      alias: 'cuenta',
      clase: 'Cuenta',
      estereotipo: 'entity',
      origen: 'backend-tool/src/auth/identity.ts',
    },
  ],
  pasos: [
    {
      numero: '1',
      de: 'usuario',
      a: 'pantalla',
      mensaje: 'rellenarRegistro(nombre, correo, clave)',
    },
    { numero: '2', de: 'pantalla', a: 'gestor', mensaje: 'registrar(nombre, correo, clave)' },
    { numero: '3', de: 'gestor', a: 'identidades', mensaje: 'comprobarCorreoLibre(correo)' },
    {
      numero: '3.1',
      de: 'identidades',
      a: 'gestor',
      mensaje: 'confirmarDisponible(libre)',
      retorno: true,
    },
    { numero: '4', de: 'gestor', a: 'cuenta', mensaje: 'crear(nombre, correo, resumen)' },
    { numero: '5', de: 'gestor', a: 'identidades', mensaje: 'guardar(cuenta)' },
    { numero: '6', de: 'gestor', a: 'pantalla', mensaje: 'entregarSesion(testigo)', retorno: true },
    { numero: '7', de: 'pantalla', a: 'usuario', mensaje: 'abrirListaDeProyectos()', retorno: true },
  ],
  alternativos: [
    {
      nombre: 'Correo ya registrado',
      texto: 'No se crea nada y se pide iniciar sesión o recuperar la contraseña.',
    },
    {
      nombre: 'Contraseña demasiado corta',
      texto:
        'La comprobación de longitud se hace en el servidor además de en el navegador: el ' +
        'formulario no es la validación, es la comodidad.',
    },
  ],
  actividad: {
    nodos: [
      { id: 'a0', tipo: 'inicio', calle: 'Usuario' },
      { id: 'a1', tipo: 'accion', calle: 'Usuario', texto: 'Rellenar el formulario de registro' },
      {
        id: 'a2',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Validar el formato del correo y la contraseña',
      },
      { id: 'a3', tipo: 'decision', calle: 'Sistema', texto: 'El correo está libre' },
      {
        id: 'a4',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Crear la cuenta y firmar la sesión',
      },
      {
        id: 'a5',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Avisar de que ese correo ya tiene cuenta',
      },
      { id: 'a6', tipo: 'fin', calle: 'Sistema' },
    ],
    flujos: [
      { de: 'a0', a: 'a1' },
      { de: 'a1', a: 'a2' },
      { de: 'a2', a: 'a3' },
      { de: 'a3', a: 'a4', guarda: 'Sí' },
      { de: 'a3', a: 'a5', guarda: 'No' },
      { de: 'a4', a: 'a6' },
      { de: 'a5', a: 'a1' },
    ],
  },
};

// ---------------------------------------------------------------------------
// CU3 — Recuperar la contraseña
// ---------------------------------------------------------------------------

const cu3: CasoDeUso = {
  id: 'CU3',
  nombre: 'Recuperar la contraseña',
  paquete: 'Acceso y cuentas',
  actor: 'Usuario',
  descripcion:
    'El usuario que no recuerda su contraseña pide un código de un solo uso y, ' +
    'con él, fija una contraseña nueva.',
  precondicion: 'La cuenta existe.',
  postcondicion:
    'La contraseña queda cambiada, el código se consume y las sesiones antiguas dejan de valer.',
  participantes: [
    { alias: 'usuario', clase: 'Usuario', estereotipo: 'actor' },
    {
      alias: 'pantalla',
      clase: 'PantallaRecuperacion',
      estereotipo: 'boundary',
      origen: 'frontend/src/components/CodigoRecuperacion.tsx',
    },
    {
      alias: 'gestor',
      clase: 'GestorDeRecuperacion',
      estereotipo: 'control',
      origen: 'backend-tool/src/api/auth.ts',
    },
    {
      alias: 'identidades',
      clase: 'RepositorioDeIdentidades',
      estereotipo: 'entity',
      origen: 'backend-tool/src/auth/identity.ts',
    },
    {
      alias: 'codigo',
      clase: 'CodigoDeRecuperacion',
      estereotipo: 'entity',
      origen: 'backend-tool/src/auth/identity.ts',
    },
  ],
  pasos: [
    { numero: '1', de: 'usuario', a: 'pantalla', mensaje: 'escribirCorreo(correo)' },
    { numero: '2', de: 'pantalla', a: 'gestor', mensaje: 'pedirCodigo(correo)' },
    { numero: '3', de: 'gestor', a: 'identidades', mensaje: 'buscarPorCorreo(correo)' },
    {
      numero: '3.1',
      de: 'identidades',
      a: 'gestor',
      mensaje: 'devolverCuenta(cuenta)',
      retorno: true,
    },
    { numero: '4', de: 'gestor', a: 'codigo', mensaje: 'generar(cuenta, caducidad)' },
    { numero: '5', de: 'usuario', a: 'pantalla', mensaje: 'escribirCodigo(codigo, claveNueva)' },
    { numero: '6', de: 'pantalla', a: 'gestor', mensaje: 'cambiarClave(codigo, claveNueva)' },
    { numero: '7', de: 'gestor', a: 'codigo', mensaje: 'comprobarVigencia(codigo)' },
    {
      numero: '7.1',
      de: 'codigo',
      a: 'gestor',
      mensaje: 'confirmarVigente(vigente)',
      retorno: true,
    },
    { numero: '8', de: 'gestor', a: 'identidades', mensaje: 'guardarClave(cuenta, claveNueva)' },
    { numero: '9', de: 'gestor', a: 'pantalla', mensaje: 'confirmarCambio()', retorno: true },
  ],
  alternativos: [
    {
      nombre: 'Correo desconocido',
      texto:
        'La respuesta es la misma que si existiera. Decir «ese correo no está registrado» ' +
        'convierte esta pantalla en un comprobador de correos ajenos.',
    },
    {
      nombre: 'Código caducado o ya usado',
      texto: 'Se rechaza el cambio y hay que pedir otro código.',
    },
  ],
  actividad: {
    nodos: [
      { id: 'r0', tipo: 'inicio', calle: 'Usuario' },
      {
        id: 'r1',
        tipo: 'accion',
        calle: 'Usuario',
        texto: 'Pedir el código con el correo de la cuenta',
      },
      { id: 'r2', tipo: 'accion', calle: 'Sistema', texto: 'Emitir un código con caducidad' },
      {
        id: 'r3',
        tipo: 'accion',
        calle: 'Usuario',
        texto: 'Escribir el código y la contraseña nueva',
      },
      { id: 'r4', tipo: 'decision', calle: 'Sistema', texto: 'El código sigue vigente' },
      {
        id: 'r5',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Guardar la contraseña y revocar las sesiones antiguas',
      },
      { id: 'r6', tipo: 'accion', calle: 'Sistema', texto: 'Avisar de que el código ya no vale' },
      { id: 'r7', tipo: 'fin', calle: 'Sistema' },
    ],
    flujos: [
      { de: 'r0', a: 'r1' },
      { de: 'r1', a: 'r2' },
      { de: 'r2', a: 'r3' },
      { de: 'r3', a: 'r4' },
      { de: 'r4', a: 'r5', guarda: 'Sí' },
      { de: 'r4', a: 'r6', guarda: 'No' },
      { de: 'r5', a: 'r7' },
      { de: 'r6', a: 'r1' },
    ],
  },
};

// ---------------------------------------------------------------------------
// CU4 — Emitir un código de recuperación desde el servidor
// ---------------------------------------------------------------------------

const cu4: CasoDeUso = {
  id: 'CU4',
  nombre: 'Emitir un código de recuperación desde el servidor',
  paquete: 'Acceso y cuentas',
  actor: 'Operador del servidor',
  descripcion:
    'Mientras no haya correo saliente, el código lo emite el operador con una ' +
    'orden de consola y se lo hace llegar al usuario por otro medio.',
  precondicion: 'El operador tiene acceso al servidor y la cuenta existe.',
  postcondicion: 'El código queda guardado con su caducidad e impreso una sola vez por consola.',
  participantes: [
    {
      alias: 'operador',
      clase: 'OperadorDelServidor',
      estereotipo: 'actor',
      origen: 'backend-tool/src/recuperar.ts',
    },
    {
      alias: 'consola',
      clase: 'ConsolaDeRecuperacion',
      estereotipo: 'boundary',
      origen: 'backend-tool/src/recuperar.ts',
    },
    {
      alias: 'gestor',
      clase: 'GestorDeRecuperacion',
      estereotipo: 'control',
      origen: 'backend-tool/src/auth/identity.ts',
    },
    {
      alias: 'identidades',
      clase: 'RepositorioDeIdentidades',
      estereotipo: 'entity',
      origen: 'backend-tool/src/auth/identity.ts',
    },
    {
      alias: 'codigo',
      clase: 'CodigoDeRecuperacion',
      estereotipo: 'entity',
      origen: 'backend-tool/src/auth/identity.ts',
    },
  ],
  pasos: [
    { numero: '1', de: 'operador', a: 'consola', mensaje: 'ejecutarOrden(correo)' },
    { numero: '2', de: 'consola', a: 'identidades', mensaje: 'buscarPorCorreo(correo)' },
    {
      numero: '2.1',
      de: 'identidades',
      a: 'consola',
      mensaje: 'devolverCuenta(cuenta)',
      retorno: true,
    },
    { numero: '3', de: 'consola', a: 'gestor', mensaje: 'emitirCodigo(cuenta)' },
    { numero: '4', de: 'gestor', a: 'codigo', mensaje: 'generar(cuenta, caducidad)' },
    { numero: '5', de: 'gestor', a: 'identidades', mensaje: 'guardarCodigo(cuenta, codigo)' },
    { numero: '6', de: 'gestor', a: 'consola', mensaje: 'devolverCodigo(codigo)', retorno: true },
    { numero: '7', de: 'consola', a: 'operador', mensaje: 'imprimirCodigo(codigo)', retorno: true },
  ],
  alternativos: [
    {
      nombre: 'La cuenta no existe',
      texto:
        'La orden termina con error y no emite nada. Aquí sí se dice el motivo: quien ejecuta ' +
        'la orden ya está dentro del servidor y ocultárselo solo estorba.',
    },
  ],
  actividad: {
    nodos: [
      { id: 'e0', tipo: 'inicio', calle: 'Operador' },
      {
        id: 'e1',
        tipo: 'accion',
        calle: 'Operador',
        texto: 'Ejecutar la orden con el correo de la cuenta',
      },
      { id: 'e2', tipo: 'decision', calle: 'Sistema', texto: 'Existe la cuenta' },
      {
        id: 'e3',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Emitir el código y guardarlo con su caducidad',
      },
      { id: 'e4', tipo: 'accion', calle: 'Sistema', texto: 'Terminar con error sin emitir nada' },
      {
        id: 'e5',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Imprimir el código por la salida estándar',
      },
      { id: 'e6', tipo: 'fin', calle: 'Sistema' },
    ],
    flujos: [
      { de: 'e0', a: 'e1' },
      { de: 'e1', a: 'e2' },
      { de: 'e2', a: 'e3', guarda: 'Sí' },
      { de: 'e2', a: 'e4', guarda: 'No' },
      { de: 'e3', a: 'e5' },
      { de: 'e5', a: 'e6' },
      { de: 'e4', a: 'e6' },
    ],
  },
};

// ---------------------------------------------------------------------------
// CU5 — Crear un proyecto
// ---------------------------------------------------------------------------

const cu5: CasoDeUso = {
  id: 'CU5',
  nombre: 'Crear un proyecto',
  paquete: 'Proyectos y colaboración',
  actor: 'Usuario',
  descripcion:
    'El usuario crea un proyecto vacío, del que queda como propietario, y el ' +
    'sistema le prepara el documento compartido en el que se editará el diagrama.',
  precondicion: 'Hay una sesión iniciada.',
  postcondicion:
    'El proyecto existe con el usuario como propietario y con un documento de diagrama vacío.',
  participantes: [
    { alias: 'usuario', clase: 'Usuario', estereotipo: 'actor' },
    {
      alias: 'lista',
      clase: 'ListaDeProyectos',
      estereotipo: 'boundary',
      origen: 'frontend/src/components/ListaProyectos.tsx',
    },
    {
      alias: 'gestor',
      clase: 'GestorDeProyectos',
      estereotipo: 'control',
      origen: 'backend-tool/src/api/projects.ts',
    },
    {
      alias: 'proyecto',
      clase: 'Proyecto',
      estereotipo: 'entity',
      origen: 'backend-tool/src/storage/store.ts',
    },
    {
      alias: 'almacen',
      clase: 'AlmacenDeProyectos',
      estereotipo: 'entity',
      origen: 'backend-tool/src/storage/store.ts',
    },
    {
      alias: 'documento',
      clase: 'DocumentoDelDiagrama',
      estereotipo: 'entity',
      origen: 'backend-tool/src/storage/documents.ts',
    },
  ],
  pasos: [
    { numero: '1', de: 'usuario', a: 'lista', mensaje: 'pulsarNuevoProyecto(nombre)' },
    { numero: '2', de: 'lista', a: 'gestor', mensaje: 'crearProyecto(nombre)' },
    { numero: '3', de: 'gestor', a: 'proyecto', mensaje: 'crear(nombre, propietario)' },
    { numero: '4', de: 'gestor', a: 'almacen', mensaje: 'guardar(proyecto)' },
    { numero: '5', de: 'gestor', a: 'documento', mensaje: 'inicializar(proyecto)' },
    { numero: '6', de: 'gestor', a: 'lista', mensaje: 'devolverProyecto(proyecto)', retorno: true },
    { numero: '7', de: 'lista', a: 'usuario', mensaje: 'abrirEditor(proyecto)', retorno: true },
  ],
  alternativos: [
    {
      nombre: 'Nombre vacío o demasiado largo',
      texto: 'No se crea nada y se dice qué límite se pasó, no solo que el nombre no vale.',
    },
  ],
  actividad: {
    nodos: [
      { id: 'p0', tipo: 'inicio', calle: 'Usuario' },
      {
        id: 'p1',
        tipo: 'accion',
        calle: 'Usuario',
        texto: 'Pulsar Nuevo proyecto y escribir el nombre',
      },
      { id: 'p2', tipo: 'decision', calle: 'Sistema', texto: 'El nombre es válido' },
      {
        id: 'p3',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Crear el proyecto con el usuario como propietario',
      },
      { id: 'p4', tipo: 'accion', calle: 'Sistema', texto: 'Explicar por qué el nombre no vale' },
      { id: 'p5', tipo: 'accion', calle: 'Sistema', texto: 'Abrir el editor con el diagrama vacío' },
      { id: 'p6', tipo: 'fin', calle: 'Sistema' },
    ],
    flujos: [
      { de: 'p0', a: 'p1' },
      { de: 'p1', a: 'p2' },
      { de: 'p2', a: 'p3', guarda: 'Sí' },
      { de: 'p2', a: 'p4', guarda: 'No' },
      { de: 'p3', a: 'p5' },
      { de: 'p5', a: 'p6' },
      { de: 'p4', a: 'p1' },
    ],
  },
};

// ---------------------------------------------------------------------------
// CU6 — Abrir un proyecto
// ---------------------------------------------------------------------------

const cu6: CasoDeUso = {
  id: 'CU6',
  nombre: 'Abrir un proyecto',
  paquete: 'Proyectos y colaboración',
  actor: 'Usuario',
  otrosActores: ['Lector'],
  descripcion:
    'El usuario elige un proyecto de su lista y el sistema abre el editor con el ' +
    'diagrama cargado y con los permisos que le corresponden por su papel.',
  precondicion: 'El usuario es propietario, editor o lector del proyecto.',
  postcondicion: 'El editor muestra el diagrama, en modo edición o en solo lectura.',
  participantes: [
    { alias: 'usuario', clase: 'Usuario', estereotipo: 'actor' },
    {
      alias: 'lista',
      clase: 'ListaDeProyectos',
      estereotipo: 'boundary',
      origen: 'frontend/src/components/ListaProyectos.tsx',
    },
    {
      alias: 'gestor',
      clase: 'GestorDeProyectos',
      estereotipo: 'control',
      origen: 'backend-tool/src/api/projects.ts',
    },
    {
      alias: 'almacen',
      clase: 'AlmacenDeProyectos',
      estereotipo: 'entity',
      origen: 'backend-tool/src/storage/store.ts',
    },
    {
      alias: 'permisos',
      clase: 'ControlDePermisos',
      estereotipo: 'control',
      origen: 'backend-tool/src/storage/store.ts',
    },
    {
      alias: 'editor',
      clase: 'EditorDeDiagrama',
      estereotipo: 'boundary',
      origen: 'frontend/src/components/EditorDiagrama.tsx',
    },
  ],
  pasos: [
    { numero: '1', de: 'usuario', a: 'lista', mensaje: 'elegirProyecto(proyectoId)' },
    { numero: '2', de: 'lista', a: 'gestor', mensaje: 'abrirProyecto(proyectoId)' },
    { numero: '3', de: 'gestor', a: 'almacen', mensaje: 'leer(proyectoId)' },
    {
      numero: '3.1',
      de: 'almacen',
      a: 'gestor',
      mensaje: 'devolverProyecto(proyecto)',
      retorno: true,
    },
    { numero: '4', de: 'gestor', a: 'permisos', mensaje: 'comprobarPapel(cuenta, proyecto)' },
    {
      numero: '4.1',
      de: 'permisos',
      a: 'gestor',
      mensaje: 'confirmarPermiso(papel)',
      retorno: true,
    },
    { numero: '5', de: 'gestor', a: 'lista', mensaje: 'devolverDiagrama(diagrama)', retorno: true },
    { numero: '6', de: 'lista', a: 'editor', mensaje: 'mostrarDiagrama(diagrama, papel)' },
    { numero: '7', de: 'editor', a: 'usuario', mensaje: 'dibujarLienzo()', retorno: true },
  ],
  alternativos: [
    {
      nombre: 'El usuario no es miembro',
      texto: 'Se niega el acceso y se vuelve a la lista, sin decir si el proyecto existe.',
    },
    {
      nombre: 'El papel es de lector',
      texto: 'El editor se abre en solo lectura: se ve y se navega, pero las herramientas no.',
    },
  ],
  actividad: {
    nodos: [
      { id: 'b0', tipo: 'inicio', calle: 'Usuario' },
      { id: 'b1', tipo: 'accion', calle: 'Usuario', texto: 'Elegir un proyecto de la lista' },
      {
        id: 'b2',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Leer el proyecto y el papel del usuario',
      },
      { id: 'b3', tipo: 'decision', calle: 'Sistema', texto: 'Es miembro del proyecto' },
      {
        id: 'b4',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Abrir el editor con el diagrama cargado',
      },
      { id: 'b5', tipo: 'accion', calle: 'Sistema', texto: 'Negar el acceso y volver a la lista' },
      { id: 'b6', tipo: 'fin', calle: 'Sistema' },
    ],
    flujos: [
      { de: 'b0', a: 'b1' },
      { de: 'b1', a: 'b2' },
      { de: 'b2', a: 'b3' },
      { de: 'b3', a: 'b4', guarda: 'Sí' },
      { de: 'b3', a: 'b5', guarda: 'No' },
      { de: 'b4', a: 'b6' },
      { de: 'b5', a: 'b1' },
    ],
  },
};

// ---------------------------------------------------------------------------
// CU7 — Invitar a un colaborador
// ---------------------------------------------------------------------------

const cu7: CasoDeUso = {
  id: 'CU7',
  nombre: 'Invitar a un colaborador',
  paquete: 'Proyectos y colaboración',
  actor: 'Propietario',
  descripcion:
    'El propietario añade a otra cuenta al proyecto con el papel de editor o de ' +
    'lector, y puede quitarla después.',
  precondicion: 'El usuario es propietario del proyecto y existe una cuenta con ese correo.',
  postcondicion: 'La cuenta invitada aparece entre los miembros con el papel elegido.',
  participantes: [
    { alias: 'propietario', clase: 'Propietario', estereotipo: 'actor' },
    {
      alias: 'panel',
      clase: 'PanelDeMiembros',
      estereotipo: 'boundary',
      origen: 'frontend/src/components/ListaProyectos.tsx',
    },
    {
      alias: 'gestor',
      clase: 'GestorDeMiembros',
      estereotipo: 'control',
      origen: 'backend-tool/src/api/projects.ts',
    },
    {
      alias: 'identidades',
      clase: 'RepositorioDeIdentidades',
      estereotipo: 'entity',
      origen: 'backend-tool/src/auth/identity.ts',
    },
    {
      alias: 'miembro',
      clase: 'Miembro',
      estereotipo: 'entity',
      origen: 'backend-tool/src/storage/store.ts',
    },
    {
      alias: 'almacen',
      clase: 'AlmacenDeProyectos',
      estereotipo: 'entity',
      origen: 'backend-tool/src/storage/store.ts',
    },
  ],
  pasos: [
    { numero: '1', de: 'propietario', a: 'panel', mensaje: 'escribirInvitacion(correo, papel)' },
    { numero: '2', de: 'panel', a: 'gestor', mensaje: 'invitar(proyectoId, correo, papel)' },
    { numero: '3', de: 'gestor', a: 'identidades', mensaje: 'buscarPorCorreo(correo)' },
    {
      numero: '3.1',
      de: 'identidades',
      a: 'gestor',
      mensaje: 'devolverCuenta(cuenta)',
      retorno: true,
    },
    { numero: '4', de: 'gestor', a: 'miembro', mensaje: 'crear(cuenta, papel)' },
    { numero: '5', de: 'gestor', a: 'almacen', mensaje: 'guardarMiembro(proyectoId, miembro)' },
    { numero: '6', de: 'gestor', a: 'panel', mensaje: 'devolverMiembros(miembros)', retorno: true },
    {
      numero: '7',
      de: 'panel',
      a: 'propietario',
      mensaje: 'mostrarMiembros(miembros)',
      retorno: true,
    },
  ],
  alternativos: [
    {
      nombre: 'No hay cuenta con ese correo',
      texto: 'No se crea ninguna invitación pendiente: la cuenta tiene que existir antes.',
    },
    {
      nombre: 'Quien invita no es el propietario',
      texto: 'Un editor puede dibujar pero no puede repartir permisos.',
    },
  ],
  actividad: {
    nodos: [
      { id: 'm0', tipo: 'inicio', calle: 'Propietario' },
      {
        id: 'm1',
        tipo: 'accion',
        calle: 'Propietario',
        texto: 'Escribir el correo y elegir el papel',
      },
      { id: 'm2', tipo: 'decision', calle: 'Sistema', texto: 'Existe una cuenta con ese correo' },
      { id: 'm3', tipo: 'accion', calle: 'Sistema', texto: 'Añadir el miembro con su papel' },
      {
        id: 'm4',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Avisar de que no hay ninguna cuenta con ese correo',
      },
      {
        id: 'm5',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Mostrar la lista de miembros actualizada',
      },
      { id: 'm6', tipo: 'fin', calle: 'Sistema' },
    ],
    flujos: [
      { de: 'm0', a: 'm1' },
      { de: 'm1', a: 'm2' },
      { de: 'm2', a: 'm3', guarda: 'Sí' },
      { de: 'm2', a: 'm4', guarda: 'No' },
      { de: 'm3', a: 'm5' },
      { de: 'm5', a: 'm6' },
      { de: 'm4', a: 'm1' },
    ],
  },
};

// ---------------------------------------------------------------------------
// CU8 — Editar el diagrama en tiempo real
// ---------------------------------------------------------------------------

const cu8: CasoDeUso = {
  id: 'CU8',
  nombre: 'Editar el diagrama en tiempo real',
  paquete: 'Edición del diagrama',
  actor: 'Editor',
  otrosActores: ['Propietario'],
  descripcion:
    'Varios editores trabajan a la vez sobre el mismo diagrama: cada cambio se ' +
    'aplica en local, se reparte a los demás y se funde sin pisarse.',
  precondicion: 'El proyecto está abierto y el papel permite editar.',
  postcondicion:
    'El cambio queda en el documento compartido y todos los editores conectados lo ven.',
  participantes: [
    { alias: 'editor', clase: 'Editor', estereotipo: 'actor' },
    {
      alias: 'lienzo',
      clase: 'Lienzo',
      estereotipo: 'boundary',
      origen: 'frontend/src/components/Lienzo.tsx',
    },
    {
      alias: 'documento',
      clase: 'DocumentoCompartido',
      estereotipo: 'control',
      origen: 'shared/src/crdt/document.ts',
    },
    {
      alias: 'sala',
      clase: 'SalaDeColaboracion',
      estereotipo: 'control',
      origen: 'backend-tool/src/collab/rooms.ts',
    },
    {
      alias: 'diagrama',
      clase: 'Diagrama',
      estereotipo: 'entity',
      origen: 'shared/src/model/uml.ts',
    },
    {
      alias: 'presencia',
      clase: 'PresenciaDeEditores',
      estereotipo: 'entity',
      origen: 'frontend/src/hooks/usePresencia.ts',
    },
  ],
  pasos: [
    { numero: '1', de: 'editor', a: 'lienzo', mensaje: 'arrastrarClase(clase, posicion)' },
    { numero: '2', de: 'lienzo', a: 'documento', mensaje: 'aplicarOperacion(operacion)' },
    { numero: '3', de: 'documento', a: 'diagrama', mensaje: 'modificar(operacion)' },
    { numero: '4', de: 'documento', a: 'sala', mensaje: 'enviarCambio(actualizacion)' },
    { numero: '5', de: 'sala', a: 'presencia', mensaje: 'anotarPresencia(cuenta, posicion)' },
    { numero: '6', de: 'sala', a: 'documento', mensaje: 'repartirCambio(actualizacion)' },
    { numero: '7', de: 'documento', a: 'lienzo', mensaje: 'refrescarVista(diagrama)', retorno: true },
    { numero: '8', de: 'lienzo', a: 'editor', mensaje: 'mostrarCambio()', retorno: true },
  ],
  alternativos: [
    {
      nombre: 'Dos editores tocan la misma clase',
      texto:
        'No hay conflicto que resolver a mano: el documento es un CRDT y las dos ediciones se ' +
        'funden en un orden estable, igual en todos los navegadores.',
    },
    {
      nombre: 'Se cae la conexión',
      texto:
        'La edición sigue en local y el indicador de sincronía lo dice. Al volver la conexión ' +
        'se reenvía lo pendiente.',
    },
  ],
  actividad: {
    nodos: [
      { id: 'd0', tipo: 'inicio', calle: 'Editor' },
      { id: 'd1', tipo: 'accion', calle: 'Editor', texto: 'Mover o editar un elemento' },
      { id: 'd2', tipo: 'decision', calle: 'Sistema', texto: 'El papel permite editar' },
      {
        id: 'd3',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Aplicar la operación sobre el documento compartido',
      },
      { id: 'd4', tipo: 'accion', calle: 'Sistema', texto: 'Dejar el lienzo en solo lectura' },
      {
        id: 'd5',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Repartir el cambio a los demás editores',
      },
      { id: 'd6', tipo: 'fin', calle: 'Sistema' },
    ],
    flujos: [
      { de: 'd0', a: 'd1' },
      { de: 'd1', a: 'd2' },
      { de: 'd2', a: 'd3', guarda: 'Sí' },
      { de: 'd2', a: 'd4', guarda: 'No' },
      { de: 'd3', a: 'd5' },
      { de: 'd5', a: 'd6' },
      { de: 'd4', a: 'd6' },
    ],
  },
};

// ---------------------------------------------------------------------------
// CU9 — Importar un diagrama desde una foto
// ---------------------------------------------------------------------------

const cu9: CasoDeUso = {
  id: 'CU9',
  nombre: 'Importar un diagrama desde una foto',
  paquete: 'Asistencia inteligente',
  actor: 'Editor',
  descripcion:
    'El editor fotografía un diagrama de clases —de una pizarra o de un papel— y ' +
    'el sistema propone las clases, los atributos y las relaciones que ha leído.',
  precondicion: 'El motor de visión está configurado y el proyecto está abierto para editar.',
  postcondicion:
    'El diagrama recibe lo que el editor haya confirmado; nada se aplica sin revisión.',
  participantes: [
    { alias: 'editor', clase: 'Editor', estereotipo: 'actor' },
    {
      alias: 'pantalla',
      clase: 'PantallaDesdeImagen',
      estereotipo: 'boundary',
      origen: 'frontend/src/components/ImportarDiagrama.tsx',
    },
    {
      alias: 'gestor',
      clase: 'GestorDeImportacion',
      estereotipo: 'control',
      origen: 'backend-tool/src/api/import.ts',
    },
    {
      alias: 'vision',
      clase: 'MotorDeVision',
      estereotipo: 'control',
      origen: 'backend-tool/src/ai/vision.ts',
    },
    {
      alias: 'propuesta',
      clase: 'PropuestaDeDiagrama',
      estereotipo: 'entity',
      origen: 'shared/src/ops/import-diagram.ts',
    },
    {
      alias: 'documento',
      clase: 'DocumentoCompartido',
      estereotipo: 'control',
      origen: 'shared/src/crdt/document.ts',
    },
  ],
  pasos: [
    { numero: '1', de: 'editor', a: 'pantalla', mensaje: 'elegirFoto(imagen)' },
    { numero: '2', de: 'pantalla', a: 'gestor', mensaje: 'leerImagen(imagen)' },
    { numero: '3', de: 'gestor', a: 'vision', mensaje: 'extraerEstructura(imagen)' },
    {
      numero: '3.1',
      de: 'vision',
      a: 'gestor',
      mensaje: 'devolverLectura(clases, relaciones)',
      retorno: true,
    },
    { numero: '4', de: 'gestor', a: 'propuesta', mensaje: 'construir(clases, relaciones)' },
    { numero: '5', de: 'gestor', a: 'pantalla', mensaje: 'mostrarPropuesta(propuesta)', retorno: true },
    { numero: '6', de: 'editor', a: 'pantalla', mensaje: 'confirmarPropuesta(propuesta)' },
    { numero: '7', de: 'pantalla', a: 'documento', mensaje: 'aplicarPropuesta(propuesta)' },
    { numero: '8', de: 'documento', a: 'editor', mensaje: 'mostrarDiagrama()', retorno: true },
  ],
  alternativos: [
    {
      nombre: 'La foto no deja leer un nombre',
      texto:
        'Ese elemento se marca como dudoso y se muestra aparte. No se adivina: un nombre ' +
        'inventado con confianza es peor que un hueco señalado.',
    },
    {
      nombre: 'El editor descarta la propuesta',
      texto: 'El diagrama no cambia. La revisión es obligatoria y nada se aplica solo.',
    },
    {
      nombre: 'El motor de visión no está configurado',
      texto:
        'La pantalla lo dice antes de pedir la foto, en vez de fallar después de subirla. Y no ' +
        'se le presta a un proveedor la clave de otro.',
    },
  ],
  actividad: {
    nodos: [
      { id: 'f0', tipo: 'inicio', calle: 'Editor' },
      { id: 'f1', tipo: 'accion', calle: 'Editor', texto: 'Elegir o hacer la foto del diagrama' },
      {
        id: 'f2',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Extraer clases, atributos y relaciones de la imagen',
      },
      {
        id: 'f3',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Mostrar la propuesta marcando lo dudoso',
      },
      { id: 'f4', tipo: 'decision', calle: 'Editor', texto: 'La propuesta se confirma' },
      { id: 'f5', tipo: 'accion', calle: 'Sistema', texto: 'Aplicar la propuesta al diagrama' },
      {
        id: 'f6',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Descartarla sin tocar el diagrama',
      },
      { id: 'f7', tipo: 'fin', calle: 'Sistema' },
    ],
    flujos: [
      { de: 'f0', a: 'f1' },
      { de: 'f1', a: 'f2' },
      { de: 'f2', a: 'f3' },
      { de: 'f3', a: 'f4' },
      { de: 'f4', a: 'f5', guarda: 'Sí' },
      { de: 'f4', a: 'f6', guarda: 'No' },
      { de: 'f5', a: 'f7' },
      { de: 'f6', a: 'f7' },
    ],
  },
};

// ---------------------------------------------------------------------------
// CU10 — Importar y exportar XMI
// ---------------------------------------------------------------------------

const cu10: CasoDeUso = {
  id: 'CU10',
  nombre: 'Importar y exportar XMI',
  paquete: 'Edición del diagrama',
  actor: 'Editor',
  descripcion:
    'El diagrama viaja en los dos sentidos entre esta herramienta y Enterprise ' +
    'Architect a través de ficheros XMI 2.1.',
  precondicion: 'El proyecto está abierto.',
  postcondicion:
    'El diagrama incorpora lo importado, o el editor se lleva un fichero que la herramienta abre.',
  participantes: [
    { alias: 'editor', clase: 'Editor', estereotipo: 'actor' },
    {
      alias: 'pantalla',
      clase: 'PantallaXmi',
      estereotipo: 'boundary',
      origen: 'frontend/src/components/ImportarXmi.tsx',
    },
    {
      alias: 'lector',
      clase: 'LectorXmi',
      estereotipo: 'control',
      origen: 'shared/src/xmi/import.ts',
    },
    {
      alias: 'escritor',
      clase: 'EscritorXmi',
      estereotipo: 'control',
      origen: 'shared/src/xmi/export.ts',
    },
    {
      alias: 'fichero',
      clase: 'FicheroXmi',
      estereotipo: 'entity',
      origen: 'shared/src/xmi/comun.ts',
    },
    {
      alias: 'diagrama',
      clase: 'Diagrama',
      estereotipo: 'entity',
      origen: 'shared/src/model/uml.ts',
    },
  ],
  pasos: [
    { numero: '1', de: 'editor', a: 'pantalla', mensaje: 'elegirFichero(fichero)' },
    { numero: '2', de: 'pantalla', a: 'lector', mensaje: 'leerXmi(fichero)' },
    { numero: '3', de: 'lector', a: 'fichero', mensaje: 'decodificar(bytes)' },
    { numero: '3.1', de: 'fichero', a: 'lector', mensaje: 'devolverTexto(texto)', retorno: true },
    { numero: '4', de: 'lector', a: 'diagrama', mensaje: 'aplicarOperaciones(operaciones)' },
    {
      numero: '5',
      de: 'lector',
      a: 'pantalla',
      mensaje: 'devolverResumen(clases, relaciones, avisos)',
      retorno: true,
    },
    { numero: '6', de: 'editor', a: 'pantalla', mensaje: 'pedirExportacion()' },
    { numero: '7', de: 'pantalla', a: 'escritor', mensaje: 'exportarXmi(diagrama)' },
    { numero: '8', de: 'escritor', a: 'pantalla', mensaje: 'devolverFichero(xmi)', retorno: true },
    { numero: '9', de: 'pantalla', a: 'editor', mensaje: 'descargarFichero(xmi)', retorno: true },
  ],
  alternativos: [
    {
      nombre: 'El fichero viene en windows-1252',
      texto:
        'Se decodifica con la codificación que el propio fichero declara. Leerlo todo como ' +
        'UTF-8 rompe los acentos y luego el nombre roto falla la lista blanca, con un aviso ' +
        'que además culpa al nombre.',
    },
    {
      nombre: 'El fichero no trae ninguna clase',
      texto:
        'Se dice qué se encontró en su lugar. Un componente o una instancia no son un fichero ' +
        'vacío: son otro dialecto del mismo formato.',
    },
    {
      nombre: 'Un nombre no pasa la lista blanca',
      texto:
        'Se descarta ese elemento y se dice cuál y por qué. Nunca se limpia quitando ' +
        'caracteres: eso convierte una inyección en un nombre inocente.',
    },
  ],
  actividad: {
    nodos: [
      { id: 'x0', tipo: 'inicio', calle: 'Editor' },
      { id: 'x1', tipo: 'accion', calle: 'Editor', texto: 'Elegir el fichero XMI a importar' },
      {
        id: 'x2',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Decodificarlo según la codificación que declara',
      },
      { id: 'x3', tipo: 'decision', calle: 'Sistema', texto: 'Trae alguna clase reconocible' },
      {
        id: 'x4',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Aplicar clases y relaciones al diagrama',
      },
      {
        id: 'x5',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Explicar qué se encontró en su lugar',
      },
      { id: 'x6', tipo: 'accion', calle: 'Sistema', texto: 'Exportar el diagrama a XMI' },
      { id: 'x7', tipo: 'fin', calle: 'Sistema' },
    ],
    flujos: [
      { de: 'x0', a: 'x1' },
      { de: 'x1', a: 'x2' },
      { de: 'x2', a: 'x3' },
      { de: 'x3', a: 'x4', guarda: 'Sí' },
      { de: 'x3', a: 'x5', guarda: 'No' },
      { de: 'x4', a: 'x6' },
      { de: 'x6', a: 'x7' },
      { de: 'x5', a: 'x7' },
    ],
  },
};

// ---------------------------------------------------------------------------
// CU11 — Editar el diagrama por voz
// ---------------------------------------------------------------------------

const cu11: CasoDeUso = {
  id: 'CU11',
  nombre: 'Editar el diagrama por voz',
  paquete: 'Edición del diagrama',
  actor: 'Editor',
  descripcion:
    'El editor dicta una orden —crear una clase, añadir un atributo, relacionar ' +
    'dos clases— y el sistema la traduce a operaciones sobre el diagrama.',
  precondicion: 'Hay micrófono y el modelo local de dictado está disponible.',
  postcondicion: 'La operación dictada queda aplicada, después de confirmarla.',
  participantes: [
    { alias: 'editor', clase: 'Editor', estereotipo: 'actor' },
    {
      alias: 'microfono',
      clase: 'EntradaDeVoz',
      estereotipo: 'boundary',
      origen: 'frontend/src/services/voz.ts',
    },
    {
      alias: 'dictado',
      clase: 'MotorDeDictado',
      estereotipo: 'control',
      origen: 'frontend/src/services/ollama.ts',
    },
    {
      alias: 'asistente',
      clase: 'Asistente',
      estereotipo: 'control',
      origen: 'backend-tool/src/ai/assistant.ts',
    },
    {
      alias: 'gramatica',
      clase: 'GramaticaDeOrdenes',
      estereotipo: 'entity',
      origen: 'shared/src/ai/grammar.ts',
    },
    {
      alias: 'documento',
      clase: 'DocumentoCompartido',
      estereotipo: 'control',
      origen: 'shared/src/crdt/document.ts',
    },
  ],
  pasos: [
    { numero: '1', de: 'editor', a: 'microfono', mensaje: 'dictarOrden(audio)' },
    { numero: '2', de: 'microfono', a: 'dictado', mensaje: 'transcribir(audio)' },
    { numero: '2.1', de: 'dictado', a: 'microfono', mensaje: 'devolverTexto(texto)', retorno: true },
    { numero: '3', de: 'microfono', a: 'asistente', mensaje: 'interpretar(texto, diagrama)' },
    { numero: '4', de: 'asistente', a: 'gramatica', mensaje: 'reconocer(texto)' },
    {
      numero: '4.1',
      de: 'gramatica',
      a: 'asistente',
      mensaje: 'devolverOperaciones(operaciones)',
      retorno: true,
    },
    {
      numero: '5',
      de: 'asistente',
      a: 'microfono',
      mensaje: 'proponerCambio(operaciones)',
      retorno: true,
    },
    { numero: '6', de: 'editor', a: 'microfono', mensaje: 'confirmarOrden(operaciones)' },
    { numero: '7', de: 'microfono', a: 'documento', mensaje: 'aplicarOperaciones(operaciones)' },
    { numero: '8', de: 'documento', a: 'editor', mensaje: 'mostrarDiagrama()', retorno: true },
  ],
  alternativos: [
    {
      nombre: 'La orden no se reconoce',
      texto:
        'Se dicen las palabras que la gramática sí entiende, en vez de responder que no se ' +
        'entendió. Un error que no enseña la salida obliga a adivinar.',
    },
    {
      nombre: 'La orden borra algo',
      texto: 'Se pide confirmación hablada antes de aplicarla. Lo destructivo no se ejecuta solo.',
    },
    {
      nombre: 'No hay conexión',
      texto:
        'El dictado sigue funcionando: el modelo corre en local, que es justo el motivo de ' +
        'haberlo puesto ahí.',
    },
  ],
  actividad: {
    nodos: [
      { id: 'v0', tipo: 'inicio', calle: 'Editor' },
      { id: 'v1', tipo: 'accion', calle: 'Editor', texto: 'Dictar la orden' },
      {
        id: 'v2',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Transcribir el audio con el modelo local',
      },
      { id: 'v3', tipo: 'decision', calle: 'Sistema', texto: 'La gramática reconoce la orden' },
      {
        id: 'v4',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Mostrar la operación propuesta para confirmarla',
      },
      {
        id: 'v5',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Enseñar las órdenes que sí se entienden',
      },
      { id: 'v6', tipo: 'accion', calle: 'Sistema', texto: 'Aplicar la operación al diagrama' },
      { id: 'v7', tipo: 'fin', calle: 'Sistema' },
    ],
    flujos: [
      { de: 'v0', a: 'v1' },
      { de: 'v1', a: 'v2' },
      { de: 'v2', a: 'v3' },
      { de: 'v3', a: 'v4', guarda: 'Sí' },
      { de: 'v3', a: 'v5', guarda: 'No' },
      { de: 'v4', a: 'v6' },
      { de: 'v6', a: 'v7' },
      { de: 'v5', a: 'v1' },
    ],
  },
};

// ---------------------------------------------------------------------------
// CU12 — Consultar la guía del proyecto
// ---------------------------------------------------------------------------

const cu12: CasoDeUso = {
  id: 'CU12',
  nombre: 'Consultar la guía del proyecto',
  paquete: 'Asistencia inteligente',
  actor: 'Usuario',
  descripcion:
    'El usuario pregunta en lenguaje natural y el sistema responde con lo que ' +
    'dice la documentación del proyecto, citando de qué documento sale.',
  precondicion: 'Ninguna: la guía se consulta también sin proyecto abierto.',
  postcondicion:
    'El usuario recibe una respuesta con sus fuentes, o un «no está en el manual» explícito.',
  participantes: [
    { alias: 'usuario', clase: 'Usuario', estereotipo: 'actor' },
    {
      alias: 'pantalla',
      clase: 'PantallaDeGuia',
      estereotipo: 'boundary',
      origen: 'frontend/src/components/Guia.tsx',
    },
    {
      alias: 'buscador',
      clase: 'BuscadorDeGuia',
      estereotipo: 'control',
      origen: 'shared/src/guia/buscar.ts',
    },
    {
      alias: 'corpus',
      clase: 'CorpusDeDocumentos',
      estereotipo: 'entity',
      origen: 'shared/src/guia/corpus.ts',
    },
    {
      alias: 'redactor',
      clase: 'RedactorDeRespuestas',
      estereotipo: 'control',
      origen: 'backend-tool/src/ai/guia.ts',
    },
  ],
  pasos: [
    { numero: '1', de: 'usuario', a: 'pantalla', mensaje: 'escribirPregunta(pregunta)' },
    { numero: '2', de: 'pantalla', a: 'buscador', mensaje: 'buscar(pregunta)' },
    { numero: '3', de: 'buscador', a: 'corpus', mensaje: 'recuperarFragmentos(pregunta)' },
    {
      numero: '3.1',
      de: 'corpus',
      a: 'buscador',
      mensaje: 'devolverFragmentos(fragmentos)',
      retorno: true,
    },
    {
      numero: '4',
      de: 'buscador',
      a: 'redactor',
      mensaje: 'redactarRespuesta(pregunta, fragmentos)',
    },
    {
      numero: '4.1',
      de: 'redactor',
      a: 'buscador',
      mensaje: 'devolverRespuesta(respuesta)',
      retorno: true,
    },
    {
      numero: '5',
      de: 'buscador',
      a: 'pantalla',
      mensaje: 'entregarRespuesta(respuesta, fuentes)',
      retorno: true,
    },
    {
      numero: '6',
      de: 'pantalla',
      a: 'usuario',
      mensaje: 'mostrarRespuesta(respuesta)',
      retorno: true,
    },
  ],
  alternativos: [
    {
      nombre: 'El manual no lo cubre',
      texto:
        'Se dice que no está, en vez de rellenar el hueco con lo que el modelo sepa de otros ' +
        'proyectos. Una respuesta plausible y falsa es la peor de las dos.',
    },
    {
      nombre: 'Se añade un documento nuevo',
      texto:
        'No hay que registrarlo en ningún sitio: un `.md` en `docs/` entra en el corpus solo, ' +
        'tanto en el servidor como en el navegador.',
    },
  ],
  actividad: {
    nodos: [
      { id: 'g0', tipo: 'inicio', calle: 'Usuario' },
      { id: 'g1', tipo: 'accion', calle: 'Usuario', texto: 'Escribir la pregunta' },
      {
        id: 'g2',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Buscar los fragmentos del manual que responden',
      },
      { id: 'g3', tipo: 'decision', calle: 'Sistema', texto: 'Hay algún fragmento que responda' },
      {
        id: 'g4',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Redactar la respuesta citando su documento',
      },
      {
        id: 'g5',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Decir que el manual no lo cubre',
      },
      { id: 'g6', tipo: 'fin', calle: 'Sistema' },
    ],
    flujos: [
      { de: 'g0', a: 'g1' },
      { de: 'g1', a: 'g2' },
      { de: 'g2', a: 'g3' },
      { de: 'g3', a: 'g4', guarda: 'Sí' },
      { de: 'g3', a: 'g5', guarda: 'No' },
      { de: 'g4', a: 'g6' },
      { de: 'g5', a: 'g6' },
    ],
  },
};

// ---------------------------------------------------------------------------
// CU13 — Generar el backend Spring Boot
// ---------------------------------------------------------------------------

const cu13: CasoDeUso = {
  id: 'CU13',
  nombre: 'Generar el backend Spring Boot',
  paquete: 'Generación de código',
  actor: 'Propietario',
  descripcion:
    'El diagrama de clases se convierte en un proyecto Spring Boot con sus cuatro ' +
    'capas —entidad, repositorio, servicio y controlador— listo para compilar.',
  precondicion: 'El diagrama tiene al menos una clase y pasa la validación del modelo.',
  postcondicion: 'El propietario se descarga un proyecto Maven que compila.',
  participantes: [
    { alias: 'propietario', clase: 'Propietario', estereotipo: 'actor' },
    {
      alias: 'pantalla',
      clase: 'PantallaDeGeneracion',
      estereotipo: 'boundary',
      origen: 'frontend/src/components/EditorDiagrama.tsx',
    },
    {
      alias: 'validador',
      clase: 'ValidadorDelModelo',
      estereotipo: 'control',
      origen: 'backend-tool/src/api/generation.ts',
    },
    {
      alias: 'diagrama',
      clase: 'Diagrama',
      estereotipo: 'entity',
      origen: 'shared/src/model/uml.ts',
    },
    {
      alias: 'generador',
      clase: 'GeneradorDeCodigo',
      estereotipo: 'control',
      origen: 'backend-tool/src/architech/client.ts',
    },
    {
      alias: 'proyecto',
      clase: 'ProyectoSpringBoot',
      estereotipo: 'entity',
      origen: 'backend-tool/src/architech/client.ts',
    },
  ],
  pasos: [
    { numero: '1', de: 'propietario', a: 'pantalla', mensaje: 'pedirGeneracion(opciones)' },
    { numero: '2', de: 'pantalla', a: 'validador', mensaje: 'validarModelo(diagrama)' },
    { numero: '3', de: 'validador', a: 'diagrama', mensaje: 'revisarClases()' },
    {
      numero: '3.1',
      de: 'diagrama',
      a: 'validador',
      mensaje: 'devolverProblemas(problemas)',
      retorno: true,
    },
    {
      numero: '4',
      de: 'validador',
      a: 'pantalla',
      mensaje: 'mostrarValidacion(problemas)',
      retorno: true,
    },
    { numero: '5', de: 'pantalla', a: 'generador', mensaje: 'generarProyecto(diagrama, opciones)' },
    {
      numero: '6',
      de: 'generador',
      a: 'proyecto',
      mensaje: 'escribirCapas(entidad, repositorio, servicio, controlador)',
    },
    { numero: '7', de: 'generador', a: 'pantalla', mensaje: 'devolverZip(zip)', retorno: true },
    {
      numero: '8',
      de: 'pantalla',
      a: 'propietario',
      mensaje: 'descargarZip(zip)',
      retorno: true,
    },
  ],
  alternativos: [
    {
      nombre: 'El modelo no valida',
      texto:
        'No se genera nada y se listan todos los problemas de una vez. Ir arreglándolos de uno ' +
        'en uno es media tarde de regenerar y volver a mirar.',
    },
    {
      nombre: 'Un nombre de clase no sirve como identificador Java',
      texto:
        'Se rechaza diciendo cuál. Todo nombre que venga de un diagrama —o de un OCR, o de un ' +
        'XMI ajeno— es entrada no fiable antes de ser un nombre de fichero o de paquete.',
    },
  ],
  actividad: {
    nodos: [
      { id: 's0', tipo: 'inicio', calle: 'Propietario' },
      { id: 's1', tipo: 'accion', calle: 'Propietario', texto: 'Pedir la generación del backend' },
      {
        id: 's2',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Validar nombres, tipos y relaciones del diagrama',
      },
      { id: 's3', tipo: 'decision', calle: 'Sistema', texto: 'El modelo pasa la validación' },
      {
        id: 's4',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Generar las cuatro capas de cada clase',
      },
      { id: 's5', tipo: 'accion', calle: 'Sistema', texto: 'Listar los problemas sin generar nada' },
      { id: 's6', tipo: 'accion', calle: 'Sistema', texto: 'Entregar el proyecto comprimido' },
      { id: 's7', tipo: 'fin', calle: 'Sistema' },
    ],
    flujos: [
      { de: 's0', a: 's1' },
      { de: 's1', a: 's2' },
      { de: 's2', a: 's3' },
      { de: 's3', a: 's4', guarda: 'Sí' },
      { de: 's3', a: 's5', guarda: 'No' },
      { de: 's4', a: 's6' },
      { de: 's6', a: 's7' },
      { de: 's5', a: 's1' },
    ],
  },
};

// ---------------------------------------------------------------------------
// CU14 — Consultar el historial de cambios
// ---------------------------------------------------------------------------

const cu14: CasoDeUso = {
  id: 'CU14',
  nombre: 'Consultar el historial de cambios',
  paquete: 'Edición del diagrama',
  actor: 'Usuario',
  otrosActores: ['Lector'],
  descripcion:
    'El usuario ve qué se ha cambiado en el diagrama, quién lo cambió y cuándo, ' +
    'y puede volver a un punto anterior.',
  precondicion: 'El proyecto está abierto.',
  postcondicion:
    'El usuario ha visto la lista de cambios y, si lo pidió, el diagrama ha vuelto a un punto anterior.',
  participantes: [
    { alias: 'usuario', clase: 'Usuario', estereotipo: 'actor' },
    {
      alias: 'panel',
      clase: 'PanelDeHistorial',
      estereotipo: 'boundary',
      origen: 'frontend/src/components/HistorialCambios.tsx',
    },
    {
      alias: 'historial',
      clase: 'HistorialDeCambios',
      estereotipo: 'control',
      origen: 'shared/src/crdt/historial.ts',
    },
    {
      alias: 'documento',
      clase: 'DocumentoCompartido',
      estereotipo: 'control',
      origen: 'shared/src/crdt/document.ts',
    },
    {
      alias: 'entrada',
      clase: 'EntradaDeHistorial',
      estereotipo: 'entity',
      origen: 'shared/src/crdt/historial.ts',
    },
  ],
  pasos: [
    { numero: '1', de: 'usuario', a: 'panel', mensaje: 'abrirHistorial()' },
    { numero: '2', de: 'panel', a: 'historial', mensaje: 'listarCambios(proyecto)' },
    { numero: '3', de: 'historial', a: 'documento', mensaje: 'leerOperaciones()' },
    {
      numero: '3.1',
      de: 'documento',
      a: 'historial',
      mensaje: 'devolverOperaciones(operaciones)',
      retorno: true,
    },
    { numero: '4', de: 'historial', a: 'entrada', mensaje: 'describir(operacion, autor, momento)' },
    {
      numero: '5',
      de: 'historial',
      a: 'panel',
      mensaje: 'devolverEntradas(entradas)',
      retorno: true,
    },
    { numero: '6', de: 'usuario', a: 'panel', mensaje: 'elegirEntrada(entrada)' },
    { numero: '7', de: 'panel', a: 'documento', mensaje: 'deshacerHasta(entrada)' },
    {
      numero: '8',
      de: 'documento',
      a: 'panel',
      mensaje: 'devolverDiagrama(diagrama)',
      retorno: true,
    },
    { numero: '9', de: 'panel', a: 'usuario', mensaje: 'mostrarDiagrama(diagrama)', retorno: true },
  ],
  alternativos: [
    {
      nombre: 'El usuario solo mira',
      texto: 'Cierra el panel y el diagrama queda como estaba: consultar no cambia nada.',
    },
    {
      nombre: 'Volver atrás con otros editando',
      texto:
        'Deshacer es una operación más del documento compartido, así que se reparte y se funde ' +
        'igual que cualquier otra. No hay una copia local que se quede desalineada.',
    },
  ],
  actividad: {
    nodos: [
      { id: 'h0', tipo: 'inicio', calle: 'Usuario' },
      { id: 'h1', tipo: 'accion', calle: 'Usuario', texto: 'Abrir el panel de historial' },
      {
        id: 'h2',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Listar los cambios con su autor y su momento',
      },
      { id: 'h3', tipo: 'decision', calle: 'Usuario', texto: 'Quiere volver a un punto anterior' },
      { id: 'h4', tipo: 'accion', calle: 'Sistema', texto: 'Deshacer hasta la entrada elegida' },
      {
        id: 'h5',
        tipo: 'accion',
        calle: 'Sistema',
        texto: 'Cerrar el panel sin tocar el diagrama',
      },
      { id: 'h6', tipo: 'fin', calle: 'Sistema' },
    ],
    flujos: [
      { de: 'h0', a: 'h1' },
      { de: 'h1', a: 'h2' },
      { de: 'h2', a: 'h3' },
      { de: 'h3', a: 'h4', guarda: 'Sí' },
      { de: 'h3', a: 'h5', guarda: 'No' },
      { de: 'h4', a: 'h6' },
      { de: 'h5', a: 'h6' },
    ],
  },
};

// ---------------------------------------------------------------------------

/**
 * El modelo completo.
 *
 * Los actores heredan de `Usuario` porque los tres papeles del proyecto hacen
 * todo lo que hace un usuario cualquiera —entrar, mirar su lista, consultar la
 * guía— y además lo suyo. Dibujar la herencia evita repetir esas asociaciones
 * tres veces en el diagrama general.
 *
 * `Operador del servidor` queda fuera de esa jerarquía a propósito: no tiene
 * cuenta en la aplicación. Es quien tiene acceso a la máquina, y el único caso de
 * uso que le toca es el que se ejecuta por consola.
 */
export const modeloDeCasosDeUso: ModeloDeCasosDeUso = {
  sistema: 'Editor UML colaborativo',
  actores: [
    {
      nombre: 'Usuario',
      descripcion:
        'Cualquiera con cuenta. Entra, ve sus proyectos y consulta la guía. Es el padre de los ' +
        'tres papeles.',
    },
    {
      nombre: 'Propietario',
      hereda: 'Usuario',
      descripcion: 'Creó el proyecto. Reparte los permisos y pide la generación del backend.',
    },
    {
      nombre: 'Editor',
      hereda: 'Usuario',
      descripcion: 'Dibuja, importa y dicta. Puede todo sobre el diagrama menos repartir permisos.',
    },
    {
      nombre: 'Lector',
      hereda: 'Usuario',
      descripcion: 'Ve el diagrama y su historial, sin poder cambiarlo.',
    },
    {
      nombre: 'Operador del servidor',
      descripcion:
        'Tiene acceso a la máquina donde corre la aplicación. No tiene cuenta: actúa por consola.',
    },
  ],
  paquetes: [
    {
      nombre: 'Acceso y cuentas',
      descripcion: 'Alta, entrada y recuperación de la contraseña.',
    },
    {
      nombre: 'Proyectos y colaboración',
      descripcion: 'Crear y abrir proyectos, y repartir los papeles sobre ellos.',
    },
    {
      nombre: 'Edición del diagrama',
      descripcion:
        'Todo lo que cambia el diagrama: el lienzo compartido, la voz, el XMI y el historial.',
    },
    {
      nombre: 'Asistencia inteligente',
      descripcion: 'Lo que hacen los modelos: leer una foto y responder desde el manual.',
    },
    {
      nombre: 'Generación de código',
      descripcion: 'Convertir el diagrama en un proyecto Spring Boot que compila.',
    },
  ],
  casos: [cu1, cu2, cu3, cu4, cu5, cu6, cu7, cu8, cu9, cu10, cu11, cu12, cu13, cu14],
};

/** Un caso por su identificador, para las órdenes que generan solo uno. */
export function casoPorId(id: string): CasoDeUso | undefined {
  return modeloDeCasosDeUso.casos.find((caso) => caso.id === id);
}
