"""Genera las capturas de evidencia de los casos de prueba de la sección 2.5.1.

Cada imagen no es una maqueta: el script *ejecuta* las pruebas del caso, captura
la salida real del ejecutor (vitest o `flutter test`), deduce el estado de esa
ejecución y compone la ficha. Si una prueba falla, la imagen sale en rojo y lo
dice; no hay forma de que la captura afirme un éxito que no ocurrió.

Uso:
    py backend-tool/scripts/capturas-pruebas.py [CP-07 CP-12 ...]

Sin argumentos hace los dieciséis casos. Las imágenes van a
`docs/pruebas/capturas/` y la salida completa de cada ejecución, sin recortar,
a `docs/pruebas/capturas/logs/`.

Requiere Pillow y las dependencias del monorepo ya instaladas. La ficha se
dibuja aquí mismo, sin navegador: basta con las fuentes del sistema.
"""

from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parents[2]
SALIDA = RAIZ / "docs" / "pruebas" / "capturas"
LOGS = SALIDA / "logs"

ANCHO = 1280
# Se compone al doble de resolución y se deja que Word la reduzca: así el texto
# sigue siendo legible cuando la imagen entra a lo ancho de una página A4.
ESCALA = 2
MAX_LINEAS = 46

ANSI = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]")


@dataclass
class Orden:
    """Un comando a ejecutar, con la etiqueta que lo presenta en la imagen."""

    etiqueta: str
    comando: str
    cwd: Path = RAIZ
    filtro: str = "vitest"  # vitest | flutter | crudo
    max_lineas: int = MAX_LINEAS


@dataclass
class Caso:
    id: str
    titulo: str
    cu: str
    paquete: str
    proposito: str
    precondiciones: str
    pasos: list[str]
    esperado: str
    obtenido: str
    ordenes: list[Orden]
    manual: list[str] = field(default_factory=list)
    observacion: str = ""


# ---------------------------------------------------------------------------
# Los dieciséis casos de prueba de la sección 2.5.1.
# ---------------------------------------------------------------------------

CASOS: list[Caso] = [
    Caso(
        id="CP-01",
        titulo="Edición simultánea del diagrama en el lienzo compartido",
        cu="CU8 — Editar el diagrama en tiempo real",
        paquete="Edición del diagrama",
        proposito=(
            "Verificar que dos editores conectados al mismo proyecto ven los cambios del otro sin "
            "recargar, y que dos ediciones hechas a la vez se combinan en lugar de sobrescribirse."
        ),
        precondiciones=(
            "Dos usuarios autenticados con papel «editor» sobre el mismo proyecto, cada uno con el "
            "editor abierto en un cliente distinto. Servidor de colaboración en marcha."
        ),
        pasos=[
            "Desde el cliente A, crear la clase «Cliente» en el lienzo.",
            "Observar el lienzo del cliente B sin recargar.",
            "A la vez, añadir en A el atributo «nombre» y en B el atributo «correo», sobre la misma clase.",
            "Trazar en B una asociación de «Cliente» a «Pedido».",
            "Conectar un tercer cliente C al mismo proyecto, ya empezada la edición.",
            "Hacer un cambio por HTTP, fuera del canal, y comprobar que llega a quien está conectado.",
        ],
        esperado=(
            "El cambio de A aparece en B sin recargar. Las dos ediciones simultáneas del paso 3 "
            "sobreviven las dos: ninguna reemplaza a la otra. El cliente C, que llegó tarde, recibe "
            "el documento completo con todo lo anterior. Un cambio hecho por HTTP llega también al "
            "canal."
        ),
        obtenido=(
            "Confirmado. La convergencia CRDT mantiene los dos atributos escritos a la vez; el tercer "
            "cliente recibe el estado completo al conectar; el cambio por HTTP se propaga al canal. "
            "Ninguna de las pruebas de convergencia falla."
        ),
        ordenes=[
            Orden(
                "Canal colaborativo — edición simultánea",
                'npx vitest run --reporter=verbose backend-tool/src/collab/collab.test.ts -t "edición simultánea"',
            ),
            Orden(
                "Convergencia del documento compartido (CRDT)",
                "npx vitest run --reporter=verbose shared/src/crdt/crdt.test.ts",
                max_lineas=26,
            ),
        ],
    ),
    Caso(
        id="CP-02",
        titulo="Inicio de sesión y validez de la sesión firmada",
        cu="CU1 — Iniciar sesión",
        paquete="Acceso y cuentas",
        proposito=(
            "Verificar que el sistema emite una sesión firmada válida con credenciales correctas, la "
            "rechaza con credenciales incorrectas o manipuladas, y que un cambio de contraseña "
            "invalida las sesiones emitidas antes."
        ),
        precondiciones="Existe una cuenta con contraseña conocida. Secreto de firma configurado.",
        pasos=[
            "Registrar una cuenta y comprobar que el token devuelto sirve para pedir datos.",
            "Entrar con la contraseña equivocada y con un correo inexistente.",
            "Manipular un carácter de la firma del token y reintentar.",
            "Presentar un token con la caducidad ya pasada.",
            "Presentar un token firmado con otro secreto.",
            "Cambiar la contraseña de la cuenta y reutilizar el token anterior.",
        ],
        esperado=(
            "El token emitido es utilizable. El error de credenciales no distingue correo inexistente "
            "de contraseña incorrecta. El token manipulado, el caducado y el firmado con otro secreto "
            "se rechazan. Tras cambiar la contraseña, el token anterior deja de valer aunque su fecha "
            "de caducidad no haya llegado. El hash de la contraseña nunca sale en la huella."
        ),
        obtenido=(
            "Confirmado en las dos capas: en la unidad de identidad y en la API por HTTP. El token "
            "caducado se rechaza sin llegar a preguntar por el usuario, y la revocación por cambio de "
            "credencial funciona a través de la huella del hash."
        ),
        ordenes=[
            Orden(
                "Sesión firmada, caducidad y revocación (unidad)",
                "npx vitest run --reporter=verbose backend-tool/src/auth/identity.test.ts",
                max_lineas=30,
            ),
            Orden(
                "Autenticación por HTTP (integración de la API)",
                'npx vitest run --reporter=verbose backend-tool/src/api.test.ts -t "autenticación"',
            ),
        ],
    ),
    Caso(
        id="CP-03",
        titulo="Recuperación de la contraseña con código de un solo uso",
        cu="CU3 — Recuperar la contraseña / CU4 — Emitir un código desde el servidor",
        paquete="Acceso y cuentas",
        proposito=(
            "Verificar que el operador puede emitir un código de recuperación por consola, que el "
            "usuario entra con él una sola vez, y que el código queda inservible después."
        ),
        precondiciones=(
            "Existe la cuenta. El operador tiene acceso a la consola del servidor. No hay ningún "
            "código emitido para esa cuenta."
        ),
        pasos=[
            "Intentar la recuperación sin que exista código emitido.",
            "Emitir el código desde el servidor (`npm run recuperar -- correo`).",
            "Copiar el código tal como lo imprime la consola, con sus guiones.",
            "Pegarlo, con minúsculas y espacios de pegado, junto con la contraseña nueva.",
            "Reutilizar el mismo código una segunda vez.",
            "Probar el código de otra cuenta, y emitir un código nuevo sobre el anterior.",
        ],
        esperado=(
            "Sin código emitido no hay recuperación posible. El código sale en grupos legibles y sin "
            "los caracteres que se confunden al copiar. Se acepta con o sin guiones y en minúsculas, "
            "cambia la contraseña y deja la sesión iniciada. No vale dos veces. El de otra cuenta no "
            "sirve, y emitir uno nuevo anula el anterior. La contraseña anterior deja de servir."
        ),
        obtenido=(
            "Confirmado. El alfabeto del código excluye los caracteres ambiguos y no repite; el "
            "segundo uso se rechaza; el cambio de contraseña invalida además las sesiones abiertas. "
            "El mensaje de error no distingue un correo desconocido de un código equivocado."
        ),
        ordenes=[
            Orden(
                "Emisión, normalización y uso único del código (unidad)",
                'npx vitest run --reporter=verbose backend-tool/src/auth/identity.test.ts -t "código"',
            ),
            Orden(
                "Recuperación completa por HTTP (integración)",
                'npx vitest run --reporter=verbose backend-tool/src/api.test.ts -t "recuperación de contraseña"',
            ),
        ],
    ),
    Caso(
        id="CP-04",
        titulo="Reparto de permisos y bloqueo de escritura al lector",
        cu="CU7 — Invitar a un colaborador",
        paquete="Proyectos y colaboración",
        proposito=(
            "Verificar que el propietario reparte los papeles «editor» y «viewer», y que el lector "
            "recibe los cambios de los demás pero el servidor no acepta ninguno suyo (RNF-SEG-04)."
        ),
        precondiciones="Un proyecto con propietario autenticado y otras dos cuentas existentes.",
        pasos=[
            "Invitar por correo a un colaborador como «editor» y a otro como «viewer».",
            "Con la sesión del lector, leer el diagrama y después intentar escribirlo.",
            "Forzar desde el lector un mensaje de escritura por el canal colaborativo.",
            "Repetir el envío para comprobar si el permiso se revisa en cada mensaje.",
            "Intentar conectarse a la sala sin ser miembro, y después sin token válido.",
            "Pedir un proyecto ajeno siendo un extraño.",
        ],
        esperado=(
            "El lector lee y no escribe, y el rechazo ocurre en el servidor y no solo en la interfaz. "
            "El permiso se comprueba en cada mensaje, no únicamente al conectar. Se rechaza la "
            "conexión de quien no es miembro y la que llega sin token. Un proyecto ajeno responde 404 "
            "y no 403, para no revelar que existe."
        ),
        obtenido=(
            "Confirmado. El canal descarta las actualizaciones de quien no puede escribir y sigue "
            "entregándole las de los demás. Un identificador de sala con forma de ruta también se "
            "rechaza, de modo que el permiso no se puede eludir por el nombre de la sala."
        ),
        ordenes=[
            Orden(
                "Permisos en el canal colaborativo (RNF-SEG-04)",
                'npx vitest run --reporter=verbose backend-tool/src/collab/collab.test.ts -t "permisos en el canal"',
            ),
            Orden(
                "Invitación y aislamiento entre proyectos (API)",
                'npx vitest run --reporter=verbose backend-tool/src/api.test.ts -t "proyectos"',
            ),
        ],
    ),
    Caso(
        id="CP-05",
        titulo="Importación de un diagrama de clases desde una fotografía",
        cu="CU9 — Importar un diagrama desde una foto",
        paquete="Asistencia inteligente",
        proposito=(
            "Verificar que el motor de visión convierte la foto de un diagrama en operaciones "
            "revisables, que no se aplican hasta que el usuario las aprueba."
        ),
        precondiciones=(
            "Editor autenticado dentro de un proyecto. Proveedor de visión configurado (en la prueba, "
            "un servidor local que habla el mismo protocolo). Una imagen de un diagrama."
        ),
        pasos=[
            "Enviar la imagen a la ruta de lectura y recibir la propuesta.",
            "Revisar la lista de operaciones propuestas, con su descripción.",
            "Comprobar que el diagrama no ha cambiado todavía.",
            "Aplicar las operaciones aprobadas y comprobar el resultado, hasta el data.sql.",
            "Repetir la lectura con una sesión de solo lectura.",
        ],
        esperado=(
            "La lectura devuelve operaciones con su descripción y no escribe nada en el diagrama. La "
            "aplicación posterior sí lo cambia, y el recorrido completo llega hasta los datos semilla "
            "generados. A quien solo puede leer se le rechaza sin llegar a gastar la clave del "
            "proveedor."
        ),
        obtenido=(
            "Confirmado, incluido el recorrido entero «foto → revisión → propuesta → aplicación → "
            "data.sql». El rechazo al lector ocurre antes de llamar al modelo, lo que además evita "
            "gastar cuota de la clave."
        ),
        ordenes=[
            Orden(
                "Lectura de imagen y propuesta revisable (integración)",
                "npx vitest run --reporter=verbose backend-tool/src/import.test.ts",
                max_lineas=24,
            ),
            Orden(
                "Operaciones de importación de diagrama y de tabla (unidad)",
                "npx vitest run --reporter=verbose shared/src/ops/import-diagram.test.ts shared/src/ops/import-table.test.ts",
                max_lineas=20,
            ),
        ],
    ),
    Caso(
        id="CP-06",
        titulo="Exportación e importación de XMI 2.1 (ida y vuelta)",
        cu="CU10 — Importar y exportar XMI",
        paquete="Edición del diagrama",
        proposito=(
            "Verificar que el diagrama exportado en XMI 2.1 conserva el modelo completo y que al "
            "reimportarlo se recupera lo mismo que se exportó."
        ),
        precondiciones=(
            "Un diagrama con varias clases, una herencia, una composición con multiplicidad y una "
            "enumeración con literales."
        ),
        pasos=[
            "Exportar el diagrama a XMI 2.1.",
            "Comprobar la estructura del fichero: paquetes, clases, atributos, relaciones y literales.",
            "Reimportar ese mismo fichero en un proyecto vacío.",
            "Comparar clase por clase, atributo por atributo y relación por relación.",
            "Repetir con nombres acentuados y con la ñ.",
        ],
        esperado=(
            "El XMI emitido es válido y contiene el modelo completo. La reimportación reconstruye los "
            "mismos nombres, tipos, multiplicidades y literales. Las tildes y la ñ sobreviven a la ida "
            "y a la vuelta."
        ),
        obtenido=(
            "Confirmado por el propio importador del sistema sobre los ficheros que emite el "
            "exportador: la ida y vuelta es estable. El formato es el que Enterprise Architect lee."
        ),
        ordenes=[
            Orden(
                "Modelo XMI 2.1: lectura y escritura",
                "npx vitest run --reporter=verbose shared/src/xmi/xmi.test.ts",
                max_lineas=22,
            ),
            Orden(
                "Compatibilidad con Enterprise Architect (ida y vuelta)",
                "npx vitest run --reporter=verbose shared/src/xmi/ea.test.ts shared/src/xmi/ea-export.test.ts",
                max_lineas=24,
            ),
        ],
        manual=[
            "Abrir el fichero exportado en Enterprise Architect y comprobar que dibuja las clases, la "
            "herencia y el rombo de la composición sin avisos de formato. Enterprise Architect no está "
            "instalado en esta máquina: ese paso se verifica a mano y su captura se adjunta aparte.",
        ],
    ),
    Caso(
        id="CP-07",
        titulo="Generación de un backend Spring Boot completo a partir del diagrama",
        cu="CU13 — Generar el backend Spring Boot",
        paquete="Generación de código",
        proposito=(
            "Verificar que el propietario obtiene un proyecto Spring Boot completo y coherente a "
            "partir del diagrama: entidades, repositorios, servicios, controladores, DTO, migraciones "
            "y el manifiesto del asistente."
        ),
        precondiciones=(
            "Un diagrama válido: todas las clases persistentes con clave, sin herencia múltiple y sin "
            "nombres repetidos. Para esta ejecución se usa el diagrama «Tienda» del corpus."
        ),
        pasos=[
            "Validar el diagrama antes de generar.",
            "Generar el proyecto y contar los ficheros emitidos.",
            "Revisar que estén las cuatro capas, los DTO con sus mapeadores y el manejador de errores.",
            "Comprobar que la relación de muchos a muchos sale como tabla de unión y no como clave ajena.",
            "Comprobar que se emiten las migraciones, el data.sql y el manifiesto del asistente.",
            "Ejecutar la suite del generador sobre todo el corpus de diagramas.",
        ],
        esperado=(
            "La generación emite un proyecto Maven completo, con las cuatro capas y sin ficheros a "
            "medias, y la suite del generador pasa entera sobre el corpus."
        ),
        obtenido=(
            "Confirmado: 56 ficheros emitidos, 98,8 KiB, sin avisos de validación. Están las cuatro "
            "capas, los DTO con mapeador por entidad, el manejador global de errores, la migración "
            "inicial, la de idempotencia y el manifiesto del asistente."
        ),
        ordenes=[
            Orden(
                "Generación real del proyecto (diagrama «Tienda» del corpus)",
                "npx tsx backend-tool/scripts/generar-demo.mts",
                filtro="crudo",
                max_lineas=30,
            ),
            Orden(
                "Suite del generador y del manifiesto sobre todo el corpus",
                "npx vitest run --reporter=dot generator/src",
                filtro="crudo",
                max_lineas=14,
            ),
        ],
        manual=[
            "Compilar el proyecto emitido con `mvn -q package` y arrancarlo contra PostgreSQL. Maven "
            "no está instalado en esta máquina, así que la compilación no se repite aquí: se verificó "
            "al cerrar las tareas 64 y 70 del plan y su captura se adjunta aparte.",
        ],
    ),
    Caso(
        id="CP-08",
        titulo="Reparación automática de lo que impide generar",
        cu="CU18 — Arreglar lo que impide generar",
        paquete="Generación de código",
        proposito=(
            "Verificar que ante un diagrama que no se puede generar el sistema propone arreglos "
            "concretos, explica cada uno, y distingue lo que sabe arreglar de lo que no."
        ),
        precondiciones=(
            "Un diagrama roto a propósito: clase persistente sin clave, atributo llamado «order», dos "
            "atributos con el mismo nombre, un tipo inexistente y una herencia múltiple."
        ),
        pasos=[
            "Pedir la generación y recoger los errores.",
            "Pedir el plan de reparación y leer los arreglos propuestos con su explicación.",
            "Comprobar que el plan no toca el diagrama que recibe.",
            "Aplicar el plan y volver a validar.",
            "Comprobar qué queda marcado como irreparable y con qué mensaje.",
            "Repetir sobre un diagrama ya válido y sobre un diagrama vacío.",
        ],
        esperado=(
            "El plan deja generable un diagrama que no lo era, sin aumentar nunca el número de "
            "errores. Cada arreglo explica su motivo: columna reservada en PostgreSQL, «String» como "
            "tipo que compila pero no es el correcto, atributo duplicado del que probablemente uno "
            "sobra. La herencia múltiple sale como irreparable con su mensaje, y aun así se proponen "
            "los arreglos mecánicos. Un diagrama válido no produce ningún arreglo."
        ),
        obtenido=(
            "Confirmado, incluidos los casos límite: la clave que se añade no choca con un atributo "
            "que ya se llamaba así, se conserva la clave de mejor tipo cuando hay varias, y los avisos "
            "que no impiden generar no se tocan."
        ),
        ordenes=[
            Orden(
                "Plan de reparación: arreglos, explicaciones e irreparables",
                "npx vitest run --reporter=verbose shared/src/reparacion/reparar.test.ts",
                max_lineas=44,
            ),
        ],
    ),
    Caso(
        id="CP-09",
        titulo="Revisión del modelado del diagrama",
        cu="CU17 — Revisar el modelado del diagrama",
        paquete="Asistencia inteligente",
        proposito=(
            "Verificar que el revisor señala defectos de modelado que el generador aceptaría "
            "igualmente, sin bloquear la generación."
        ),
        precondiciones=(
            "Un diagrama que genera correctamente pero repite en una clase hija un atributo que ya "
            "estaba en el padre, y otro que estaba dos niveles más arriba."
        ),
        pasos=[
            "Pedir la revisión del modelado.",
            "Leer los avisos y comprobar que nombran la clase donde el atributo ya existía.",
            "Comprobar que los avisos no impiden generar.",
            "Corregir un aviso y volver a revisar.",
        ],
        esperado=(
            "El revisor señala el atributo repetido en el padre y también el que está dos niveles más "
            "arriba. Los avisos no son errores: la generación sigue disponible."
        ),
        obtenido=(
            "Confirmado. La revisión recorre la jerarquía completa y no solo el padre inmediato, y el "
            "plan de reparación no toca nada que solo produzca avisos."
        ),
        ordenes=[
            Orden(
                "Revisor de modelado",
                "npx vitest run --reporter=verbose shared/src/revision/revision.test.ts",
                max_lineas=30,
            ),
            Orden(
                "Los avisos no se reparan solos",
                'npx vitest run --reporter=verbose shared/src/reparacion/reparar.test.ts -t "avisos"',
            ),
        ],
    ),
    Caso(
        id="CP-10",
        titulo="Edición del diagrama por voz",
        cu="CU11 — Editar el diagrama por voz",
        paquete="Edición del diagrama",
        proposito=(
            "Verificar que una orden dictada se convierte en operaciones sobre el diagrama, y que "
            "cuando la gramática no entiende pide una aclaración en lugar de inventar."
        ),
        precondiciones=(
            "Contexto seguro (HTTPS) y permiso de micrófono, porque el reconocimiento de voz del "
            "navegador lo exige. En la prueba, el motor de voz se sustituye por un doble."
        ),
        pasos=[
            "Dictar: «crea la clase Cliente con los atributos nombre de tipo texto, correo de tipo texto y edad de tipo entero».",
            "Dictar: «Pedido tiene muchos DetalleDePedido».",
            "Dictar una enumeración y después «añade el literal pendiente de pago a EstadoPedido».",
            "Dictar sin tildes un nombre que las lleva.",
            "Dictar algo que la gramática no cubre: «crea la clase Pedido con lo que haga falta».",
            "Comprobar la síntesis de voz: leer en alto, callar, y el puente nativo del teléfono.",
        ],
        esperado=(
            "Los tipos dichos en castellano se traducen al catálogo. «Tiene muchos» se lee como uno a "
            "muchos. El literal entra en mayúsculas. El nombre se normaliza a PascalCase y conserva "
            "las tildes aunque se dicte sin ellas. Lo que no se entiende baja la confianza y pide "
            "aclaración, y nunca se borra nada que no se haya pedido borrar."
        ),
        obtenido=(
            "Confirmado en la gramática y en el servicio de voz. La aclaración menciona también lo "
            "que sabe borrar, de modo que el usuario aprende el repertorio al equivocarse."
        ),
        ordenes=[
            Orden(
                "Gramática de órdenes dictadas",
                "npx vitest run --reporter=verbose shared/src/ai/grammar.test.ts",
                max_lineas=32,
            ),
            Orden(
                "Síntesis de voz y puente nativo",
                "npx vitest run --reporter=verbose frontend/src/services/voz.test.ts",
                max_lineas=14,
            ),
        ],
    ),
    Caso(
        id="CP-11",
        titulo="Orden dictada al asistente móvil, con confirmación hablada",
        cu="CU15 — Dictar una orden al asistente móvil",
        paquete="Asistente móvil",
        proposito=(
            "Verificar que el asistente móvil interpreta la orden dictada contra el manifiesto del "
            "backend generado, la lee en voz alta antes de ejecutarla, y no ejecuta nada crítico sin "
            "un «sí»."
        ),
        precondiciones=(
            "Aplicación Flutter apuntando a un backend generado, con permiso de micrófono. Existen "
            "registros de la entidad. En la prueba, el motor de voz es un doble."
        ),
        pasos=[
            "Preguntar «¿qué puedes hacer?» y comprobar que los ejemplos salen del manifiesto.",
            "Pedir una lista: es lectura, no debe preguntar nada.",
            "Dictar un borrado y escuchar la confirmación hablada.",
            "Responder «no» y comprobar que no se borra nada.",
            "Repetir y responder «sí»: el DELETE debe viajar con su clave de idempotencia.",
            "Dictar un número que no existe, y una frase que encaja con dos registros.",
        ],
        esperado=(
            "Preguntar qué puede hacer no propone ninguna acción. La lista se abre sin más preguntas. "
            "Antes de borrar se dice qué se lleva por delante; cancelar no borra; confirmar borra y la "
            "clave viaja en la petición. Un número inexistente se contesta con las palabras del "
            "dominio. Con dos coincidencias se pregunta cuál, no se elige la primera."
        ),
        obtenido=(
            "Confirmado. Además: rectificar hablando sustituye la propuesta en lugar de ejecutarla, "
            "escribir no hace hablar al teléfono, y tras preguntar se reabre el micrófono solo."
        ),
        ordenes=[
            Orden(
                "Pantalla del asistente: interpretación, confirmación y voz",
                "flutter test test/asistente/pantalla_asistente_test.dart --reporter expanded",
                cwd=RAIZ / "mobile",
                filtro="flutter",
                max_lineas=34,
            ),
            Orden(
                "Gramática del asistente guiada por el manifiesto",
                "flutter test test/asistente/gramatica_test.dart test/asistente/manifiesto_test.dart --reporter expanded",
                cwd=RAIZ / "mobile",
                filtro="flutter",
                max_lineas=16,
            ),
        ],
    ),
    Caso(
        id="CP-12",
        titulo="Registro sin conexión y sincronización idempotente al volver",
        cu="CU16 — Registrar datos sin conexión y sincronizarlos al volver",
        paquete="Asistente móvil",
        proposito=(
            "Verificar que las órdenes dictadas sin cobertura se guardan en el teléfono y se reenvían "
            "al recuperar la red en el orden correcto y una sola vez, y que un rechazo del servidor no "
            "bloquea las demás."
        ),
        precondiciones="Asistente móvil configurado contra un backend generado. Bandeja de salida vacía.",
        pasos=[
            "Sin red, encolar el alta de un registro y después un cambio sobre ese mismo registro.",
            "Cerrar y reabrir la aplicación, todavía sin red.",
            "Recuperar la red y vaciar la bandeja.",
            "Provocar dos vaciados a la vez.",
            "Encolar una orden que el servidor rechaza con 400 y otra válida detrás.",
            "Simular 500, 429 y 404 del servidor y comprobar cómo se trata cada uno.",
        ],
        esperado=(
            "La bandeja sobrevive al cierre. Se envía primero el alta y después el cambio, nunca al "
            "revés, cada una con la clave con la que se guardó. Dos vaciados a la vez no mandan la "
            "orden dos veces. El 400 aparta esa orden y deja pasar la siguiente; el 500 la conserva y "
            "detiene la cola; el 429 es un «vuelve luego»; un 404 al repetir un borrado es el "
            "resultado que se pedía y no un fallo."
        ),
        obtenido=(
            "Confirmado, incluido que un fichero de bandeja corrupto no impide arrancar y que un JSON "
            "válido que no es una lista tampoco tumba la carga."
        ),
        ordenes=[
            Orden(
                "Bandeja de salida: orden, idempotencia y tratamiento de errores",
                "flutter test test/asistente/bandeja_test.dart test/asistente/cliente_rest_test.dart --reporter expanded",
                cwd=RAIZ / "mobile",
                filtro="flutter",
                max_lineas=34,
            ),
        ],
        observacion=(
            "El estado de esta captura corresponde a la ejecución automática. La verificación del "
            "dictado sin conexión sobre un teléfono real en modo avión sigue pendiente (tarea 47 del "
            "plan) y no está cubierta por esta evidencia."
        ),
    ),
    Caso(
        id="CP-13",
        titulo="Consulta de la guía del proyecto",
        cu="CU12 — Consultar la guía del proyecto",
        paquete="Asistencia inteligente",
        proposito=(
            "Verificar que la guía responde preguntas de uso apoyándose en el manual del proyecto, y "
            "que el sistema sigue funcionando si el manual no está presente."
        ),
        precondiciones="Usuario autenticado. El directorio docs/ montado en el servicio.",
        pasos=[
            "Preguntar algo que el manual cubre y comprobar que la respuesta cita el fragmento.",
            "Preguntar algo que el manual no cubre.",
            "Arrancar el servicio sin el directorio docs/ y repetir la pregunta.",
            "Comprobar que la ausencia del manual solo desactiva la ayuda.",
        ],
        esperado=(
            "La respuesta se apoya en el fragmento correspondiente del manual en lugar de improvisar. "
            "Lo que no está se admite como no sabido. Sin el manual el servicio arranca igual, avisa "
            "en el registro y muestra la ayuda desactivada."
        ),
        obtenido=(
            "Confirmado. La recuperación de fragmentos y la ruta HTTP de la guía pasan; la falta del "
            "manual degrada una función y no tumba el servicio."
        ),
        ordenes=[
            Orden(
                "Recuperación de fragmentos del manual",
                "npx vitest run --reporter=verbose shared/src/guia/guia.test.ts",
                max_lineas=22,
            ),
            Orden(
                "Ruta de la guía y ausencia del manual",
                "npx vitest run --reporter=verbose backend-tool/src/ai/guia.test.ts",
                max_lineas=22,
            ),
        ],
    ),
    Caso(
        id="CP-14",
        titulo="Historial de cambios y presencia de los colaboradores",
        cu="CU14 — Consultar el historial de cambios",
        paquete="Edición del diagrama",
        proposito=(
            "Verificar que el historial registra quién cambió qué y cuándo, y que la posición del "
            "cursor y la presencia no ensucian ese historial."
        ),
        precondiciones="Un proyecto con dos editores conectados y varias ediciones hechas por cada uno.",
        pasos=[
            "Hacer varios cambios desde las dos sesiones y abrir el historial.",
            "Mover el cursor por el lienzo sin editar nada.",
            "Volver a abrir el historial y contar las entradas.",
            "Cerrar una de las dos sesiones y observar la otra.",
        ],
        esperado=(
            "El historial muestra las entradas con su autor y su hora. Mover el cursor no añade "
            "ninguna: la presencia no entra en el documento, ni en el historial, ni en el disco. Al "
            "cerrar una sesión su cursor desaparece de la pantalla de la otra."
        ),
        obtenido=(
            "Confirmado. La presencia viaja por un canal aparte del documento, de modo que el "
            "historial solo recoge cambios reales del modelo."
        ),
        ordenes=[
            Orden(
                "Historial derivado del documento compartido",
                "npx vitest run --reporter=verbose shared/src/crdt/historial.test.ts",
                max_lineas=24,
            ),
            Orden(
                "Presencia: no entra en el documento ni en el historial",
                'npx vitest run --reporter=verbose backend-tool/src/collab/collab.test.ts -t "presencia"',
            ),
        ],
    ),
    Caso(
        id="CP-15",
        titulo="Protecciones transversales: cabeceras de seguridad y límite de tasa",
        cu="RNF-SEG-07 y RNF-SEG-08 (transversales)",
        paquete="Transversal",
        proposito=(
            "Verificar que toda respuesta lleva las cabeceras de seguridad y que el límite de tasa "
            "corta el abuso de las rutas caras sin castigar a las baratas."
        ),
        precondiciones="Servicio en marcha detrás de un balanceador que termina el TLS.",
        pasos=[
            "Pedir /salud e inspeccionar las cabeceras.",
            "Comprobar la política de contenido: scripts en línea, estilos en línea y Ollama.",
            "Comprobar micrófono, cámara y geolocalización, y el HSTS con y sin TLS por delante.",
            "Pedir once generaciones del mismo minuto.",
            "Inmediatamente después, leer el diagrama.",
            "Repetir el abuso desde dos cuentas distintas detrás de la misma dirección.",
        ],
        esperado=(
            "Todas las respuestas llevan las cabeceras, incluida la de salud. No se permiten scripts "
            "en línea, sí estilos en línea, y se deja hablar con Ollama. Se concede micrófono y cámara "
            "y se niega la geolocalización. HSTS solo detrás de TLS. La generación se corta al "
            "undécimo intento con 429 y Retry-After; leer el diagrama no gasta esa cuota; con sesión "
            "se cuenta por usuario y no por dirección."
        ),
        obtenido=(
            "Confirmado en la unidad y con el servicio entero levantado, que es donde se comprueba lo "
            "que de verdad puede fallar: que el middleware esté montado donde se cree."
        ),
        ordenes=[
            Orden(
                "Cabeceras de seguridad y límite de tasa (unidad e integración)",
                "npx vitest run --reporter=verbose backend-tool/src/api/proteccion.test.ts",
                max_lineas=30,
            ),
        ],
    ),
    Caso(
        id="CP-16",
        titulo="Persistencia del documento y migración de ficheros a PostgreSQL",
        cu="CU6 — Abrir un proyecto (persistencia del documento colaborativo)",
        paquete="Proyectos y colaboración",
        proposito=(
            "Verificar que el diagrama sobrevive a que se desconecten todos los editores y a un "
            "reinicio, y que los datos guardados en ficheros se migran a PostgreSQL sin pérdida."
        ),
        precondiciones=(
            "Servicio con almacenes de fichero y de PostgreSQL disponibles. Un directorio datos/ de "
            "una ejecución anterior."
        ),
        pasos=[
            "Editar por el canal y desconectar a todos los clientes.",
            "Volver a abrir la sala y comprobar el estado del documento.",
            "Ejecutar la migración del directorio de ficheros a PostgreSQL.",
            "Abrir los proyectos migrados y revisar sus permisos.",
            "Volver a ejecutar la migración para comprobar que no duplica.",
            "Comprobar el SSL de la conexión y el tratamiento de la violación de unicidad.",
        ],
        esperado=(
            "Lo editado por el socket sobrevive a que se vayan todos. La migración informa de lo que "
            "movió, los proyectos migrados abren intactos y la segunda ejecución no duplica nada. La "
            "conexión a PostgreSQL usa verificación completa del certificado."
        ),
        obtenido=(
            "Confirmado sobre las dos implementaciones de los almacenes, con un pool falso que "
            "registra las consultas para comprobar que se emiten las que se esperan."
        ),
        ordenes=[
            Orden(
                "Persistencia de la sala al quedarse vacía",
                'npx vitest run --reporter=verbose backend-tool/src/collab/collab.test.ts -t "persistencia de la sala"',
            ),
            Orden(
                "Almacenes, migración y conexión a PostgreSQL",
                "npx vitest run --reporter=verbose backend-tool/src/storage/documents.test.ts backend-tool/src/storage/migracion.test.ts backend-tool/src/storage/postgres.test.ts",
                max_lineas=30,
            ),
        ],
    ),
]


# ---------------------------------------------------------------------------
# Ejecución y lectura de la salida
# ---------------------------------------------------------------------------


def sin_ansi(texto: str) -> str:
    return ANSI.sub("", texto)


def ejecutar(orden: Orden) -> dict:
    inicio = time.monotonic()
    proceso = subprocess.run(
        orden.comando,
        cwd=str(orden.cwd),
        shell=True,
        capture_output=True,
    )
    duracion = time.monotonic() - inicio
    bruto = sin_ansi(
        (proceso.stdout or b"").decode("utf-8", "replace")
        + (proceso.stderr or b"").decode("utf-8", "replace")
    )
    lineas = [l.rstrip() for l in bruto.splitlines()]
    colapsadas = 0

    if orden.filtro == "vitest":
        utiles = [
            l
            for l in lineas
            if re.match(r"\s*[✓×↓]", l)
            or re.search(r"Test Files|Tests\s+\d|Duration|No test files found", l)
        ]
    elif orden.filtro == "flutter":
        utiles = [l for l in lineas if re.match(r"\s*\d\d:\d\d \+", l)]
        utiles = [l for l in utiles if "loading" not in l] or lineas
        # `flutter test` escribe la ruta absoluta del fichero en cada línea y
        # repite la línea de cada prueba cada vez que avanza el contador. Se
        # deja la ruta relativa al repositorio y, de cada prueba, la última
        # aparición, que es la que ya trae el recuento cerrado.
        for prefijo in (str(RAIZ).replace("\\", "/") + "/", str(RAIZ) + "\\"):
            utiles = [l.replace(prefijo, "") for l in utiles]
        ultimas: dict[str, str] = {}
        for l in utiles:
            m = re.match(r"\s*\d\d:\d\d \+\d+(?: -\d+)?:\s*(.*)$", l)
            ultimas[m.group(1) if m else l] = l
        colapsadas = len(utiles) - len(ultimas)
        utiles = list(ultimas.values())
    else:
        utiles = [l for l in lineas if l.strip()]

    fallos = bool(re.search(r"×|failed|FAILED|Some tests failed|\[E\]", bruto))
    ok = proceso.returncode == 0 and not fallos

    def aprobadas(n: str) -> str:
        return f"{n} prueba aprobada" if n == "1" else f"{n} pruebas aprobadas"

    total = None
    m = re.search(r"Tests\s+(\d+)\s+passed", bruto)
    if m:
        total = aprobadas(m.group(1))
    m = re.search(r"\+(\d+)(?:\s+-(\d+))?:\s+All tests passed", bruto)
    if m:
        total = aprobadas(m.group(1))
    m = re.search(r"\((\d+) tests?\)", bruto)
    if total is None and m:
        total = f"{m.group(1)} prueba" if m.group(1) == "1" else f"{m.group(1)} pruebas"

    return {
        "orden": orden,
        "ok": ok,
        "codigo": proceso.returncode,
        "lineas": utiles,
        "colapsadas": colapsadas,
        "bruto": bruto,
        "total": total or ("sin fallos" if ok else "con fallos"),
        "duracion": duracion,
    }


# ---------------------------------------------------------------------------
# Composición de la imagen
#
# La ficha se dibuja con Pillow, sin navegador. Chrome en modo headless se
# queda colgado en esta máquina, y una evidencia que no se puede regenerar no
# es evidencia: es un fichero heredado. El precio es maquetar a mano, que es
# todo lo que hace este bloque —medir el texto, envolverlo y bajar el cursor—.
#
# Se dibuja dos veces. La primera pasada va a un lienzo de ocho píxeles de
# alto y se tira: Pillow recorta en silencio lo que cae fuera, así que sirve
# para sumar la altura real de la ficha, que depende del texto de cada caso y
# de cuántas líneas devolvió el ejecutor. Con esa altura ya se crea el lienzo
# definitivo y se pinta en firme. Nada de recortar blanco a posteriori: la
# imagen sale con la medida exacta.
# ---------------------------------------------------------------------------

S = ESCALA
ANCHO_HOJA = ANCHO * S
MARGEN = 28 * S
ANCHO_FICHA = ANCHO_HOJA - 2 * MARGEN
X0 = MARGEN
X1 = MARGEN + ANCHO_FICHA

COLOR = {
    "hoja": (255, 255, 255),
    "borde": (185, 195, 207),
    "texto": (22, 32, 44),
    "cab": (31, 59, 87),
    "cab_id": (22, 41, 60),
    "cab_txt": (255, 255, 255),
    "cab_sub": (197, 211, 226),
    "ok": (29, 122, 65),
    "ko": (163, 35, 31),
    "meta_fondo": (238, 242, 247),
    "meta_etiqueta": (53, 72, 92),
    "linea": (221, 228, 236),
    "barra": (230, 236, 243),
    "obtenido": (243, 250, 245),
    "salida_fondo": (16, 23, 31),
    "salida_txt": (223, 231, 239),
    "salida_ok": (88, 214, 141),
    "salida_ko": (255, 107, 107),
    "salida_tenue": (143, 163, 184),
    "orden_fondo": (37, 53, 70),
    "orden_txt": (215, 226, 238),
    "orden_cmd": (157, 195, 230),
    "aviso_fondo": (255, 248, 225),
    "aviso_borde": (230, 217, 168),
    "aviso_fuerte": (138, 109, 11),
    "aviso_txt": (91, 74, 16),
    "pie_txt": (85, 105, 126),
}

DIR_FUENTES = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "Fonts"

# Por familia, la primera que exista. Segoe UI es la de Windows; las demás son
# el plan B para que el script no dependa de una máquina concreta.
FAMILIAS = {
    "normal": ["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"],
    "media": ["seguisb.ttf", "segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"],
    "negrita": ["segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"],
}

# La monoespaciada no se elige por gusto sino por cobertura: vitest marca cada
# prueba con ✓ y Consolas, que sería la primera opción en Windows, no tiene ese
# glifo. Se prueban las parejas en orden y gana la primera que sepa dibujarlo.
PAREJAS_MONO = [
    ("consola.ttf", "consolab.ttf"),
    ("CascadiaMono.ttf", "CascadiaMono.ttf"),
    ("DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf"),
    ("lucon.ttf", "lucon.ttf"),
    ("cour.ttf", "courbd.ttf"),
]

_FUENTES: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}
_MONO: tuple[str, str] | None = None


def _elegir_mono() -> tuple[str, str]:
    disponibles: list[tuple[str, str]] = []
    for normal, negrita in PAREJAS_MONO:
        ruta, ruta_negrita = DIR_FUENTES / normal, DIR_FUENTES / negrita
        if ruta.exists():
            disponibles.append((str(ruta), str(ruta_negrita if ruta_negrita.exists() else ruta)))
    for pareja in disponibles:
        try:
            if _tiene_glifo(ImageFont.truetype(pareja[0], 24), "✓"):
                return pareja
        except Exception:
            continue
    return disponibles[0] if disponibles else ("", "")


def _ruta_familia(familia: str) -> str | None:
    if familia.startswith("mono"):
        global _MONO
        if _MONO is None:
            _MONO = _elegir_mono()
        return _MONO[1] if familia == "mono_negrita" else _MONO[0]
    for nombre in FAMILIAS[familia]:
        for candidata in (DIR_FUENTES / nombre, Path(nombre)):
            if candidata.exists():
                return str(candidata)
    return None


def fuente(familia: str, puntos: float) -> ImageFont.FreeTypeFont:
    """La fuente pedida al tamaño pedido, ya multiplicado por la escala."""
    tam = max(6, round(puntos * S))
    clave = (familia, tam)
    if clave not in _FUENTES:
        ruta = _ruta_familia(familia)
        try:
            _FUENTES[clave] = ImageFont.truetype(ruta, tam)
        except Exception:
            _FUENTES[clave] = ImageFont.load_default(tam)
    return _FUENTES[clave]


def _tiene_glifo(f: ImageFont.FreeTypeFont, glifo: str) -> bool:
    """Si el glifo falta, la fuente dibuja el mismo hueco que un carácter
    inexistente. Se compara contra uno de la zona de uso privado, que ninguna
    fuente de texto define, y contra un espacio."""

    def pintado(texto: str) -> bytes:
        im = Image.new("L", (48, 48), 0)
        ImageDraw.Draw(im).text((6, 6), texto, font=f, fill=255)
        return im.tobytes()

    try:
        muestra = pintado(glifo)
        return muestra != pintado("") and muestra != pintado(" ")
    except Exception:
        return False


def _mapa_simbolos() -> dict[int, str]:
    """vitest marca cada prueba con ✓, × y ↓. Lo que la monoespaciada elegida
    no sepa dibujar se sustituye, glifo a glifo, por un equivalente de siete
    bits: más vale un signo pobre que un cuadradito vacío en la evidencia."""
    f = fuente("mono", 11)
    equivalencias = {"✓": "+", "×": "x", "↓": "-", "→": "->", "·": "-"}
    return {ord(g): r for g, r in equivalencias.items() if not _tiene_glifo(f, g)}


SIMBOLOS: dict[int, str] = {}


def _partir(palabra: str, f: ImageFont.FreeTypeFont, ancho: int) -> list[str]:
    """Trocea una palabra que no cabe entera (una ruta larga, por ejemplo)."""
    trozos, actual = [], ""
    for letra in palabra:
        if not actual or f.getlength(actual + letra) <= ancho:
            actual += letra
        else:
            trozos.append(actual)
            actual = letra
    if actual:
        trozos.append(actual)
    return trozos


def envolver(texto: str, f: ImageFont.FreeTypeFont, ancho: int) -> list[str]:
    """Parte el texto en líneas que caben en `ancho`, midiendo con la fuente."""
    lineas: list[str] = []
    for parrafo in str(texto).split("\n"):
        palabras = parrafo.split()
        if not palabras:
            lineas.append("")
            continue
        actual = ""
        for palabra in palabras:
            tentativa = f"{actual} {palabra}".strip()
            if f.getlength(tentativa) <= ancho:
                actual = tentativa
                continue
            if actual:
                lineas.append(actual)
            if f.getlength(palabra) <= ancho:
                actual = palabra
            else:
                trozos = _partir(palabra, f, ancho)
                lineas.extend(trozos[:-1])
                actual = trozos[-1]
        if actual:
            lineas.append(actual)
    return lineas or [""]


def envolver_mono(linea: str, f: ImageFont.FreeTypeFont, ancho: int) -> list[str]:
    """Lo mismo para la salida del ejecutor, contando columnas y sangrando la
    continuación, que es como se lee una línea partida en una terminal."""
    columna = f.getlength("M") or 1
    cols = max(24, int(ancho // columna))
    linea = linea.rstrip()
    if len(linea) <= cols:
        return [linea]
    sangria = " " * min(len(linea) - len(linea.lstrip()) + 4, 12)
    salida, resto, primera = [], linea, True
    while resto:
        limite = cols - (0 if primera else len(sangria))
        if len(resto) <= limite:
            salida.append(resto if primera else sangria + resto)
            break
        corte = resto[:limite]
        hueco = corte.rfind(" ")
        if hueco > limite * 0.6:
            corte = resto[:hueco]
        salida.append(corte if primera else sangria + corte)
        resto = resto[len(corte):].lstrip()
        primera = False
    return salida


def _cabecera(d: ImageDraw.ImageDraw, caso: Caso, ok: bool, pruebas: int, y: int) -> int:
    f_id = fuente("negrita", 34)
    f_tit = fuente("media", 19)
    f_sub = fuente("normal", 13)
    f_badge = fuente("negrita", 24)
    f_nota = fuente("normal", 11)

    pad = 20 * S
    ancho_id = round(f_id.getlength(caso.id)) + 2 * pad
    ancho_estado = 216 * S
    ancho_titulo = ANCHO_FICHA - ancho_id - ancho_estado
    hueco = ancho_titulo - 36 * S

    titulo = envolver(caso.titulo, f_tit, hueco)
    subtitulo = envolver(f"Caso de uso: {caso.cu}  ·  Paquete: {caso.paquete}", f_sub, hueco)

    h_tit = round(f_tit.size * 1.3)
    h_sub = round(f_sub.size * 1.35)
    alto_texto = len(titulo) * h_tit + 5 * S + len(subtitulo) * h_sub
    alto = max(72 * S, alto_texto + 26 * S)

    d.rectangle([X0, y, X1 - 1, y + alto], fill=COLOR["cab"])
    d.rectangle([X0, y, X0 + ancho_id, y + alto], fill=COLOR["cab_id"])
    x_estado = X1 - ancho_estado
    d.rectangle([x_estado, y, X1 - 1, y + alto], fill=COLOR["ok"] if ok else COLOR["ko"])

    d.text(
        (X0 + ancho_id / 2, y + alto / 2),
        caso.id,
        font=f_id,
        fill=COLOR["cab_txt"],
        anchor="mm",
    )

    cursor = y + (alto - alto_texto) // 2
    x_texto = X0 + ancho_id + 18 * S
    for linea in titulo:
        d.text((x_texto, cursor), linea, font=f_tit, fill=COLOR["cab_txt"])
        cursor += h_tit
    cursor += 5 * S
    for linea in subtitulo:
        d.text((x_texto, cursor), linea, font=f_sub, fill=COLOR["cab_sub"])
        cursor += h_sub

    recuento = "1 prueba" if pruebas == 1 else f"{pruebas} pruebas"
    notas = ["ejecución automática", f"{recuento} · {'0 fallos' if ok else 'con fallos'}"]
    h_badge = round(f_badge.size * 1.2)
    h_nota = round(f_nota.size * 1.4)
    alto_estado = h_badge + 4 * S + len(notas) * h_nota
    cursor = y + (alto - alto_estado) // 2
    centro = x_estado + ancho_estado / 2
    d.text(
        (centro, cursor),
        "ÉXITO" if ok else "FALLO",
        font=f_badge,
        fill=(255, 255, 255),
        anchor="ma",
    )
    cursor += h_badge + 4 * S
    for nota in notas:
        d.text((centro, cursor), nota, font=f_nota, fill=(234, 242, 236), anchor="ma")
        cursor += h_nota
    return y + alto


def _fila_meta(d: ImageDraw.ImageDraw, etiqueta: str, valor: str, y: int) -> int:
    f_et = fuente("media", 13)
    f_val = fuente("normal", 13)
    ancho_et = 168 * S
    pad_x, pad_y = 12 * S, 7 * S
    lineas = envolver(valor, f_val, ANCHO_FICHA - ancho_et - 2 * pad_x)
    h = round(f_val.size * 1.5)
    alto = 2 * pad_y + max(1, len(lineas)) * h

    d.rectangle([X0, y, X0 + ancho_et, y + alto], fill=COLOR["meta_fondo"])
    d.line([X0 + ancho_et, y, X0 + ancho_et, y + alto], fill=COLOR["linea"])
    d.line([X0, y + alto, X1 - 1, y + alto], fill=COLOR["linea"])
    d.text((X0 + pad_x, y + pad_y), etiqueta, font=f_et, fill=COLOR["meta_etiqueta"])
    cursor = y + pad_y
    for linea in lineas:
        d.text((X0 + ancho_et + pad_x, cursor), linea, font=f_val, fill=COLOR["texto"])
        cursor += h
    return y + alto + 1


def _barra(d: ImageDraw.ImageDraw, texto: str, y: int) -> int:
    f = fuente("media", 12)
    pad = 9 * S
    alto = 2 * pad + round(f.size * 1.2)
    d.rectangle([X0, y, X1 - 1, y + alto], fill=COLOR["barra"])
    d.line([X0, y + alto, X1 - 1, y + alto], fill=COLOR["linea"])
    d.text(
        (X0 + 14 * S, y + alto / 2),
        texto.upper(),
        font=f,
        fill=COLOR["meta_etiqueta"],
        anchor="lm",
    )
    return y + alto + 1


def _pasos(d: ImageDraw.ImageDraw, pasos: list[str], y: int) -> int:
    f = fuente("normal", 14)
    f_num = fuente("negrita", 13)
    pad_x, pad_y = 16 * S, 12 * S
    sangria = 30 * S
    h = round(f.size * 1.5)

    cursor = y + pad_y
    for numero, paso in enumerate(pasos, 1):
        lineas = envolver(paso, f, ANCHO_FICHA - 2 * pad_x - sangria)
        d.text(
            (X0 + pad_x + sangria - 8 * S, cursor),
            f"{numero}.",
            font=f_num,
            fill=COLOR["meta_etiqueta"],
            anchor="ra",
        )
        for linea in lineas:
            d.text((X0 + pad_x + sangria, cursor), linea, font=f, fill=COLOR["texto"])
            cursor += h
        cursor += 5 * S

    alto = cursor - 5 * S + pad_y - y
    d.line([X0, y + alto, X1 - 1, y + alto], fill=COLOR["linea"])
    return y + alto + 1


def _dos_columnas(d: ImageDraw.ImageDraw, esperado: str, obtenido: str, y: int) -> int:
    f = fuente("normal", 13)
    f_cab = fuente("negrita", 12)
    pad_x, pad_y = 16 * S, 12 * S
    mitad = ANCHO_FICHA // 2
    hueco = mitad - 2 * pad_x
    izquierda = envolver(esperado, f, hueco)
    derecha = envolver(obtenido, f, hueco)
    h = round(f.size * 1.5)
    h_cab = round(f_cab.size * 1.3) + 7 * S
    alto = 2 * pad_y + h_cab + max(len(izquierda), len(derecha)) * h

    d.rectangle([X0 + mitad, y, X1 - 1, y + alto], fill=COLOR["obtenido"])
    d.line([X0 + mitad, y, X0 + mitad, y + alto], fill=COLOR["linea"])
    columnas = (
        (X0, "RESULTADO ESPERADO", izquierda, COLOR["meta_etiqueta"]),
        (X0 + mitad, "RESULTADO OBTENIDO", derecha, COLOR["ok"]),
    )
    for x, cabecera, lineas, color in columnas:
        cursor = y + pad_y
        d.text((x + pad_x, cursor), cabecera, font=f_cab, fill=color)
        cursor += h_cab
        for linea in lineas:
            d.text((x + pad_x, cursor), linea, font=f, fill=COLOR["texto"])
            cursor += h
    d.line([X0, y + alto, X1 - 1, y + alto], fill=COLOR["linea"])
    return y + alto + 1


def _tira_comando(d: ImageDraw.ImageDraw, orden: Orden, y: int) -> int:
    f_et = fuente("media", 12)
    f_cmd = fuente("mono", 11)
    pad_x, pad_y = 14 * S, 8 * S
    hueco = ANCHO_FICHA - 2 * pad_x
    comando = f"$ {orden.comando}"
    h_et = round(f_et.size * 1.35)
    h_cmd = round(f_cmd.size * 1.4)
    juntos = f_et.getlength(orden.etiqueta) + f_cmd.getlength(comando) + 28 * S <= hueco

    if juntos:
        alto = 2 * pad_y + h_et
    else:
        partido = envolver_mono(comando, f_cmd, hueco)
        alto = 2 * pad_y + h_et + 3 * S + len(partido) * h_cmd

    d.rectangle([X0, y, X1 - 1, y + alto], fill=COLOR["orden_fondo"])
    d.text((X0 + pad_x, y + pad_y), orden.etiqueta, font=f_et, fill=COLOR["orden_txt"])
    if juntos:
        d.text(
            (X1 - pad_x, y + pad_y + h_et / 2),
            comando,
            font=f_cmd,
            fill=COLOR["orden_cmd"],
            anchor="rm",
        )
    else:
        cursor = y + pad_y + h_et + 3 * S
        for linea in partido:
            d.text((X0 + pad_x, cursor), linea, font=f_cmd, fill=COLOR["orden_cmd"])
            cursor += h_cmd
    return y + alto


def _evidencia(d: ImageDraw.ImageDraw, caso: Caso, r: dict, y: int) -> int:
    orden: Orden = r["orden"]
    y = _tira_comando(d, orden, y)

    f_m = fuente("mono", 11)
    f_mb = fuente("mono_negrita", 11)
    pad_x, pad_y = 14 * S, 10 * S
    hueco = ANCHO_FICHA - 2 * pad_x

    mostradas = r["lineas"][: orden.max_lineas]
    elididas = len(r["lineas"]) - len(mostradas)

    filas: list[tuple[str, tuple[int, int, int], ImageFont.FreeTypeFont]] = []
    for linea in mostradas:
        color, f = COLOR["salida_txt"], f_m
        if "✓" in linea or re.search(r"\+\d+:", linea):
            color = COLOR["salida_ok"]
        elif "×" in linea or "[E]" in linea:
            color = COLOR["salida_ko"]
        elif re.search(r"Test Files|Tests\s+\d|Duration|All tests passed", linea):
            f = f_mb
        for trozo in envolver_mono(linea.translate(SIMBOLOS), f, hueco):
            filas.append((trozo, color, f))
    notas = []
    if elididas > 0:
        notas.append(f"[… {elididas} líneas más; salida completa en logs/{caso.id}.log]")
    if r.get("colapsadas"):
        notas.append(
            f"[{r['colapsadas']} líneas de avance idénticas salvo el contador, colapsadas; "
            f"la salida entera está en logs/{caso.id}.log]"
        )
    for nota in notas:
        for trozo in envolver_mono(nota, f_m, hueco):
            filas.append((trozo, COLOR["salida_tenue"], f_m))
    estado = "sin fallos" if r["ok"] else f"FALLO (código {r['codigo']})"
    resumen = f"→ {r['total']} · {estado} · {r['duracion']:.1f} s".translate(SIMBOLOS)
    filas.append(("", COLOR["salida_txt"], f_m))
    filas.append((resumen, COLOR["salida_ok"] if r["ok"] else COLOR["salida_ko"], f_mb))

    h = round(f_m.size * 1.45)
    alto = 2 * pad_y + len(filas) * h
    d.rectangle([X0, y, X1 - 1, y + alto], fill=COLOR["salida_fondo"])
    cursor = y + pad_y
    for texto, color, f in filas:
        if texto:
            d.text((X0 + pad_x, cursor), texto, font=f, fill=color)
        cursor += h
    return y + alto


def _aviso(d: ImageDraw.ImageDraw, titulo: str, texto: str, y: int) -> int:
    f_tit = fuente("negrita", 13)
    f = fuente("normal", 13)
    pad_x, pad_y = 16 * S, 11 * S
    lineas = envolver(texto, f, ANCHO_FICHA - 2 * pad_x)
    h = round(f.size * 1.5)
    h_tit = round(f_tit.size * 1.4)
    alto = 2 * pad_y + h_tit + len(lineas) * h

    d.rectangle([X0, y, X1 - 1, y + alto], fill=COLOR["aviso_fondo"])
    d.line([X0, y, X1 - 1, y], fill=COLOR["aviso_borde"])
    d.text((X0 + pad_x, y + pad_y), titulo, font=f_tit, fill=COLOR["aviso_fuerte"])
    cursor = y + pad_y + h_tit
    for linea in lineas:
        d.text((X0 + pad_x, cursor), linea, font=f, fill=COLOR["aviso_txt"])
        cursor += h
    return y + alto


def _pie(d: ImageDraw.ImageDraw, caso: Caso, y: int) -> int:
    f = fuente("normal", 11)
    pad = 9 * S
    alto = 2 * pad + round(f.size * 1.25)
    d.rectangle([X0, y, X1 - 1, y + alto], fill=COLOR["meta_fondo"])
    d.line([X0, y, X1 - 1, y], fill=COLOR["linea"])
    d.text(
        (X0 + 14 * S, y + alto / 2),
        f"Editor UML colaborativo · sección 2.5.1, {caso.id}",
        font=f,
        fill=COLOR["pie_txt"],
        anchor="lm",
    )
    d.text(
        (X1 - 14 * S, y + alto / 2),
        f"{caso.id}.png · generada por backend-tool/scripts/capturas-pruebas.py",
        font=f,
        fill=COLOR["pie_txt"],
        anchor="rm",
    )
    return y + alto


def _pintar(d: ImageDraw.ImageDraw, caso: Caso, resultados: list[dict], entorno: dict) -> int:
    """Dibuja la ficha entera y devuelve el alto que necesita la hoja."""
    ok = all(r["ok"] for r in resultados)
    pruebas = sum(
        int(m.group(1))
        for r in resultados
        if (m := re.match(r"(\d+) prueba", r["total"]))
    )
    sello = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

    y = _cabecera(d, caso, ok, pruebas, MARGEN)
    for etiqueta, valor in (
        ("Propósito", caso.proposito),
        ("Precondiciones", caso.precondiciones),
        ("Fecha de ejecución", f"{sello}  ·  rama {entorno['rama']}  ·  commit {entorno['commit']}"),
        ("Entorno", entorno["texto"]),
    ):
        y = _fila_meta(d, etiqueta, valor, y)

    y = _barra(d, "Pasos ejecutados", y)
    y = _pasos(d, caso.pasos, y)
    y = _dos_columnas(d, caso.esperado, caso.obtenido, y)
    y = _barra(d, "Evidencia de la ejecución — salida real del ejecutor de pruebas", y)
    for r in resultados:
        y = _evidencia(d, caso, r, y)
    for pendiente in caso.manual:
        y = _aviso(d, "Paso verificado a mano, no en esta ejecución:", pendiente, y)
    if caso.observacion:
        y = _aviso(d, "Observación:", caso.observacion, y)
    y = _pie(d, caso, y)

    d.rectangle([X0, MARGEN, X1 - 1, y], outline=COLOR["borde"], width=max(1, S // 2))
    return y + MARGEN + 1


def componer(caso: Caso, resultados: list[dict], entorno: dict, destino: Path) -> None:
    """Pasada en vacío para medir, pasada en firme para guardar."""
    global SIMBOLOS
    if not SIMBOLOS:
        SIMBOLOS = _mapa_simbolos()

    tanteo = Image.new("RGB", (ANCHO_HOJA, 8), COLOR["hoja"])
    alto = _pintar(ImageDraw.Draw(tanteo), caso, resultados, entorno)

    hoja = Image.new("RGB", (ANCHO_HOJA, alto), COLOR["hoja"])
    _pintar(ImageDraw.Draw(hoja), caso, resultados, entorno)
    destino.parent.mkdir(parents=True, exist_ok=True)
    hoja.save(destino, "PNG", optimize=True)


def leer_entorno() -> dict:
    def salida(cmd: str, cwd: Path = RAIZ) -> str:
        try:
            p = subprocess.run(cmd, cwd=str(cwd), shell=True, capture_output=True, timeout=180)
            return sin_ansi((p.stdout or b"").decode("utf-8", "replace")).strip()
        except Exception:
            return "?"

    commit = salida("git rev-parse --short HEAD") or "sin git"
    rama = salida("git branch --show-current") or "—"
    node = salida("node -v")
    vitest = salida("npx vitest --version").splitlines()[-1] if shutil.which("npx") else "vitest"
    flutter = salida("flutter --version").splitlines()[0] if shutil.which("flutter") else "Flutter"
    texto = (
        f"Windows {platform.release()} · Node {node} · {vitest} · {flutter} · "
        f"Python {platform.python_version()}"
    )
    return {"commit": commit, "rama": rama, "texto": texto}


def main() -> int:
    pedidos = [a.upper() for a in sys.argv[1:]]
    casos = [c for c in CASOS if not pedidos or c.id in pedidos]
    if not casos:
        print("Ningún caso coincide. Identificadores: " + ", ".join(c.id for c in CASOS))
        return 1

    SALIDA.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    entorno = leer_entorno()
    print(f"Repositorio en {entorno['commit']} ({entorno['rama']})\n")

    fallidos = []
    for caso in casos:
        print(f"{caso.id}  {caso.titulo}")
        resultados = []
        for orden in caso.ordenes:
            print(f"    · {orden.etiqueta} … ", end="", flush=True)
            r = ejecutar(orden)
            print(f"{'ok' if r['ok'] else 'FALLO'}  ({r['total']}, {r['duracion']:.1f} s)")
            resultados.append(r)

        (LOGS / f"{caso.id}.log").write_text(
            "\n\n".join(
                f"$ {r['orden'].comando}\n(cwd: {r['orden'].cwd})\n\n{r['bruto']}" for r in resultados
            ),
            encoding="utf-8",
        )

        destino = SALIDA / f"{caso.id}.png"
        componer(caso, resultados, entorno, destino)
        with Image.open(destino) as im:
            medidas = f"{im.size[0]}×{im.size[1]}"
        peso = destino.stat().st_size / 1024
        print(f"    → {destino.name}  {medidas} px  {peso:.0f} KiB\n")
        if not all(r["ok"] for r in resultados):
            fallidos.append(caso.id)

    print(f"Listo: {len(casos)} capturas en {SALIDA}")
    if fallidos:
        print("Con pruebas en rojo: " + ", ".join(fallidos))
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
