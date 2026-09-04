# Casos de uso de Editor UML colaborativo

> Este documento **se genera**. Sale de `shared/src/xmi/casos-de-uso.ts`, que es también
> de donde salen los `.xmi` de `docs/uml/`. Para cambiar algo se cambia allí y se ejecuta
> `npm run diagramas --workspace @app/backend-tool`; lo que se escriba aquí a mano se
> pierde en la siguiente ejecución.

Cada caso de uso se describe una sola vez. De esa descripción salen el diagrama de
comunicación, el de secuencia, el de actividad y el de análisis de clases, que son la
misma información contada de cuatro maneras. Mantenerlos a mano es mantener cuatro
copias que se desincronizan, y el sitio donde se nota es la defensa.

## Actores

| Actor | Hereda de | Qué es |
| --- | --- | --- |
| Usuario | — | Cualquiera con cuenta. Entra, ve sus proyectos y consulta la guía. Es el padre de los tres papeles. |
| Propietario | Usuario | Creó el proyecto. Reparte los permisos y pide la generación del backend. |
| Editor | Usuario | Dibuja, importa y dicta. Puede todo sobre el diagrama menos repartir permisos. |
| Lector | Usuario | Ve el diagrama y su historial, sin poder cambiarlo. |
| Operador del servidor | — | Tiene acceso a la máquina donde corre la aplicación. No tiene cuenta: actúa por consola. |

## Paquetes

| Paquete | Qué agrupa | Casos |
| --- | --- | --- |
| Acceso y cuentas | Alta, entrada y recuperación de la contraseña. | CU1, CU2, CU3, CU4 |
| Proyectos y colaboración | Crear y abrir proyectos, y repartir los papeles sobre ellos. | CU5, CU6, CU7 |
| Edición del diagrama | Todo lo que cambia el diagrama: el lienzo compartido, la voz, el XMI y el historial. | CU8, CU10, CU11, CU14 |
| Asistencia inteligente | Lo que hacen los modelos: leer una foto y responder desde el manual. | CU9, CU12 |
| Generación de código | Convertir el diagrama en un proyecto Spring Boot que compila. | CU13 |

## Resumen

| Caso | Nombre | Actor | Paquete |
| --- | --- | --- | --- |
| CU1 | Iniciar sesión | Usuario | Acceso y cuentas |
| CU2 | Registrar cuenta | Usuario | Acceso y cuentas |
| CU3 | Recuperar la contraseña | Usuario | Acceso y cuentas |
| CU4 | Emitir un código de recuperación desde el servidor | Operador del servidor | Acceso y cuentas |
| CU5 | Crear un proyecto | Usuario | Proyectos y colaboración |
| CU6 | Abrir un proyecto | Usuario | Proyectos y colaboración |
| CU7 | Invitar a un colaborador | Propietario | Proyectos y colaboración |
| CU8 | Editar el diagrama en tiempo real | Editor | Edición del diagrama |
| CU9 | Importar un diagrama desde una foto | Editor | Asistencia inteligente |
| CU10 | Importar y exportar XMI | Editor | Edición del diagrama |
| CU11 | Editar el diagrama por voz | Editor | Edición del diagrama |
| CU12 | Consultar la guía del proyecto | Usuario | Asistencia inteligente |
| CU13 | Generar el backend Spring Boot | Propietario | Generación de código |
| CU14 | Consultar el historial de cambios | Usuario | Edición del diagrama |

## CU1 — Iniciar sesión

El usuario entra al sistema con su correo y su contraseña, y recibe una sesión firmada con la que el resto de peticiones se identifican.

| Ficha |  |
| --- | --- |
| **Paquete** | Acceso y cuentas |
| **Actores** | Usuario |
| **Precondición** | La cuenta existe y no está bloqueada. |
| **Postcondición** | El navegador guarda una sesión firmada y vigente, y se muestra la lista de proyectos. |

### Participantes

| Objeto | Clase de análisis | Estereotipo | De dónde sale |
| --- | --- | --- | --- |
| `usuario` | Usuario | actor | — |
| `pantalla` | PantallaAcceso | «boundary» | `frontend/src/components/PantallaAcceso.tsx` |
| `gestor` | GestorDeAcceso | «control» | `backend-tool/src/api/auth.ts` |
| `identidades` | RepositorioDeIdentidades | «entity» | `backend-tool/src/auth/identity.ts` |
| `sesion` | SesionFirmada | «entity» | `backend-tool/src/auth/identity.ts` |

### Flujo principal

| # | De | A | Mensaje |
| --- | --- | --- | --- |
| 1 | `usuario` | `pantalla` | `escribirCredenciales(correo, clave)` |
| 2 | `pantalla` | `gestor` | `acceder(correo, clave)` |
| 3 | `gestor` | `identidades` | `buscarPorCorreo(correo)` |
| 3.1 | `identidades` | `gestor` | *devolverCuenta(cuenta)* (retorno) |
| 4 | `gestor` | `identidades` | `comprobarClave(clave)` |
| 4.1 | `identidades` | `gestor` | *confirmarCredencial(valida)* (retorno) |
| 5 | `gestor` | `sesion` | `firmar(cuenta, caducidad)` |
| 5.1 | `sesion` | `gestor` | *devolverTestigo(testigo)* (retorno) |
| 6 | `gestor` | `pantalla` | *entregarSesion(testigo)* (retorno) |
| 7 | `pantalla` | `usuario` | *abrirListaDeProyectos()* (retorno) |

### Flujos alternativos

- **Credenciales incorrectas.** El sistema responde con el mismo mensaje tanto si el correo no existe como si la contraseña no coincide, para no revelar qué correos están dados de alta.
- **Contraseña cambiada en otro dispositivo.** La marca de credencial de la sesión ya no coincide y la sesión se rechaza: hay que volver a entrar.

### Operaciones que salen del análisis

- **PantallaAcceso**: `escribirCredenciales(correo, clave)`
- **GestorDeAcceso**: `acceder(correo, clave)`
- **RepositorioDeIdentidades**: `buscarPorCorreo(correo)`, `comprobarClave(clave)`
- **SesionFirmada**: `firmar(cuenta, caducidad)`

### Actividad

Calles: **Usuario** · **Sistema**.

- (inicio) → Abrir la pantalla de acceso
- Abrir la pantalla de acceso → Escribir el correo y la contraseña
- Escribir el correo y la contraseña → Comprobar las credenciales
- Comprobar las credenciales → ¿Credenciales válidas?
- ¿Credenciales válidas? → **[Sí]** Firmar la sesión y abrir la lista de proyectos
- ¿Credenciales válidas? → **[No]** Rechazar el acceso sin dar detalles
- Firmar la sesión y abrir la lista de proyectos → (fin)
- Rechazar el acceso sin dar detalles → Escribir el correo y la contraseña

Enlaces del diagrama de comunicación: 4 entre 5 objetos.

## CU2 — Registrar cuenta

Alguien sin cuenta se da de alta con nombre, correo y contraseña, y entra directamente sin tener que iniciar sesión aparte.

| Ficha |  |
| --- | --- |
| **Paquete** | Acceso y cuentas |
| **Actores** | Usuario |
| **Precondición** | No hay ninguna cuenta con ese correo. |
| **Postcondición** | La cuenta queda guardada con la contraseña resumida y el usuario entra. |

### Participantes

| Objeto | Clase de análisis | Estereotipo | De dónde sale |
| --- | --- | --- | --- |
| `usuario` | Usuario | actor | — |
| `pantalla` | PantallaAcceso | «boundary» | `frontend/src/components/PantallaAcceso.tsx` |
| `gestor` | GestorDeAcceso | «control» | `backend-tool/src/api/auth.ts` |
| `identidades` | RepositorioDeIdentidades | «entity» | `backend-tool/src/auth/identity.ts` |
| `cuenta` | Cuenta | «entity» | `backend-tool/src/auth/identity.ts` |

### Flujo principal

| # | De | A | Mensaje |
| --- | --- | --- | --- |
| 1 | `usuario` | `pantalla` | `rellenarRegistro(nombre, correo, clave)` |
| 2 | `pantalla` | `gestor` | `registrar(nombre, correo, clave)` |
| 3 | `gestor` | `identidades` | `comprobarCorreoLibre(correo)` |
| 3.1 | `identidades` | `gestor` | *confirmarDisponible(libre)* (retorno) |
| 4 | `gestor` | `cuenta` | `crear(nombre, correo, resumen)` |
| 5 | `gestor` | `identidades` | `guardar(cuenta)` |
| 6 | `gestor` | `pantalla` | *entregarSesion(testigo)* (retorno) |
| 7 | `pantalla` | `usuario` | *abrirListaDeProyectos()* (retorno) |

### Flujos alternativos

- **Correo ya registrado.** No se crea nada y se pide iniciar sesión o recuperar la contraseña.
- **Contraseña demasiado corta.** La comprobación de longitud se hace en el servidor además de en el navegador: el formulario no es la validación, es la comodidad.

### Operaciones que salen del análisis

- **PantallaAcceso**: `rellenarRegistro(nombre, correo, clave)`
- **GestorDeAcceso**: `registrar(nombre, correo, clave)`
- **RepositorioDeIdentidades**: `comprobarCorreoLibre(correo)`, `guardar(cuenta)`
- **Cuenta**: `crear(nombre, correo, resumen)`

### Actividad

Calles: **Usuario** · **Sistema**.

- (inicio) → Rellenar el formulario de registro
- Rellenar el formulario de registro → Validar el formato del correo y la contraseña
- Validar el formato del correo y la contraseña → ¿El correo está libre?
- ¿El correo está libre? → **[Sí]** Crear la cuenta y firmar la sesión
- ¿El correo está libre? → **[No]** Avisar de que ese correo ya tiene cuenta
- Crear la cuenta y firmar la sesión → (fin)
- Avisar de que ese correo ya tiene cuenta → Rellenar el formulario de registro

Enlaces del diagrama de comunicación: 4 entre 5 objetos.

## CU3 — Recuperar la contraseña

El usuario que no recuerda su contraseña pide un código de un solo uso y, con él, fija una contraseña nueva.

| Ficha |  |
| --- | --- |
| **Paquete** | Acceso y cuentas |
| **Actores** | Usuario |
| **Precondición** | La cuenta existe. |
| **Postcondición** | La contraseña queda cambiada, el código se consume y las sesiones antiguas dejan de valer. |

### Participantes

| Objeto | Clase de análisis | Estereotipo | De dónde sale |
| --- | --- | --- | --- |
| `usuario` | Usuario | actor | — |
| `pantalla` | PantallaRecuperacion | «boundary» | `frontend/src/components/CodigoRecuperacion.tsx` |
| `gestor` | GestorDeRecuperacion | «control» | `backend-tool/src/api/auth.ts` |
| `identidades` | RepositorioDeIdentidades | «entity» | `backend-tool/src/auth/identity.ts` |
| `codigo` | CodigoDeRecuperacion | «entity» | `backend-tool/src/auth/identity.ts` |

### Flujo principal

| # | De | A | Mensaje |
| --- | --- | --- | --- |
| 1 | `usuario` | `pantalla` | `escribirCorreo(correo)` |
| 2 | `pantalla` | `gestor` | `pedirCodigo(correo)` |
| 3 | `gestor` | `identidades` | `buscarPorCorreo(correo)` |
| 3.1 | `identidades` | `gestor` | *devolverCuenta(cuenta)* (retorno) |
| 4 | `gestor` | `codigo` | `generar(cuenta, caducidad)` |
| 5 | `usuario` | `pantalla` | `escribirCodigo(codigo, claveNueva)` |
| 6 | `pantalla` | `gestor` | `cambiarClave(codigo, claveNueva)` |
| 7 | `gestor` | `codigo` | `comprobarVigencia(codigo)` |
| 7.1 | `codigo` | `gestor` | *confirmarVigente(vigente)* (retorno) |
| 8 | `gestor` | `identidades` | `guardarClave(cuenta, claveNueva)` |
| 9 | `gestor` | `pantalla` | *confirmarCambio()* (retorno) |

### Flujos alternativos

- **Correo desconocido.** La respuesta es la misma que si existiera. Decir «ese correo no está registrado» convierte esta pantalla en un comprobador de correos ajenos.
- **Código caducado o ya usado.** Se rechaza el cambio y hay que pedir otro código.

### Operaciones que salen del análisis

- **PantallaRecuperacion**: `escribirCorreo(correo)`, `escribirCodigo(codigo, claveNueva)`
- **GestorDeRecuperacion**: `pedirCodigo(correo)`, `cambiarClave(codigo, claveNueva)`
- **RepositorioDeIdentidades**: `buscarPorCorreo(correo)`, `guardarClave(cuenta, claveNueva)`
- **CodigoDeRecuperacion**: `generar(cuenta, caducidad)`, `comprobarVigencia(codigo)`

### Actividad

Calles: **Usuario** · **Sistema**.

- (inicio) → Pedir el código con el correo de la cuenta
- Pedir el código con el correo de la cuenta → Emitir un código con caducidad
- Emitir un código con caducidad → Escribir el código y la contraseña nueva
- Escribir el código y la contraseña nueva → ¿El código sigue vigente?
- ¿El código sigue vigente? → **[Sí]** Guardar la contraseña y revocar las sesiones antiguas
- ¿El código sigue vigente? → **[No]** Avisar de que el código ya no vale
- Guardar la contraseña y revocar las sesiones antiguas → (fin)
- Avisar de que el código ya no vale → Pedir el código con el correo de la cuenta

Enlaces del diagrama de comunicación: 4 entre 5 objetos.

## CU4 — Emitir un código de recuperación desde el servidor

Mientras no haya correo saliente, el código lo emite el operador con una orden de consola y se lo hace llegar al usuario por otro medio.

| Ficha |  |
| --- | --- |
| **Paquete** | Acceso y cuentas |
| **Actores** | Operador del servidor |
| **Precondición** | El operador tiene acceso al servidor y la cuenta existe. |
| **Postcondición** | El código queda guardado con su caducidad e impreso una sola vez por consola. |

### Participantes

| Objeto | Clase de análisis | Estereotipo | De dónde sale |
| --- | --- | --- | --- |
| `operador` | OperadorDelServidor | actor | `backend-tool/src/recuperar.ts` |
| `consola` | ConsolaDeRecuperacion | «boundary» | `backend-tool/src/recuperar.ts` |
| `gestor` | GestorDeRecuperacion | «control» | `backend-tool/src/auth/identity.ts` |
| `identidades` | RepositorioDeIdentidades | «entity» | `backend-tool/src/auth/identity.ts` |
| `codigo` | CodigoDeRecuperacion | «entity» | `backend-tool/src/auth/identity.ts` |

### Flujo principal

| # | De | A | Mensaje |
| --- | --- | --- | --- |
| 1 | `operador` | `consola` | `ejecutarOrden(correo)` |
| 2 | `consola` | `identidades` | `buscarPorCorreo(correo)` |
| 2.1 | `identidades` | `consola` | *devolverCuenta(cuenta)* (retorno) |
| 3 | `consola` | `gestor` | `emitirCodigo(cuenta)` |
| 4 | `gestor` | `codigo` | `generar(cuenta, caducidad)` |
| 5 | `gestor` | `identidades` | `guardarCodigo(cuenta, codigo)` |
| 6 | `gestor` | `consola` | *devolverCodigo(codigo)* (retorno) |
| 7 | `consola` | `operador` | *imprimirCodigo(codigo)* (retorno) |

### Flujos alternativos

- **La cuenta no existe.** La orden termina con error y no emite nada. Aquí sí se dice el motivo: quien ejecuta la orden ya está dentro del servidor y ocultárselo solo estorba.

### Operaciones que salen del análisis

- **ConsolaDeRecuperacion**: `ejecutarOrden(correo)`
- **GestorDeRecuperacion**: `emitirCodigo(cuenta)`
- **RepositorioDeIdentidades**: `buscarPorCorreo(correo)`, `guardarCodigo(cuenta, codigo)`
- **CodigoDeRecuperacion**: `generar(cuenta, caducidad)`

### Actividad

Calles: **Operador** · **Sistema**.

- (inicio) → Ejecutar la orden con el correo de la cuenta
- Ejecutar la orden con el correo de la cuenta → ¿Existe la cuenta?
- ¿Existe la cuenta? → **[Sí]** Emitir el código y guardarlo con su caducidad
- ¿Existe la cuenta? → **[No]** Terminar con error sin emitir nada
- Emitir el código y guardarlo con su caducidad → Imprimir el código por la salida estándar
- Imprimir el código por la salida estándar → (fin)
- Terminar con error sin emitir nada → (fin)

Enlaces del diagrama de comunicación: 5 entre 5 objetos.

## CU5 — Crear un proyecto

El usuario crea un proyecto vacío, del que queda como propietario, y el sistema le prepara el documento compartido en el que se editará el diagrama.

| Ficha |  |
| --- | --- |
| **Paquete** | Proyectos y colaboración |
| **Actores** | Usuario |
| **Precondición** | Hay una sesión iniciada. |
| **Postcondición** | El proyecto existe con el usuario como propietario y con un documento de diagrama vacío. |

### Participantes

| Objeto | Clase de análisis | Estereotipo | De dónde sale |
| --- | --- | --- | --- |
| `usuario` | Usuario | actor | — |
| `lista` | ListaDeProyectos | «boundary» | `frontend/src/components/ListaProyectos.tsx` |
| `gestor` | GestorDeProyectos | «control» | `backend-tool/src/api/projects.ts` |
| `proyecto` | Proyecto | «entity» | `backend-tool/src/storage/store.ts` |
| `almacen` | AlmacenDeProyectos | «entity» | `backend-tool/src/storage/store.ts` |
| `documento` | DocumentoDelDiagrama | «entity» | `backend-tool/src/storage/documents.ts` |

### Flujo principal

| # | De | A | Mensaje |
| --- | --- | --- | --- |
| 1 | `usuario` | `lista` | `pulsarNuevoProyecto(nombre)` |
| 2 | `lista` | `gestor` | `crearProyecto(nombre)` |
| 3 | `gestor` | `proyecto` | `crear(nombre, propietario)` |
| 4 | `gestor` | `almacen` | `guardar(proyecto)` |
| 5 | `gestor` | `documento` | `inicializar(proyecto)` |
| 6 | `gestor` | `lista` | *devolverProyecto(proyecto)* (retorno) |
| 7 | `lista` | `usuario` | *abrirEditor(proyecto)* (retorno) |

### Flujos alternativos

- **Nombre vacío o demasiado largo.** No se crea nada y se dice qué límite se pasó, no solo que el nombre no vale.

### Operaciones que salen del análisis

- **ListaDeProyectos**: `pulsarNuevoProyecto(nombre)`
- **GestorDeProyectos**: `crearProyecto(nombre)`
- **Proyecto**: `crear(nombre, propietario)`
- **AlmacenDeProyectos**: `guardar(proyecto)`
- **DocumentoDelDiagrama**: `inicializar(proyecto)`

### Actividad

Calles: **Usuario** · **Sistema**.

- (inicio) → Pulsar Nuevo proyecto y escribir el nombre
- Pulsar Nuevo proyecto y escribir el nombre → ¿El nombre es válido?
- ¿El nombre es válido? → **[Sí]** Crear el proyecto con el usuario como propietario
- ¿El nombre es válido? → **[No]** Explicar por qué el nombre no vale
- Crear el proyecto con el usuario como propietario → Abrir el editor con el diagrama vacío
- Abrir el editor con el diagrama vacío → (fin)
- Explicar por qué el nombre no vale → Pulsar Nuevo proyecto y escribir el nombre

Enlaces del diagrama de comunicación: 5 entre 6 objetos.

## CU6 — Abrir un proyecto

El usuario elige un proyecto de su lista y el sistema abre el editor con el diagrama cargado y con los permisos que le corresponden por su papel.

| Ficha |  |
| --- | --- |
| **Paquete** | Proyectos y colaboración |
| **Actores** | Usuario, Lector |
| **Precondición** | El usuario es propietario, editor o lector del proyecto. |
| **Postcondición** | El editor muestra el diagrama, en modo edición o en solo lectura. |

### Participantes

| Objeto | Clase de análisis | Estereotipo | De dónde sale |
| --- | --- | --- | --- |
| `usuario` | Usuario | actor | — |
| `lista` | ListaDeProyectos | «boundary» | `frontend/src/components/ListaProyectos.tsx` |
| `gestor` | GestorDeProyectos | «control» | `backend-tool/src/api/projects.ts` |
| `almacen` | AlmacenDeProyectos | «entity» | `backend-tool/src/storage/store.ts` |
| `permisos` | ControlDePermisos | «control» | `backend-tool/src/storage/store.ts` |
| `editor` | EditorDeDiagrama | «boundary» | `frontend/src/components/EditorDiagrama.tsx` |

### Flujo principal

| # | De | A | Mensaje |
| --- | --- | --- | --- |
| 1 | `usuario` | `lista` | `elegirProyecto(proyectoId)` |
| 2 | `lista` | `gestor` | `abrirProyecto(proyectoId)` |
| 3 | `gestor` | `almacen` | `leer(proyectoId)` |
| 3.1 | `almacen` | `gestor` | *devolverProyecto(proyecto)* (retorno) |
| 4 | `gestor` | `permisos` | `comprobarPapel(cuenta, proyecto)` |
| 4.1 | `permisos` | `gestor` | *confirmarPermiso(papel)* (retorno) |
| 5 | `gestor` | `lista` | *devolverDiagrama(diagrama)* (retorno) |
| 6 | `lista` | `editor` | `mostrarDiagrama(diagrama, papel)` |
| 7 | `editor` | `usuario` | *dibujarLienzo()* (retorno) |

### Flujos alternativos

- **El usuario no es miembro.** Se niega el acceso y se vuelve a la lista, sin decir si el proyecto existe.
- **El papel es de lector.** El editor se abre en solo lectura: se ve y se navega, pero las herramientas no.

### Operaciones que salen del análisis

- **ListaDeProyectos**: `elegirProyecto(proyectoId)`
- **GestorDeProyectos**: `abrirProyecto(proyectoId)`
- **AlmacenDeProyectos**: `leer(proyectoId)`
- **ControlDePermisos**: `comprobarPapel(cuenta, proyecto)`
- **EditorDeDiagrama**: `mostrarDiagrama(diagrama, papel)`

### Actividad

Calles: **Usuario** · **Sistema**.

- (inicio) → Elegir un proyecto de la lista
- Elegir un proyecto de la lista → Leer el proyecto y el papel del usuario
- Leer el proyecto y el papel del usuario → ¿Es miembro del proyecto?
- ¿Es miembro del proyecto? → **[Sí]** Abrir el editor con el diagrama cargado
- ¿Es miembro del proyecto? → **[No]** Negar el acceso y volver a la lista
- Abrir el editor con el diagrama cargado → (fin)
- Negar el acceso y volver a la lista → Elegir un proyecto de la lista

Enlaces del diagrama de comunicación: 6 entre 6 objetos.

## CU7 — Invitar a un colaborador

El propietario añade a otra cuenta al proyecto con el papel de editor o de lector, y puede quitarla después.

| Ficha |  |
| --- | --- |
| **Paquete** | Proyectos y colaboración |
| **Actores** | Propietario |
| **Precondición** | El usuario es propietario del proyecto y existe una cuenta con ese correo. |
| **Postcondición** | La cuenta invitada aparece entre los miembros con el papel elegido. |

### Participantes

| Objeto | Clase de análisis | Estereotipo | De dónde sale |
| --- | --- | --- | --- |
| `propietario` | Propietario | actor | — |
| `panel` | PanelDeMiembros | «boundary» | `frontend/src/components/ListaProyectos.tsx` |
| `gestor` | GestorDeMiembros | «control» | `backend-tool/src/api/projects.ts` |
| `identidades` | RepositorioDeIdentidades | «entity» | `backend-tool/src/auth/identity.ts` |
| `miembro` | Miembro | «entity» | `backend-tool/src/storage/store.ts` |
| `almacen` | AlmacenDeProyectos | «entity» | `backend-tool/src/storage/store.ts` |

### Flujo principal

| # | De | A | Mensaje |
| --- | --- | --- | --- |
| 1 | `propietario` | `panel` | `escribirInvitacion(correo, papel)` |
| 2 | `panel` | `gestor` | `invitar(proyectoId, correo, papel)` |
| 3 | `gestor` | `identidades` | `buscarPorCorreo(correo)` |
| 3.1 | `identidades` | `gestor` | *devolverCuenta(cuenta)* (retorno) |
| 4 | `gestor` | `miembro` | `crear(cuenta, papel)` |
| 5 | `gestor` | `almacen` | `guardarMiembro(proyectoId, miembro)` |
| 6 | `gestor` | `panel` | *devolverMiembros(miembros)* (retorno) |
| 7 | `panel` | `propietario` | *mostrarMiembros(miembros)* (retorno) |

### Flujos alternativos

- **No hay cuenta con ese correo.** No se crea ninguna invitación pendiente: la cuenta tiene que existir antes.
- **Quien invita no es el propietario.** Un editor puede dibujar pero no puede repartir permisos.

### Operaciones que salen del análisis

- **PanelDeMiembros**: `escribirInvitacion(correo, papel)`
- **GestorDeMiembros**: `invitar(proyectoId, correo, papel)`
- **RepositorioDeIdentidades**: `buscarPorCorreo(correo)`
- **Miembro**: `crear(cuenta, papel)`
- **AlmacenDeProyectos**: `guardarMiembro(proyectoId, miembro)`

### Actividad

Calles: **Propietario** · **Sistema**.

- (inicio) → Escribir el correo y elegir el papel
- Escribir el correo y elegir el papel → ¿Existe una cuenta con ese correo?
- ¿Existe una cuenta con ese correo? → **[Sí]** Añadir el miembro con su papel
- ¿Existe una cuenta con ese correo? → **[No]** Avisar de que no hay ninguna cuenta con ese correo
- Añadir el miembro con su papel → Mostrar la lista de miembros actualizada
- Mostrar la lista de miembros actualizada → (fin)
- Avisar de que no hay ninguna cuenta con ese correo → Escribir el correo y elegir el papel

Enlaces del diagrama de comunicación: 5 entre 6 objetos.

## CU8 — Editar el diagrama en tiempo real

Varios editores trabajan a la vez sobre el mismo diagrama: cada cambio se aplica en local, se reparte a los demás y se funde sin pisarse.

| Ficha |  |
| --- | --- |
| **Paquete** | Edición del diagrama |
| **Actores** | Editor, Propietario |
| **Precondición** | El proyecto está abierto y el papel permite editar. |
| **Postcondición** | El cambio queda en el documento compartido y todos los editores conectados lo ven. |

### Participantes

| Objeto | Clase de análisis | Estereotipo | De dónde sale |
| --- | --- | --- | --- |
| `editor` | Editor | actor | — |
| `lienzo` | Lienzo | «boundary» | `frontend/src/components/Lienzo.tsx` |
| `documento` | DocumentoCompartido | «control» | `shared/src/crdt/document.ts` |
| `sala` | SalaDeColaboracion | «control» | `backend-tool/src/collab/rooms.ts` |
| `diagrama` | Diagrama | «entity» | `shared/src/model/uml.ts` |
| `presencia` | PresenciaDeEditores | «entity» | `frontend/src/hooks/usePresencia.ts` |

### Flujo principal

| # | De | A | Mensaje |
| --- | --- | --- | --- |
| 1 | `editor` | `lienzo` | `arrastrarClase(clase, posicion)` |
| 2 | `lienzo` | `documento` | `aplicarOperacion(operacion)` |
| 3 | `documento` | `diagrama` | `modificar(operacion)` |
| 4 | `documento` | `sala` | `enviarCambio(actualizacion)` |
| 5 | `sala` | `presencia` | `anotarPresencia(cuenta, posicion)` |
| 6 | `sala` | `documento` | `repartirCambio(actualizacion)` |
| 7 | `documento` | `lienzo` | *refrescarVista(diagrama)* (retorno) |
| 8 | `lienzo` | `editor` | *mostrarCambio()* (retorno) |

### Flujos alternativos

- **Dos editores tocan la misma clase.** No hay conflicto que resolver a mano: el documento es un CRDT y las dos ediciones se funden en un orden estable, igual en todos los navegadores.
- **Se cae la conexión.** La edición sigue en local y el indicador de sincronía lo dice. Al volver la conexión se reenvía lo pendiente.

### Operaciones que salen del análisis

- **Lienzo**: `arrastrarClase(clase, posicion)`
- **DocumentoCompartido**: `aplicarOperacion(operacion)`, `repartirCambio(actualizacion)`
- **SalaDeColaboracion**: `enviarCambio(actualizacion)`
- **Diagrama**: `modificar(operacion)`
- **PresenciaDeEditores**: `anotarPresencia(cuenta, posicion)`

### Actividad

Calles: **Editor** · **Sistema**.

- (inicio) → Mover o editar un elemento
- Mover o editar un elemento → ¿El papel permite editar?
- ¿El papel permite editar? → **[Sí]** Aplicar la operación sobre el documento compartido
- ¿El papel permite editar? → **[No]** Dejar el lienzo en solo lectura
- Aplicar la operación sobre el documento compartido → Repartir el cambio a los demás editores
- Repartir el cambio a los demás editores → (fin)
- Dejar el lienzo en solo lectura → (fin)

Enlaces del diagrama de comunicación: 5 entre 6 objetos.

## CU9 — Importar un diagrama desde una foto

El editor fotografía un diagrama de clases —de una pizarra o de un papel— y el sistema propone las clases, los atributos y las relaciones que ha leído.

| Ficha |  |
| --- | --- |
| **Paquete** | Asistencia inteligente |
| **Actores** | Editor |
| **Precondición** | El motor de visión está configurado y el proyecto está abierto para editar. |
| **Postcondición** | El diagrama recibe lo que el editor haya confirmado; nada se aplica sin revisión. |

### Participantes

| Objeto | Clase de análisis | Estereotipo | De dónde sale |
| --- | --- | --- | --- |
| `editor` | Editor | actor | — |
| `pantalla` | PantallaDesdeImagen | «boundary» | `frontend/src/components/ImportarDiagrama.tsx` |
| `gestor` | GestorDeImportacion | «control» | `backend-tool/src/api/import.ts` |
| `vision` | MotorDeVision | «control» | `backend-tool/src/ai/vision.ts` |
| `propuesta` | PropuestaDeDiagrama | «entity» | `shared/src/ops/import-diagram.ts` |
| `documento` | DocumentoCompartido | «control» | `shared/src/crdt/document.ts` |

### Flujo principal

| # | De | A | Mensaje |
| --- | --- | --- | --- |
| 1 | `editor` | `pantalla` | `elegirFoto(imagen)` |
| 2 | `pantalla` | `gestor` | `leerImagen(imagen)` |
| 3 | `gestor` | `vision` | `extraerEstructura(imagen)` |
| 3.1 | `vision` | `gestor` | *devolverLectura(clases, relaciones)* (retorno) |
| 4 | `gestor` | `propuesta` | `construir(clases, relaciones)` |
| 5 | `gestor` | `pantalla` | *mostrarPropuesta(propuesta)* (retorno) |
| 6 | `editor` | `pantalla` | `confirmarPropuesta(propuesta)` |
| 7 | `pantalla` | `documento` | `aplicarPropuesta(propuesta)` |
| 8 | `documento` | `editor` | *mostrarDiagrama()* (retorno) |

### Flujos alternativos

- **La foto no deja leer un nombre.** Ese elemento se marca como dudoso y se muestra aparte. No se adivina: un nombre inventado con confianza es peor que un hueco señalado.
- **El editor descarta la propuesta.** El diagrama no cambia. La revisión es obligatoria y nada se aplica solo.
- **El motor de visión no está configurado.** La pantalla lo dice antes de pedir la foto, en vez de fallar después de subirla. Y no se le presta a un proveedor la clave de otro.

### Operaciones que salen del análisis

- **PantallaDesdeImagen**: `elegirFoto(imagen)`, `confirmarPropuesta(propuesta)`
- **GestorDeImportacion**: `leerImagen(imagen)`
- **MotorDeVision**: `extraerEstructura(imagen)`
- **PropuestaDeDiagrama**: `construir(clases, relaciones)`
- **DocumentoCompartido**: `aplicarPropuesta(propuesta)`

### Actividad

Calles: **Editor** · **Sistema**.

- (inicio) → Elegir o hacer la foto del diagrama
- Elegir o hacer la foto del diagrama → Extraer clases, atributos y relaciones de la imagen
- Extraer clases, atributos y relaciones de la imagen → Mostrar la propuesta marcando lo dudoso
- Mostrar la propuesta marcando lo dudoso → ¿La propuesta se confirma?
- ¿La propuesta se confirma? → **[Sí]** Aplicar la propuesta al diagrama
- ¿La propuesta se confirma? → **[No]** Descartarla sin tocar el diagrama
- Aplicar la propuesta al diagrama → (fin)
- Descartarla sin tocar el diagrama → (fin)

Enlaces del diagrama de comunicación: 6 entre 6 objetos.

## CU10 — Importar y exportar XMI

El diagrama viaja en los dos sentidos entre esta herramienta y Enterprise Architect a través de ficheros XMI 2.1.

| Ficha |  |
| --- | --- |
| **Paquete** | Edición del diagrama |
| **Actores** | Editor |
| **Precondición** | El proyecto está abierto. |
| **Postcondición** | El diagrama incorpora lo importado, o el editor se lleva un fichero que la herramienta abre. |

### Participantes

| Objeto | Clase de análisis | Estereotipo | De dónde sale |
| --- | --- | --- | --- |
| `editor` | Editor | actor | — |
| `pantalla` | PantallaXmi | «boundary» | `frontend/src/components/ImportarXmi.tsx` |
| `lector` | LectorXmi | «control» | `shared/src/xmi/import.ts` |
| `escritor` | EscritorXmi | «control» | `shared/src/xmi/export.ts` |
| `fichero` | FicheroXmi | «entity» | `shared/src/xmi/comun.ts` |
| `diagrama` | Diagrama | «entity» | `shared/src/model/uml.ts` |

### Flujo principal

| # | De | A | Mensaje |
| --- | --- | --- | --- |
| 1 | `editor` | `pantalla` | `elegirFichero(fichero)` |
| 2 | `pantalla` | `lector` | `leerXmi(fichero)` |
| 3 | `lector` | `fichero` | `decodificar(bytes)` |
| 3.1 | `fichero` | `lector` | *devolverTexto(texto)* (retorno) |
| 4 | `lector` | `diagrama` | `aplicarOperaciones(operaciones)` |
| 5 | `lector` | `pantalla` | *devolverResumen(clases, relaciones, avisos)* (retorno) |
| 6 | `editor` | `pantalla` | `pedirExportacion()` |
| 7 | `pantalla` | `escritor` | `exportarXmi(diagrama)` |
| 8 | `escritor` | `pantalla` | *devolverFichero(xmi)* (retorno) |
| 9 | `pantalla` | `editor` | *descargarFichero(xmi)* (retorno) |

### Flujos alternativos

- **El fichero viene en windows-1252.** Se decodifica con la codificación que el propio fichero declara. Leerlo todo como UTF-8 rompe los acentos y luego el nombre roto falla la lista blanca, con un aviso que además culpa al nombre.
- **El fichero no trae ninguna clase.** Se dice qué se encontró en su lugar. Un componente o una instancia no son un fichero vacío: son otro dialecto del mismo formato.
- **Un nombre no pasa la lista blanca.** Se descarta ese elemento y se dice cuál y por qué. Nunca se limpia quitando caracteres: eso convierte una inyección en un nombre inocente.

### Operaciones que salen del análisis

- **PantallaXmi**: `elegirFichero(fichero)`, `pedirExportacion()`
- **LectorXmi**: `leerXmi(fichero)`
- **EscritorXmi**: `exportarXmi(diagrama)`
- **FicheroXmi**: `decodificar(bytes)`
- **Diagrama**: `aplicarOperaciones(operaciones)`

### Actividad

Calles: **Editor** · **Sistema**.

- (inicio) → Elegir el fichero XMI a importar
- Elegir el fichero XMI a importar → Decodificarlo según la codificación que declara
- Decodificarlo según la codificación que declara → ¿Trae alguna clase reconocible?
- ¿Trae alguna clase reconocible? → **[Sí]** Aplicar clases y relaciones al diagrama
- ¿Trae alguna clase reconocible? → **[No]** Explicar qué se encontró en su lugar
- Aplicar clases y relaciones al diagrama → Exportar el diagrama a XMI
- Exportar el diagrama a XMI → (fin)
- Explicar qué se encontró en su lugar → (fin)

Enlaces del diagrama de comunicación: 5 entre 6 objetos.

## CU11 — Editar el diagrama por voz

El editor dicta una orden —crear una clase, añadir un atributo, relacionar dos clases— y el sistema la traduce a operaciones sobre el diagrama.

| Ficha |  |
| --- | --- |
| **Paquete** | Edición del diagrama |
| **Actores** | Editor |
| **Precondición** | Hay micrófono y el modelo local de dictado está disponible. |
| **Postcondición** | La operación dictada queda aplicada, después de confirmarla. |

### Participantes

| Objeto | Clase de análisis | Estereotipo | De dónde sale |
| --- | --- | --- | --- |
| `editor` | Editor | actor | — |
| `microfono` | EntradaDeVoz | «boundary» | `frontend/src/services/voz.ts` |
| `dictado` | MotorDeDictado | «control» | `frontend/src/services/ollama.ts` |
| `asistente` | Asistente | «control» | `backend-tool/src/ai/assistant.ts` |
| `gramatica` | GramaticaDeOrdenes | «entity» | `shared/src/ai/grammar.ts` |
| `documento` | DocumentoCompartido | «control» | `shared/src/crdt/document.ts` |

### Flujo principal

| # | De | A | Mensaje |
| --- | --- | --- | --- |
| 1 | `editor` | `microfono` | `dictarOrden(audio)` |
| 2 | `microfono` | `dictado` | `transcribir(audio)` |
| 2.1 | `dictado` | `microfono` | *devolverTexto(texto)* (retorno) |
| 3 | `microfono` | `asistente` | `interpretar(texto, diagrama)` |
| 4 | `asistente` | `gramatica` | `reconocer(texto)` |
| 4.1 | `gramatica` | `asistente` | *devolverOperaciones(operaciones)* (retorno) |
| 5 | `asistente` | `microfono` | *proponerCambio(operaciones)* (retorno) |
| 6 | `editor` | `microfono` | `confirmarOrden(operaciones)` |
| 7 | `microfono` | `documento` | `aplicarOperaciones(operaciones)` |
| 8 | `documento` | `editor` | *mostrarDiagrama()* (retorno) |

### Flujos alternativos

- **La orden no se reconoce.** Se dicen las palabras que la gramática sí entiende, en vez de responder que no se entendió. Un error que no enseña la salida obliga a adivinar.
- **La orden borra algo.** Se pide confirmación hablada antes de aplicarla. Lo destructivo no se ejecuta solo.
- **No hay conexión.** El dictado sigue funcionando: el modelo corre en local, que es justo el motivo de haberlo puesto ahí.

### Operaciones que salen del análisis

- **EntradaDeVoz**: `dictarOrden(audio)`, `confirmarOrden(operaciones)`
- **MotorDeDictado**: `transcribir(audio)`
- **Asistente**: `interpretar(texto, diagrama)`
- **GramaticaDeOrdenes**: `reconocer(texto)`
- **DocumentoCompartido**: `aplicarOperaciones(operaciones)`

### Actividad

Calles: **Editor** · **Sistema**.

- (inicio) → Dictar la orden
- Dictar la orden → Transcribir el audio con el modelo local
- Transcribir el audio con el modelo local → ¿La gramática reconoce la orden?
- ¿La gramática reconoce la orden? → **[Sí]** Mostrar la operación propuesta para confirmarla
- ¿La gramática reconoce la orden? → **[No]** Enseñar las órdenes que sí se entienden
- Mostrar la operación propuesta para confirmarla → Aplicar la operación al diagrama
- Aplicar la operación al diagrama → (fin)
- Enseñar las órdenes que sí se entienden → Dictar la orden

Enlaces del diagrama de comunicación: 6 entre 6 objetos.

## CU12 — Consultar la guía del proyecto

El usuario pregunta en lenguaje natural y el sistema responde con lo que dice la documentación del proyecto, citando de qué documento sale.

| Ficha |  |
| --- | --- |
| **Paquete** | Asistencia inteligente |
| **Actores** | Usuario |
| **Precondición** | Ninguna: la guía se consulta también sin proyecto abierto. |
| **Postcondición** | El usuario recibe una respuesta con sus fuentes, o un «no está en el manual» explícito. |

### Participantes

| Objeto | Clase de análisis | Estereotipo | De dónde sale |
| --- | --- | --- | --- |
| `usuario` | Usuario | actor | — |
| `pantalla` | PantallaDeGuia | «boundary» | `frontend/src/components/Guia.tsx` |
| `buscador` | BuscadorDeGuia | «control» | `shared/src/guia/buscar.ts` |
| `corpus` | CorpusDeDocumentos | «entity» | `shared/src/guia/corpus.ts` |
| `redactor` | RedactorDeRespuestas | «control» | `backend-tool/src/ai/guia.ts` |

### Flujo principal

| # | De | A | Mensaje |
| --- | --- | --- | --- |
| 1 | `usuario` | `pantalla` | `escribirPregunta(pregunta)` |
| 2 | `pantalla` | `buscador` | `buscar(pregunta)` |
| 3 | `buscador` | `corpus` | `recuperarFragmentos(pregunta)` |
| 3.1 | `corpus` | `buscador` | *devolverFragmentos(fragmentos)* (retorno) |
| 4 | `buscador` | `redactor` | `redactarRespuesta(pregunta, fragmentos)` |
| 4.1 | `redactor` | `buscador` | *devolverRespuesta(respuesta)* (retorno) |
| 5 | `buscador` | `pantalla` | *entregarRespuesta(respuesta, fuentes)* (retorno) |
| 6 | `pantalla` | `usuario` | *mostrarRespuesta(respuesta)* (retorno) |

### Flujos alternativos

- **El manual no lo cubre.** Se dice que no está, en vez de rellenar el hueco con lo que el modelo sepa de otros proyectos. Una respuesta plausible y falsa es la peor de las dos.
- **Se añade un documento nuevo.** No hay que registrarlo en ningún sitio: un `.md` en `docs/` entra en el corpus solo, tanto en el servidor como en el navegador.

### Operaciones que salen del análisis

- **PantallaDeGuia**: `escribirPregunta(pregunta)`
- **BuscadorDeGuia**: `buscar(pregunta)`
- **CorpusDeDocumentos**: `recuperarFragmentos(pregunta)`
- **RedactorDeRespuestas**: `redactarRespuesta(pregunta, fragmentos)`

### Actividad

Calles: **Usuario** · **Sistema**.

- (inicio) → Escribir la pregunta
- Escribir la pregunta → Buscar los fragmentos del manual que responden
- Buscar los fragmentos del manual que responden → ¿Hay algún fragmento que responda?
- ¿Hay algún fragmento que responda? → **[Sí]** Redactar la respuesta citando su documento
- ¿Hay algún fragmento que responda? → **[No]** Decir que el manual no lo cubre
- Redactar la respuesta citando su documento → (fin)
- Decir que el manual no lo cubre → (fin)

Enlaces del diagrama de comunicación: 4 entre 5 objetos.

## CU13 — Generar el backend Spring Boot

El diagrama de clases se convierte en un proyecto Spring Boot con sus cuatro capas —entidad, repositorio, servicio y controlador— listo para compilar.

| Ficha |  |
| --- | --- |
| **Paquete** | Generación de código |
| **Actores** | Propietario |
| **Precondición** | El diagrama tiene al menos una clase y pasa la validación del modelo. |
| **Postcondición** | El propietario se descarga un proyecto Maven que compila. |

### Participantes

| Objeto | Clase de análisis | Estereotipo | De dónde sale |
| --- | --- | --- | --- |
| `propietario` | Propietario | actor | — |
| `pantalla` | PantallaDeGeneracion | «boundary» | `frontend/src/components/EditorDiagrama.tsx` |
| `validador` | ValidadorDelModelo | «control» | `backend-tool/src/api/generation.ts` |
| `diagrama` | Diagrama | «entity» | `shared/src/model/uml.ts` |
| `generador` | GeneradorDeCodigo | «control» | `backend-tool/src/architech/client.ts` |
| `proyecto` | ProyectoSpringBoot | «entity» | `backend-tool/src/architech/client.ts` |

### Flujo principal

| # | De | A | Mensaje |
| --- | --- | --- | --- |
| 1 | `propietario` | `pantalla` | `pedirGeneracion(opciones)` |
| 2 | `pantalla` | `validador` | `validarModelo(diagrama)` |
| 3 | `validador` | `diagrama` | `revisarClases()` |
| 3.1 | `diagrama` | `validador` | *devolverProblemas(problemas)* (retorno) |
| 4 | `validador` | `pantalla` | *mostrarValidacion(problemas)* (retorno) |
| 5 | `pantalla` | `generador` | `generarProyecto(diagrama, opciones)` |
| 6 | `generador` | `proyecto` | `escribirCapas(entidad, repositorio, servicio, controlador)` |
| 7 | `generador` | `pantalla` | *devolverZip(zip)* (retorno) |
| 8 | `pantalla` | `propietario` | *descargarZip(zip)* (retorno) |

### Flujos alternativos

- **El modelo no valida.** No se genera nada y se listan todos los problemas de una vez. Ir arreglándolos de uno en uno es media tarde de regenerar y volver a mirar.
- **Un nombre de clase no sirve como identificador Java.** Se rechaza diciendo cuál. Todo nombre que venga de un diagrama —o de un OCR, o de un XMI ajeno— es entrada no fiable antes de ser un nombre de fichero o de paquete.

### Operaciones que salen del análisis

- **PantallaDeGeneracion**: `pedirGeneracion(opciones)`
- **ValidadorDelModelo**: `validarModelo(diagrama)`
- **Diagrama**: `revisarClases()`
- **GeneradorDeCodigo**: `generarProyecto(diagrama, opciones)`
- **ProyectoSpringBoot**: `escribirCapas(entidad, repositorio, servicio, controlador)`

### Actividad

Calles: **Propietario** · **Sistema**.

- (inicio) → Pedir la generación del backend
- Pedir la generación del backend → Validar nombres, tipos y relaciones del diagrama
- Validar nombres, tipos y relaciones del diagrama → ¿El modelo pasa la validación?
- ¿El modelo pasa la validación? → **[Sí]** Generar las cuatro capas de cada clase
- ¿El modelo pasa la validación? → **[No]** Listar los problemas sin generar nada
- Generar las cuatro capas de cada clase → Entregar el proyecto comprimido
- Entregar el proyecto comprimido → (fin)
- Listar los problemas sin generar nada → Pedir la generación del backend

Enlaces del diagrama de comunicación: 5 entre 6 objetos.

## CU14 — Consultar el historial de cambios

El usuario ve qué se ha cambiado en el diagrama, quién lo cambió y cuándo, y puede volver a un punto anterior.

| Ficha |  |
| --- | --- |
| **Paquete** | Edición del diagrama |
| **Actores** | Usuario, Lector |
| **Precondición** | El proyecto está abierto. |
| **Postcondición** | El usuario ha visto la lista de cambios y, si lo pidió, el diagrama ha vuelto a un punto anterior. |

### Participantes

| Objeto | Clase de análisis | Estereotipo | De dónde sale |
| --- | --- | --- | --- |
| `usuario` | Usuario | actor | — |
| `panel` | PanelDeHistorial | «boundary» | `frontend/src/components/HistorialCambios.tsx` |
| `historial` | HistorialDeCambios | «control» | `shared/src/crdt/historial.ts` |
| `documento` | DocumentoCompartido | «control» | `shared/src/crdt/document.ts` |
| `entrada` | EntradaDeHistorial | «entity» | `shared/src/crdt/historial.ts` |

### Flujo principal

| # | De | A | Mensaje |
| --- | --- | --- | --- |
| 1 | `usuario` | `panel` | `abrirHistorial()` |
| 2 | `panel` | `historial` | `listarCambios(proyecto)` |
| 3 | `historial` | `documento` | `leerOperaciones()` |
| 3.1 | `documento` | `historial` | *devolverOperaciones(operaciones)* (retorno) |
| 4 | `historial` | `entrada` | `describir(operacion, autor, momento)` |
| 5 | `historial` | `panel` | *devolverEntradas(entradas)* (retorno) |
| 6 | `usuario` | `panel` | `elegirEntrada(entrada)` |
| 7 | `panel` | `documento` | `deshacerHasta(entrada)` |
| 8 | `documento` | `panel` | *devolverDiagrama(diagrama)* (retorno) |
| 9 | `panel` | `usuario` | *mostrarDiagrama(diagrama)* (retorno) |

### Flujos alternativos

- **El usuario solo mira.** Cierra el panel y el diagrama queda como estaba: consultar no cambia nada.
- **Volver atrás con otros editando.** Deshacer es una operación más del documento compartido, así que se reparte y se funde igual que cualquier otra. No hay una copia local que se quede desalineada.

### Operaciones que salen del análisis

- **PanelDeHistorial**: `abrirHistorial()`, `elegirEntrada(entrada)`
- **HistorialDeCambios**: `listarCambios(proyecto)`
- **DocumentoCompartido**: `leerOperaciones()`, `deshacerHasta(entrada)`
- **EntradaDeHistorial**: `describir(operacion, autor, momento)`

### Actividad

Calles: **Usuario** · **Sistema**.

- (inicio) → Abrir el panel de historial
- Abrir el panel de historial → Listar los cambios con su autor y su momento
- Listar los cambios con su autor y su momento → ¿Quiere volver a un punto anterior?
- ¿Quiere volver a un punto anterior? → **[Sí]** Deshacer hasta la entrada elegida
- ¿Quiere volver a un punto anterior? → **[No]** Cerrar el panel sin tocar el diagrama
- Deshacer hasta la entrada elegida → (fin)
- Cerrar el panel sin tocar el diagrama → (fin)

Enlaces del diagrama de comunicación: 5 entre 5 objetos.
