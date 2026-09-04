# 7. Cuentas, contraseñas y cómo recuperarlas

Cómo se entra, qué pasa si se olvida la contraseña y por qué esta parte no
funciona como en casi todas las webs. Vale igual para el navegador y para la
aplicación de móvil: la app es la misma web dentro de un `WebView`, así que las
pantallas que se describen aquí son literalmente las mismas.

---

## 7.1 Crear una cuenta

En la pantalla de entrada, «¿No tienes cuenta? Crea una». Se pide correo,
contraseña y, opcionalmente, un nombre para que los demás sepan quién eres
cuando editéis el mismo diagrama.

**La contraseña tiene que tener diez caracteres como mínimo.** No se exigen
mayúsculas ni símbolos: la longitud es lo que hace difícil una contraseña, y
las reglas de «al menos un símbolo» sobre todo consiguen que la gente escriba
`Password1!` y lo apunte en un papel.

Al terminar aparece **el código de recuperación**. Léelo antes de seguir, porque
es la parte que no se puede deshacer.

---

## 7.2 El código de recuperación

Al crear la cuenta se entrega un código como este:

```
K7J2M-4NPQR-8XCFD-VWH3T
```

Es lo único que permite volver a entrar si se olvida la contraseña.

**Se enseña una sola vez.** El servidor no lo guarda: guarda una huella
criptográfica suya, con la que puede comprobar si el que escribes es el correcto
pero no reconstruirlo. Si cierras esa pantalla sin copiarlo, ni el servidor ni
nadie puede volver a enseñártelo.

Por eso la pantalla tiene una casilla que hay que marcar para continuar. No es
burocracia: es el único momento en que copiarlo todavía es posible.

Dónde guardarlo, en orden de preferencia:

1. En un gestor de contraseñas, junto a la contraseña de la cuenta.
2. En papel, en un cajón.
3. En una nota del teléfono.

Lo que **no** cuenta como guardarlo es dejarlo en el portapapeles: se vacía al
reiniciar y lo sobrescribe lo siguiente que copies.

El código no lleva ni la letra I, ni la L, ni la O, ni la U, ni el 0, ni el 1.
Están fuera del alfabeto justamente porque son las que se transcriben mal cuando
se copia desde una captura de pantalla. Al escribirlo puedes poner o quitar los
guiones y usar minúsculas: el servidor normaliza antes de comparar.

### Si ya tenías cuenta antes de que esto existiera

Las cuentas creadas antes no tienen código. Entra con tu contraseña y pulsa
**«Código de recuperación»** en la barra superior de la lista de proyectos. Se
emite uno y se enseña igual que en el registro.

Ese mismo botón sirve para **anular un código del que sospeches**: emitir uno
nuevo invalida el anterior de forma inmediata.

---

## 7.3 He olvidado la contraseña

En la pantalla de entrada, **«He olvidado mi contraseña»**. Se piden tres cosas:

- el correo de la cuenta,
- el código de recuperación,
- la contraseña nueva.

Si el código es correcto, la contraseña cambia y entras directamente; no hay que
volver a escribirla en una pantalla siguiente.

Tres cosas que conviene saber:

- **El código se gasta.** Después de usarlo ya no vale, ni siquiera para el
  mismo correo. Si quieres tener otro guardado, pídelo desde el botón de la
  barra superior.
- **La contraseña anterior deja de funcionar** en el mismo momento.
- **Todas las sesiones abiertas se cierran**, incluidas las que no son tuyas.
  Esto es el motivo principal de que exista este mecanismo, y se explica en
  §7.5.

---

## 7.4 Por qué no hay «te hemos enviado un correo»

Es lo que hace casi todo el mundo, y aquí no se puede.

**No hay servidor de correo.** El proyecto no tiene ninguna dependencia de
envío, y añadirla significaría credenciales de SMTP que hay que configurar en
cada máquina donde se levante el sistema. En la defensa, que corre en
`localhost`, sencillamente no habría a dónde mandar el mensaje: la recuperación
sería una función que existe en el código y no funciona cuando se prueba.

**Y hay un motivo mejor que la comodidad.** El resto del sistema está diseñado
para funcionar sin conexión: el diagrama se edita sin red, las órdenes de voz se
interpretan sin red, la guía contesta sin red. Una recuperación por correo sería
la única pieza que exige internet, y exigiría además que la cuenta de correo
siga existiendo y siendo accesible.

El código de un solo uso es el patrón que usan GitHub y Bitwarden para lo mismo.
Tiene una debilidad evidente y hay que decirla en voz alta: **quien pierda a la
vez la contraseña y el código, pierde la cuenta.** Para eso está la escotilla del
apartado siguiente.

### La escotilla de operador

Quien tenga acceso al servidor puede emitir un código para cualquier cuenta:

```bash
npm run recuperar --workspace @app/backend-tool -- alguien@ejemplo.com
```

Imprime un código nuevo por pantalla. Hay que dárselo a esa persona por un
canal en el que se confíe; con él y su correo puede poner una contraseña.

Fíjate en que el comando **no pone una contraseña, emite un código**. Es
deliberado: una contraseña escrita en la línea de órdenes queda en el historial
del intérprete y a la vista de cualquiera que ejecute `ps` mientras corre. Con un
código de un solo uso no pasa ninguna de las dos cosas, y además es el dueño de
la cuenta —y no el operador— quien acaba eligiendo la contraseña. El operador
nunca llega a saberla.

---

## 7.5 Qué pasa con las sesiones abiertas

Este apartado es el que justifica la mitad del trabajo, así que va con detalle.

El token de sesión de esta herramienta es **autocontenido**: no se consulta en
ninguna tabla, lleva dentro el identificador del usuario y una caducidad, y va
firmado. Es rápido y no necesita estado en el servidor, pero tiene una
consecuencia incómoda: si no se hace nada más, **un token robado sigue valiendo
hasta que caduca, aunque el dueño cambie la contraseña**.

Aplicado a la recuperación: alguien entra en tu cuenta, tú te das cuenta, cambias
la contraseña… y el intruso sigue dentro. Es cambiar la cerradura dejándole
dentro de casa.

La solución no ha sido añadir una tabla de sesiones. La firma del token se
calcula ahora incluyendo una **huella de la credencial actual**, derivada del
hash de la contraseña. Cambiar la contraseña cambia esa huella, y con ella dejan
de validar todos los tokens emitidos antes. Es el mismo mecanismo que Django
llama `get_session_auth_hash`.

Lo que se gana:

- Recuperar la contraseña expulsa a cualquiera que estuviera dentro.
- No hace falta ni una lista negra ni una tabla que limpiar.

Lo que **sigue sin poder hacerse**, y conviene no prometerlo:

- Cerrar una sesión concreta —«sal de este otro dispositivo»—.
- Echar a alguien sin tocar su contraseña.
- Ver la lista de sesiones abiertas.

Las tres necesitarían un registro de tokens en el servidor. No está hecho.

---

## 7.6 Seguridad: qué se ha comprobado

| Propiedad | Cómo se consigue | Dónde se prueba |
|---|---|---|
| La contraseña no se guarda | `scrypt` con sal de 16 bytes por usuario | `postgres.test.ts`, «guarda el hash y la sal, nunca la contraseña» |
| El código no se guarda | Lo mismo: `scrypt` con su propia sal | `postgres.test.ts`, «el código no llega nunca en claro a la base de datos» |
| Comparación sin filtrar por tiempo | `timingSafeEqual` sobre longitudes iguales | `identity.ts`, `safeEquals` |
| No se puede averiguar qué correos tienen cuenta | La misma respuesta y el mismo trabajo para «no existe» y «código incorrecto» | `api.test.ts`, «no distingue un correo desconocido de un código equivocado» |
| El código vale una sola vez | Se borra al usarse, y el `update` de PostgreSQL lleva la condición sobre el hash para que dos peticiones simultáneas no pasen las dos | `api.test.ts` y `postgres.test.ts` |
| Recuperar cierra las sesiones anteriores | La huella de la credencial entra en la firma | `identity.test.ts`, «el token deja de valer si cambia la marca de la credencial» |
| El código es imposible de adivinar | 20 caracteres sobre un alfabeto de 30, unos 98 bits, con muestreo sin sesgo | `identity.test.ts`, grupo `generarCodigoRecuperacion` |
| Los dos almacenes se comportan igual | Fichero y PostgreSQL comparten `hashPassword`, `safeEquals` y `SesionFirmada`, importadas y no copiadas | Batería propia en cada uno |

Lo que **no** está resuelto y se sabe:

- **No hay límite de intentos.** Nada impide probar códigos contra
  `POST /auth/recuperar` a toda velocidad. Con 98 bits de entropía es un ataque
  que no termina nunca, pero el límite de tasa (RNF-SEG-08) sigue pendiente y
  esta ruta es de las que lo necesitan.
- **No hay verificación del correo.** Nadie comprueba que el correo con el que
  te registras sea tuyo. Aquí no da acceso a nada —no se manda nada a él—, pero
  significa que el correo no sirve como identidad demostrada.
- **El código no caduca.** Uno emitido hace un año sigue valiendo. Caducarlos
  dejaría a gente fuera sin avisar, que es peor.

---

## 7.7 Para quien administre el servidor

- **La contraseña nueva se valida con la misma función que el registro**
  (`validarRegistro`). No hay dos reglas que puedan separarse.
- **Al arrancar contra PostgreSQL, el esquema añade solo las columnas que
  faltan.** Las dos de recuperación se crean con `alter table … add column if
  not exists`, así que una base que ya existía las recibe sin perder datos.
- **`npm run migrar` se lleva también el código pendiente.** Pasar de fichero a
  PostgreSQL no invalida el papel que alguien tenga guardado.
- **`SESSION_SECRET` sigue siendo lo que firma los tokens.** Cambiarlo cierra
  todas las sesiones de todo el mundo, y eso no ha cambiado.
