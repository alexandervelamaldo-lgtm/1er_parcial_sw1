"""
Reconstruye el documento del segundo parcial sobre la plantilla del original.

Por qué así y no escribiendo un .docx desde cero: el original trae la portada
con el escudo, la tabla de contenido como campo de Word, los estilos de título
del uno al siete, la geometría de página y el formato exacto de las tablas.
Nada de eso se reproduce a mano sin que se note. Lo que se hace es abrir el
original, quedarse con la portada y el índice, tirar el cuerpo entero y volver
a escribirlo — así no sobrevive ni una imagen ni un caso de uso del proyecto
anterior, que era el problema.

Las tablas se clonan del original elemento a elemento (`w:tbl` completo), no se
crean con `add_table`: es la única forma de conservar los bordes, el ancho de
columna y el sombreado, porque este documento no usa un estilo de tabla con
nombre sino formato directo.

Los diecinueve casos de uso salen de `docs/casos-de-uso.json`, que a su vez
sale de `shared/src/xmi/casos-de-uso.ts`. El mismo sitio del que salen los
`.xmi` de `docs/uml/` y el documento 8. Si el catálogo cambia, este documento
cambia con él.

Lo que este script NO hace: poner imágenes. Los diagramas se pegan a mano bajo
el título que les corresponde, que queda vacío a propósito.

    py backend-tool/scripts/parcial-a-docx.py

Lee   docs/casos-de-uso.json
      ~/Downloads/Segundo parcial SE.ORIGINAL-RESPALDO.docx   (plantilla)
Deja  ~/Downloads/Segundo parcial SE - 2026-2.docx
"""

import copy
import json
import posixpath
import re
import shutil
import sys
import zipfile
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn

RAIZ = Path(__file__).resolve().parents[2]
DESCARGAS = Path.home() / "Downloads"
PLANTILLA = DESCARGAS / "Segundo parcial SE.ORIGINAL-RESPALDO.docx"
SALIDA = DESCARGAS / "Segundo parcial SE - 2026-2.docx"
CASOS = RAIZ / "docs" / "casos-de-uso.json"

# Los códigos A1..A6 son los que usa la tabla de priorización. El orden es el
# del catálogo, que ya viene ordenado de general a particular.
CODIGO_ACTOR = {
    "Usuario": "A1",
    "Propietario": "A2",
    "Editor": "A3",
    "Lector": "A4",
    "Operador del servidor": "A5",
    "Usuario del asistente": "A6",
}

# El ciclo es el parcial en que se entregó. C1 lo que ya estaba en el primero;
# C2 lo que entra en este.
CICLO_POR_PAQUETE = {
    "Acceso y cuentas": "C1",
    "Proyectos y colaboración": "C1",
    "Edición del diagrama": "C1",
    "Asistencia inteligente": "C2",
    "Generación de código": "C2",
    "Asistente móvil": "C2",
}

# Crítica es «si esto no está, no hay sistema»; normal, «se espera»; baja, «se
# puede defender sin ello». No es una opinión: se corresponde con el orden en
# que se construyeron y con lo que rompe si falla.
PRIORIDAD = {
    "CU1": "CRITICA", "CU2": "CRITICA", "CU3": "NORMAL", "CU4": "BAJA",
    "CU5": "CRITICA", "CU6": "CRITICA", "CU7": "NORMAL",
    "CU8": "CRITICA", "CU9": "NORMAL", "CU10": "NORMAL", "CU11": "NORMAL",
    "CU12": "BAJA", "CU13": "CRITICA", "CU14": "BAJA",
    "CU15": "NORMAL", "CU16": "NORMAL", "CU17": "NORMAL", "CU18": "NORMAL",
    "CU19": "BAJA",
}


# --- Manipulación del XML ---------------------------------------------------


def texto_de_celda(celda, lineas):
    """Escribe `lineas` en la celda conservando el formato que ya tenía.

    Se clona el primer párrafo tantas veces como haga falta en vez de crear
    párrafos nuevos: así heredan el estilo `Table Paragraph`, el interlineado y
    el tipo de letra que traía la plantilla.
    """
    parrafos = celda.paragraphs
    prototipo = copy.deepcopy(parrafos[0]._p)
    for p in parrafos[1:]:
        p._p.getparent().remove(p._p)

    for i, linea in enumerate(lineas):
        if i == 0:
            p = parrafos[0]._p
        else:
            p = copy.deepcopy(prototipo)
            parrafos[0]._p.getparent().append(p)
        _escribir_en_parrafo_xml(p, linea)


def _escribir_en_parrafo_xml(p, texto):
    """Deja el párrafo con un único `run` y el texto dado, con su formato."""
    runs = p.findall(qn("w:r"))
    if runs:
        primero = runs[0]
        for r in runs[1:]:
            p.remove(r)
        for t in primero.findall(qn("w:t")):
            primero.remove(t)
        nodo = primero.makeelement(qn("w:t"), {})
    else:
        primero = p.makeelement(qn("w:r"), {})
        p.append(primero)
        nodo = primero.makeelement(qn("w:t"), {})
    nodo.set(qn("xml:space"), "preserve")
    nodo.text = texto
    primero.append(nodo)


def clonar_tabla(prototipo, filas):
    """Devuelve un `w:tbl` con el formato del prototipo y el contenido dado.

    `filas[0]` es la cabecera. Se reutiliza la primera fila del prototipo para
    ella y la segunda para todas las demás, porque suelen tener sombreado
    distinto.
    """
    from docx.table import Table

    tbl = copy.deepcopy(prototipo)
    originales = tbl.findall(qn("w:tr"))
    proto_cabecera = copy.deepcopy(originales[0])
    proto_cuerpo = copy.deepcopy(originales[1])
    for tr in originales:
        tbl.remove(tr)

    for i, fila in enumerate(filas):
        tr = copy.deepcopy(proto_cabecera if i == 0 else proto_cuerpo)
        tbl.append(tr)

    tabla = Table(tbl, None)
    for fila, destino in zip(filas, tabla.rows):
        for valor, celda in zip(fila, destino.cells):
            lineas = valor if isinstance(valor, list) else [valor]
            texto_de_celda(celda, lineas or [""])
    return tbl


# Formato que el original llevaba escrito a mano encima del estilo.
#
# Hay que ponerlo párrafo a párrafo porque el documento viene de una conversión
# y el margen real no está en la página: `sectPr` sólo reserva 141 twips
# (0,25 cm) a cada lado. Lo que separa el texto del borde es la sangría de cada
# párrafo. Los estilos de título sí traen la suya en `styles.xml` —Heading 1
# left=1677 hanging=378, Heading 7 left=1299—, pero `Normal` y `Body Text`
# tienen el `pPr` vacío, así que sin esto la prosa se pega al filo del papel y
# pierde el interlineado de 276 (1,15 líneas).
FORMATO = {
    "Body Text": {
        "spacing": {"line": "276", "lineRule": "auto"},
        "ind": {"left": "1299", "right": "1371"},
        "color": "1F1F1F",
    },
    "Normal": {"spacing": {"before": "80"}, "ind": {"left": "1299"}},
    "Heading 1": {"spacing": {"before": "402"}},
    "Heading 2": {"spacing": {"before": "60"}, "color": "1F1F1F"},
    "Heading 3": {"spacing": {"before": "60"}},
    "Heading 4": {"spacing": {"before": "60"}, "color": "424242"},
    "Heading 6": {"spacing": {"before": "60"}, "color": "666666"},
    "Heading 7": {"spacing": {"before": "60"}},
    "List Paragraph": {"color": "1F1F1F"},
}


def aplicar_formato(par, estilo, **sobrescribir):
    """Copia al párrafo el formato directo que tenían los del original."""
    reglas = dict(FORMATO.get(estilo, {}))
    reglas.update(sobrescribir)
    pPr = par._p.get_or_add_pPr()
    for etiqueta in ("spacing", "ind"):
        attrs = reglas.get(etiqueta)
        if not attrs:
            continue
        # `get_or_add_*` respeta el orden que exige el esquema de OOXML;
        # añadirlos con append deja el `pPr` inválido y Word se queja.
        el = getattr(pPr, f"get_or_add_{etiqueta}")()
        for clave, valor in attrs.items():
            el.set(qn(f"w:{clave}"), valor)
    return reglas.get("color")


class Escritor:
    """Va soltando párrafos y tablas al final del cuerpo, antes del `sectPr`."""

    def __init__(self, doc, proto_numpr, proto_tbl6, proto_tbl2):
        self.doc = doc
        self.cuerpo = doc.element.body
        self.sect = self.cuerpo.find(qn("w:sectPr"))
        self.proto_numpr = proto_numpr
        self.proto_tbl6 = proto_tbl6
        self.proto_tbl2 = proto_tbl2
        self.titulos = []
        self.tablas = 0
        self.color = None
        self.huecos = {}

    def _colocar(self, elemento):
        if self.sect is not None:
            self.sect.addprevious(elemento)
        else:
            self.cuerpo.append(elemento)

    def _parrafo(self, estilo, **formato):
        p = self.doc.add_paragraph(style=estilo)
        self._colocar(p._p)
        self.color = aplicar_formato(p, estilo, **formato)
        return p

    def _escribir(self, par, texto):
        from docx.shared import RGBColor

        t = par.add_run(texto)
        if self.color:
            t.font.color.rgb = RGBColor.from_string(self.color)
        return t

    def h(self, nivel, texto):
        p = self._parrafo(f"Heading {nivel}")
        self._escribir(p, texto)
        self.titulos.append((nivel, texto))
        return p

    def p(self, texto):
        par = self._parrafo("Body Text")
        self._escribir(par, texto)
        return par

    def n(self, texto=""):
        par = self._parrafo("Normal")
        if texto:
            self._escribir(par, texto)
        return par

    def li(self, texto):
        par = self._parrafo("List Paragraph")
        if self.proto_numpr is not None:
            # `numPr` va justo detrás de `pStyle`: el esquema lo coloca antes
            # que `spacing` y que `ind`, que es lo que acaba de poner
            # `aplicar_formato`.
            pPr = par._p.get_or_add_pPr()
            copia = copy.deepcopy(self.proto_numpr)
            estilo = pPr.find(qn("w:pStyle"))
            if estilo is not None:
                estilo.addnext(copia)
            else:
                pPr.insert(0, copia)
        self._escribir(par, texto)
        return par

    def codigo(self, lineas):
        from docx.shared import Pt

        for linea in lineas:
            # Sin el espaciado de `Normal`: entre renglones de código abre un
            # hueco que parte el bloque.
            par = self._parrafo("Normal", spacing={"before": "0", "after": "0"})
            t = par.add_run(linea if linea else "")
            t.font.name = "Consolas"
            t.font.size = Pt(9)

    def hueco(self, clave):
        """Deja un ancla donde después se pegan las figuras del original.

        Es un párrafo vacío. Las imágenes se insertan delante de él, así que
        el ancla acaba haciendo de renglón en blanco tras la figura.
        """
        par = self.n()
        self.huecos.setdefault(clave, []).append(par._p)
        return par

    def tabla(self, filas, columnas):
        proto = self.proto_tbl6 if columnas == 6 else self.proto_tbl2
        self._colocar(clonar_tabla(proto, filas))
        self.n()
        self.tablas += 1


# --- Contenido --------------------------------------------------------------


def fundamentacion(w):
    w.h(1, "FUNDAMENTACIÓN TEÓRICA")

    w.h(2, "INGENIERÍA DE SOFTWARE ASISTIDA POR COMPUTADORA — CASE")
    w.p(
        "La Ingeniería de Software Asistida por Computadora es la aplicación de un conjunto de "
        "métodos, técnicas y herramientas automatizadas orientadas a dar soporte al ingeniero de "
        "software durante todas las fases del ciclo de vida del desarrollo de sistemas (SDLC). Su "
        "objetivo principal es transferir a la máquina la carga de trabajo repetitiva y propensa a "
        "errores que de otro modo recae en la persona: mantener la coherencia entre los modelos, "
        "generar el código a partir de ellos, validar la consistencia lógica y sostener la "
        "trazabilidad entre requisito, diseño e implementación."
    )
    w.p(
        "Las herramientas CASE se clasifican habitualmente por el tramo del ciclo de vida que "
        "cubren:"
    )
    w.li(
        "CASE de alto nivel (Upper-CASE): se enfocan en las actividades iniciales —planificación, "
        "análisis de requisitos y diseño conceptual—, y producen modelos antes que código."
    )
    w.li(
        "CASE de bajo nivel (Lower-CASE): se centran en la implementación y la prueba, e incluyen "
        "la generación de código, la ingeniería inversa y la depuración."
    )
    w.li(
        "CASE integrada (I-CASE): cubren el ciclo completo y, sobre todo, mantienen un único "
        "repositorio de modelos del que se derivan tanto la documentación como el código."
    )
    w.p(
        "Este proyecto es, literalmente, una herramienta CASE integrada. Parte de un diagrama de "
        "clases UML editado en el navegador, lo valida, y emite un proyecto Spring Boot completo "
        "—entidad, repositorio, servicio, controlador y DTO— que compila y arranca sin que nadie "
        "escriba una línea de Java entre medias. La trazabilidad no es documental sino ejecutable: "
        "el catálogo de casos de uso, los ficheros XMI de intercambio y el capítulo de casos de uso "
        "de este mismo documento se generan del mismo módulo fuente, de modo que no pueden "
        "contradecirse entre sí. Cuando un caso de uso cambia, cambian los tres a la vez o no "
        "cambia ninguno."
    )

    w.h(2, "DESARROLLO DE SOFTWARE BASADO EN COMPONENTES")
    w.p(
        "El Desarrollo de Software Basado en Componentes es la rama de la ingeniería de software "
        "que enfatiza la separación de intereses: el sistema se construye ensamblando unidades "
        "autónomas y sustituibles, cada una de las cuales encapsula una funcionalidad concreta y se "
        "comunica con las demás únicamente a través de interfaces explícitas. Sus beneficios "
        "declarados son:"
    )
    w.li("Reutilización: un componente ya probado se integra en un sistema nuevo sin reescribirlo.")
    w.li("Mantenibilidad: el cambio queda localizado en el componente, no repartido por el sistema.")
    w.li("Sustituibilidad: dos implementaciones de la misma interfaz son intercambiables.")
    w.li("Verificabilidad: se puede probar un componente contra su interfaz, aislado del resto.")
    w.p(
        "En este sistema el enfoque se materializa en un monorepo de cuatro paquetes con "
        "dependencias declaradas y dirigidas: «shared» contiene el modelo UML, la validación, las "
        "operaciones sobre el documento colaborativo, la lectura y escritura de XMI y el catálogo "
        "de diagramas; «generator» contiene la representación intermedia y las plantillas que "
        "producen el proyecto Spring Boot; «backend-tool» contiene la API REST, el servidor de "
        "colaboración por WebSocket y los almacenes de persistencia; y «frontend» contiene la "
        "aplicación web instalable. La frontera entre ellos no es una convención sino un contrato "
        "de tipos comprobado por el compilador: «shared» no importa nada de los otros tres, y por "
        "eso el mismo modelo sirve en el navegador, en el servidor y en la aplicación móvil."
    )
    w.p(
        "La sustituibilidad tiene un ejemplo concreto y verificable en el proyecto. La persistencia "
        "está detrás de tres interfaces —«ProjectStore», «DocumentStore» e «IdentityProvider»— con "
        "dos implementaciones cada una: una sobre el sistema de ficheros, para desarrollo, y otra "
        "sobre PostgreSQL, para producción. Cuál se usa lo decide una variable de entorno al "
        "arrancar. Cambiar de una a otra no toca ni la API, ni el editor, ni una sola prueba de las "
        "que verifican el comportamiento: las mismas pruebas se ejecutan contra ambas."
    )

    w.h(2, "PROCESO DE DISEÑO PARA BASES DE DATOS RELACIONALES")
    w.p(
        "El diseño de una base de datos relacional procede en tres niveles sucesivos, cada uno más "
        "cercano a la tecnología que el anterior, y su disciplina consiste en no adelantar "
        "decisiones de un nivel al anterior:"
    )
    w.li(
        "Modelado conceptual: se identifican las entidades del dominio, sus atributos y las "
        "relaciones entre ellas, sin comprometerse todavía con ningún gestor concreto."
    )
    w.li(
        "Modelado lógico: el modelo conceptual se traduce a relaciones y se normaliza —típicamente "
        "hasta la tercera forma normal— para eliminar la redundancia y, con ella, la posibilidad de "
        "que dos copias del mismo dato discrepen."
    )
    w.li(
        "Modelado físico: se eligen los tipos concretos, las claves primarias y foráneas, las "
        "restricciones de dominio y los índices que sostienen las consultas que la aplicación "
        "realmente ejecuta."
    )
    w.li(
        "Evolución del esquema: los cambios posteriores se aplican mediante migraciones "
        "versionadas y ordenadas, de manera que el estado de la base sea reproducible."
    )
    w.p(
        "La garantía que distingue al modelo relacional es la integridad referencial declarada: la "
        "base rechaza el dato incoherente aunque la aplicación tenga un fallo, y las transacciones "
        "ACID aseguran que una operación compuesta se aplique entera o no se aplique. Esa garantía "
        "se paga con un esquema rígido, y por eso hay dominios en los que no compensa."
    )
    w.p(
        "En este proyecto sí compensa, y la razón es doble. Primero, porque el dominio de la "
        "herramienta —usuarios, proyectos y miembros con un rol sobre un proyecto— es exactamente "
        "el caso que el modelo relacional resuelve bien: pocas entidades, relaciones claras y una "
        "restricción de dominio sobre el rol que conviene que vigile la base y no el código. "
        "Segundo, y menos evidente, porque el contenido del diagrama no se guarda como datos "
        "consultables: se guarda como un binario opaco, el estado del documento colaborativo "
        "codificado. Sobre ese binario una base documental no aportaría nada, porque nunca se "
        "consulta por su contenido; se lee entero o no se lee. De modo que la elección real no era "
        "«relacional contra documental para el diagrama», sino «relacional para los metadatos, que "
        "sí se consultan, y una columna binaria para el diagrama, que no». PostgreSQL 16 hace las "
        "dos cosas."
    )

    w.h(2, "COMPARATIVA DE HERRAMIENTAS PARA EL DESARROLLO DE SOFTWARE")
    w.p(
        "La comparativa de herramientas es un proceso analítico de toma de decisiones que evalúa "
        "alternativas contra criterios explícitos antes de comprometerse con una. Los criterios "
        "aplicados en este proyecto fueron:"
    )
    w.li("Curva de aprendizaje y comunidad: documentación disponible, soporte y adopción real.")
    w.li("Interoperabilidad: capacidad de integrarse con el resto del ecosistema sin adaptadores.")
    w.li("Rendimiento y escalabilidad: consumo de recursos en desarrollo y en producción.")
    w.li("Coste total de propiedad: licenciamiento, infraestructura y coste de salida.")
    w.li("Soporte a la automatización: integración con pruebas automáticas y despliegue continuo.")
    w.p(
        "Aplicados a las decisiones que este sistema tuvo que tomar, el resultado fue el siguiente. "
        "Cada fila incluye lo que se descartó, porque una elección sin alternativa descartada "
        "normalmente significa que no se evaluó nada."
    )
    w.tabla(
        [
            ["Decisión", "Elegido, descartado y por qué"],
            [
                "Lienzo del editor",
                "Elegido React Flow sobre un lienzo propio en Canvas 2D. El diseño inicial "
                "descartaba React Flow por considerar que la semántica UML obligaría a luchar "
                "contra la biblioteca; en la práctica el coste de mantener el enrutado, la "
                "selección y el zoom a mano resultó mayor que el de adaptar la biblioteca, y se "
                "cambió de opinión con el código delante.",
            ],
            [
                "Estado colaborativo",
                "Elegido CRDT (Yjs). Descartado el bloqueo pesimista por documento, que impide la "
                "edición simultánea, y descartado el «último que escribe gana», que pierde "
                "trabajo sin avisar. El CRDT converge sin servidor árbitro y sin pedir permiso.",
            ],
            [
                "Base de datos",
                "Elegido PostgreSQL 16. Descartado SQLite por el sistema de ficheros efímero del "
                "contenedor, que borraría la base en cada despliegue, y descartada una base "
                "documental porque el único dato grande del sistema es binario y no se consulta.",
            ],
            [
                "Formato de intercambio",
                "Elegido XMI 2.1. Descartados los formatos propios de cada herramienta: XMI es lo "
                "que Enterprise Architect, Papyrus y StarUML leen y escriben, y es lo que permite "
                "que el diagrama salga de aquí y entre allí sin volver a dibujarlo.",
            ],
            [
                "Plantillas del generador",
                "Elegido Handlebars sobre concatenación de cadenas. La plantilla es un fichero "
                "Java legible con huecos, no una cadena dentro de un bucle: se revisa como se "
                "revisa el código, y el error se ve antes de compilar la salida.",
            ],
            [
                "Aplicación móvil",
                "Elegido Flutter con un puente nativo de voz. Descartada una segunda aplicación "
                "web, porque el reconocimiento de voz del navegador no funciona sin conexión, que "
                "es justo el caso que la aplicación móvil tenía que cubrir.",
            ],
            [
                "Plataforma de despliegue",
                "Elegido EC2 con Docker detrás de CloudFront. Descartado App Runner y Lightsail "
                "Containers, no por criterio técnico sino porque la cuenta no los habilita; "
                "descartado S3 + CloudFront para el frontend con el backend aparte, porque rompe "
                "el WebSocket del canal colaborativo al dejar de haber un mismo origen.",
            ],
        ],
        columnas=2,
    )

    w.h(2, "PUDS (Proceso Unificado de Desarrollo de Software)")
    w.p(
        "El Proceso Unificado de Desarrollo de Software es un marco de proceso iterativo e "
        "incremental que organiza el desarrollo en cuatro fases —inicio, elaboración, construcción "
        "y transición— atravesadas por flujos de trabajo que se repiten con distinta intensidad en "
        "cada iteración: requisitos, análisis, diseño, implementación y prueba. Se apoya en tres "
        "principios:"
    )
    w.li(
        "Iterativo e incremental: el desarrollo se divide en iteraciones que terminan en un "
        "incremento funcional, no en un documento."
    )
    w.li(
        "Dirigido por casos de uso: los requisitos funcionales se capturan como casos de uso, y "
        "son ellos los que arrastran el diseño, la implementación y la prueba."
    )
    w.li(
        "Centrado en la arquitectura: la arquitectura se define, se valida y se estabiliza pronto, "
        "porque es lo más caro de cambiar tarde."
    )
    w.p(
        "En este proyecto el PUDS encaja por una razón concreta: el riesgo no estaba repartido de "
        "forma uniforme. Que un diagrama de clases produzca un proyecto Spring Boot que de verdad "
        "compile es la incógnita que decidía si el sistema entero era viable, y se resolvió en la "
        "fase de elaboración —contra un proyecto real, compilándolo y arrancándolo— antes de "
        "construir nada encima. El resto de los flujos de trabajo se han recorrido en cada "
        "iteración, y este documento los presenta en ese orden."
    )
    w.p(
        "Conviene decir dónde el proyecto se apartó del proceso, porque es más honesto que "
        "fingir que no ocurrió. Los documentos de requisitos, arquitectura, stack y plan de "
        "sprints se escribieron antes de empezar y se conservan tal cual: son el diseño, no el "
        "acta de lo ocurrido. Donde el código se apartó de ellos —el lienzo, el gestor de "
        "paquetes, la plataforma de despliegue— manda el código, y la diferencia está anotada."
    )

    w.h(2, "UML 2.5")
    w.p(
        "UML (Unified Modeling Language) es el lenguaje gráfico estándar para visualizar, "
        "especificar, construir y documentar los artefactos de un sistema software. Su versión 2.5 "
        "reorganiza la especificación y define catorce tipos de diagrama, agrupados en dos "
        "familias:"
    )
    w.li(
        "Diagramas estructurales: muestran la estructura estática del sistema. Los usados aquí son "
        "el diagrama de clases, el de paquetes y el de componentes."
    )
    w.li(
        "Diagramas de comportamiento: muestran la dinámica y la interacción. Los usados aquí son "
        "el de casos de uso, el de comunicación, el de secuencia, el de actividades y el de "
        "estados."
    )
    w.p(
        "En este proyecto UML no es solo notación de documentación: es el formato de entrada del "
        "generador. El diagrama de clases que se dibuja en el editor —con sus atributos tipados, "
        "sus multiplicidades y su herencia— es lo que se recorre para emitir las entidades JPA, "
        "las claves foráneas y las tablas intermedias de las relaciones muchos a muchos. Un error "
        "en el modelo no es un error de dibujo: es código que no compila. Por eso el editor "
        "incorpora un revisor que señala lo que impide generar antes de intentarlo."
    )
    w.p(
        "El intercambio con otras herramientas se hace en XMI 2.1, en los dos sentidos y "
        "verificado contra Enterprise Architect. Los diagramas de análisis de este documento no se "
        "dibujaron a mano: se emiten desde el catálogo del proyecto como ficheros XMI y se abren "
        "en la herramienta, que es lo que garantiza que el diagrama y el código digan lo mismo."
    )

    w.h(2, "INTELIGENCIA ARTIFICIAL")
    w.p(
        "En el contexto de la ingeniería de software, la inteligencia artificial se emplea aquí "
        "para eliminar dos trabajos manuales concretos, no como adorno: transcribir a mano un "
        "diagrama que ya existe dibujado en una pizarra, y navegar una interfaz con el ratón "
        "cuando lo que se quiere expresar cabe en una frase. Los dos frentes son la visión por "
        "computador y el procesamiento de lenguaje natural."
    )

    w.h(4, "VISIÓN POR COMPUTADOR APLICADA AL MODELADO")
    w.p(
        "El aprendizaje profundo es el subcampo del aprendizaje automático que utiliza redes "
        "neuronales de múltiples capas para extraer progresivamente características de alto nivel "
        "a partir de datos en bruto. En visión, las primeras capas responden a bordes y "
        "gradientes, y las últimas a estructuras compuestas; esa jerarquía es lo que permite pasar "
        "de píxeles a objetos sin programar reglas."
    )
    w.p(
        "Los modelos multimodales actuales integran el codificador visual y el modelo de lenguaje "
        "en un mismo sistema, de forma que la salida no es una lista de cajas detectadas sino una "
        "descripción estructurada. Es lo que este proyecto aprovecha: a partir de la fotografía de "
        "un diagrama de clases dibujado en una pizarra, el modelo devuelve las clases, sus "
        "atributos con tipo y las relaciones con su multiplicidad, en el mismo formato que produce "
        "el editor. El resultado no se aplica directamente: se presenta como un conjunto de "
        "operaciones revisables sobre el diagrama, que el usuario acepta o descarta una a una. La "
        "razón es que un modelo se equivoca, y un error silencioso en el modelo de clases se "
        "convierte más tarde en código."
    )
    w.p(
        "La limitación conocida y no resuelta es que la lectura desde imagen no se ha medido "
        "contra un corpus de fotografías: funciona sobre los ejemplos probados, pero no hay una "
        "cifra de acierto que defender, y este documento no la inventa."
    )

    w.h(4, "PROCESAMIENTO DE LENGUAJE NATURAL")
    w.p(
        "El procesamiento de lenguaje natural busca que un sistema interprete instrucciones "
        "expresadas como las expresaría una persona. La arquitectura dominante desde 2017 es el "
        "transformador, cuyo mecanismo de atención pondera todas las posiciones de la secuencia a "
        "la vez en lugar de arrastrar un estado oculto paso a paso; eso resuelve la pérdida de "
        "información a larga distancia que limitaba a las redes recurrentes y, además, permite "
        "paralelizar el entrenamiento."
    )
    w.p(
        "Aquí el NLP resuelve dos problemas distintos que conviene no confundir. En el editor, "
        "traduce una frase dictada —«crea una clase Pedido con fecha y total», «relaciona Cliente "
        "con Pedido uno a muchos»— a operaciones sobre el diagrama, con confirmación hablada antes "
        "de ejecutar cualquier acción destructiva. En la aplicación móvil, traduce una frase "
        "dictada a una llamada contra el backend que se generó a partir de un diagrama: el modelo "
        "no conoce ese backend de antemano, sino que se guía por un manifiesto que el propio "
        "backend publica describiendo sus entidades y sus campos."
    )
    w.p(
        "El paso de voz a texto se hace con un modelo de reconocimiento automático del habla. La "
        "distinción importante es que el reconocimiento del navegador exige conexión, mientras que "
        "el puente nativo de la aplicación móvil puede usar el reconocedor del sistema operativo, "
        "que en muchos dispositivos funciona sin ella."
    )

    w.h(4, "MODELOS EN EL DISPOSITIVO Y FUNCIONAMIENTO SIN CONEXIÓN")
    w.p(
        "Ejecutar el modelo en el dispositivo del usuario en lugar de en un servidor cambia tres "
        "cosas: no hay latencia de red, no hay coste por petición y el dato no sale del "
        "dispositivo. A cambio, el modelo tiene que caber y tiene que ser rápido en hardware "
        "modesto, lo que obliga a modelos pequeños y cuantizados."
    )
    w.p(
        "Este proyecto lo aplica en la guía: el botón de ayuda responde preguntas sobre el propio "
        "sistema buscando dentro de su documentación, y puede hacerlo contra un modelo remoto o "
        "contra un modelo local servido en la misma máquina. Cuando no hay ninguno de los dos, no "
        "falla: devuelve el fragmento del manual que corresponde. Ese comportamiento está "
        "verificado por una prueba que simula el fallo del modelo y comprueba que la respuesta "
        "sigue llegando."
    )

    w.h(2, "GENERACIÓN AUTOMÁTICA DE CÓDIGO Y DESARROLLO DIRIGIDO POR MODELOS")
    w.p(
        "El desarrollo dirigido por modelos (MDD) sostiene que el artefacto principal del "
        "desarrollo no debe ser el código sino el modelo, y que el código debe derivarse de él "
        "mediante transformaciones automáticas. Su promesa es la coherencia: si el código se "
        "deriva, no puede divergir del modelo. Su riesgo conocido es el viaje de ida sin vuelta, "
        "cuando alguien edita el código generado y el modelo deja de describir el sistema."
    )
    w.p(
        "La transformación que implementa este proyecto va del diagrama de clases UML a un "
        "proyecto Spring Boot sobre PostgreSQL, y no se detiene en las entidades. De cada clase "
        "salen cinco artefactos —entidad JPA, repositorio, servicio, controlador REST y DTO—, más "
        "las migraciones SQL del esquema, el manejador global de excepciones, la configuración y "
        "el proyecto Maven completo. Las relaciones se traducen a lo que les corresponde: una "
        "asociación uno a muchos produce la clave foránea y las dos anotaciones que la reflejan; "
        "una muchos a muchos produce la tabla intermedia; la herencia produce la estrategia de "
        "mapeo correspondiente."
    )
    w.p(
        "Que el resultado compile no es una afirmación de este documento: los proyectos generados "
        "se compilan y se arrancan como parte de la verificación, y el conjunto de pruebas "
        "automáticas del repositorio comprueba el contenido del código emitido, no solo que el "
        "generador no lance una excepción."
    )

    w.h(2, "EDICIÓN COLABORATIVA EN TIEMPO REAL: CRDT")
    w.p(
        "Un CRDT (tipo de dato replicado sin conflictos) es una estructura de datos diseñada para "
        "que varias réplicas puedan modificarse de forma independiente y converger al mismo estado "
        "cuando intercambian sus cambios, sin necesidad de un árbitro central que ordene las "
        "operaciones y sin descartar el trabajo de nadie. La propiedad que lo hace posible es que "
        "la operación de mezcla es conmutativa, asociativa e idempotente: da igual en qué orden "
        "lleguen los cambios y da igual que lleguen repetidos."
    )
    w.p(
        "Para un editor de diagramas esto resuelve el problema exacto: dos personas mueven dos "
        "clases distintas a la vez y ambas se mueven; dos personas editan el mismo atributo y el "
        "resultado es determinista en las dos pantallas. Además resuelve el trabajo sin conexión "
        "casi gratis, porque un cliente desconectado es simplemente una réplica que todavía no ha "
        "sincronizado: los cambios se guardan en el navegador y se mezclan al volver."
    )
    w.p(
        "La decisión de arquitectura asociada, y la que más consecuencias tuvo, es que el CRDT "
        "es el estado: la interfaz se suscribe a él y se redibuja, en lugar de mantener una copia "
        "del modelo en un gestor de estado y sincronizarla. Duplicar el modelo habría producido "
        "dos fuentes de verdad que divergen, que es precisamente el problema que el CRDT venía a "
        "eliminar."
    )

    w.h(2, "INFRAESTRUCTURA EN LA NUBE: EC2, CLOUDFRONT Y RDS")
    w.p(
        "El despliegue de este sistema tiene una restricción que condiciona todo lo demás: el "
        "canal colaborativo es un WebSocket, y un WebSocket necesita una conexión persistente y el "
        "mismo origen que la aplicación web. Eso descarta los esquemas habituales de servir el "
        "frontend estático desde un almacenamiento de objetos y el backend desde otro sitio, "
        "porque el navegador acaba buscando el socket donde no está."
    )
    w.p(
        "La arquitectura desplegada es, por tanto, una sola instancia EC2 ejecutando la aplicación "
        "en Docker, con CloudFront delante y RDS PostgreSQL detrás. CloudFront actúa como "
        "terminador de TLS —el HTTPS no es opcional aquí, porque el micrófono y la cámara no "
        "funcionan en un origen inseguro— y documenta explícitamente el soporte de WebSocket, que "
        "era la incógnita a despejar. RDS vive en la misma VPC y en la misma zona de "
        "disponibilidad que la instancia, lo que permitió cerrar el puerto de la base de datos al "
        "grupo de seguridad de la máquina en lugar de dejarlo abierto a internet."
    )
    w.p(
        "Dos consecuencias merecen mención. La primera es que el sistema de ficheros del "
        "contenedor es efímero: cualquier cosa escrita en disco desaparece en el siguiente "
        "despliegue, y eso es lo que obliga a PostgreSQL y no a una base en fichero. La segunda es "
        "que la región no es un detalle administrativo: la instancia, la base de datos y el "
        "registro de imágenes tienen que estar los tres en la misma, o el tráfico entre ellos sale "
        "a internet y se paga."
    )


def captura_de_requisitos(w, datos):
    casos = datos["casos"]

    w.h(1, "PROCESO DE DESARROLLO")
    w.h(2, "CAPTURA DE REQUISITOS")

    w.h(4, "ACTORES")
    w.p(
        "En el marco del Proceso Unificado se han identificado los siguientes actores. Los tres "
        "papeles sobre un proyecto —propietario, editor y lector— heredan de «Usuario»: todo lo "
        "que puede hacer un usuario cualquiera lo pueden hacer ellos, y cada uno añade lo suyo. "
        "Los dos últimos no tienen cuenta en el editor, y por eso no heredan de nadie."
    )
    for actor in datos["actores"]:
        codigo = CODIGO_ACTOR[actor["nombre"]]
        herencia = f" Especializa a {actor['hereda']}." if actor.get("hereda") else ""
        w.li(f"{actor['nombre']} ({codigo}): {actor['descripcion']}{herencia}")

    w.h(4, "LISTA DE CASOS DE USO")
    w.p(
        "Se enumeran los diecinueve casos de uso del sistema, agrupados en los seis paquetes "
        "funcionales en que se reparte el modelo. La numeración es la del catálogo del proyecto y "
        "es la misma que llevan los ficheros XMI de intercambio."
    )
    por_id = {c["id"]: c for c in casos}
    for paquete in datos["paquetes"]:
        w.h(7, f"{paquete['nombre']}")
        w.p(paquete["descripcion"])
        for cid in paquete["casos"]:
            c = por_id[cid]
            w.li(f"{c['id']} — {c['nombre']}: {c['descripcion']}")

    w.h(4, "PRIORIZACIÓN DE CASOS DE USO")
    w.p(
        "Estado indica lo que está construido y en funcionamiento, no lo que está planificado. "
        "El ciclo es el parcial en que se entregó: C1 lo que ya se presentó en el primero y C2 lo "
        "que se incorpora en este. Los códigos de actor son los de la sección anterior."
    )
    filas = [["NRO", "CASO DE USO", "ESTADO", "PRIORIDAD", "ACTOR", "CICLO"]]
    for c in casos:
        codigos = ",".join(
            CODIGO_ACTOR[n.strip()] for n in c["actores"].split(",") if n.strip() in CODIGO_ACTOR
        )
        filas.append(
            [
                c["id"],
                c["nombre"],
                "IMPLEMENTADO",
                PRIORIDAD[c["id"]],
                codigos,
                CICLO_POR_PAQUETE[c["paquete"]],
            ]
        )
    w.tabla(filas, columnas=6)

    w.h(4, "DETALLE DE CASO DE USO")
    w.p(
        "El flujo de sucesos se expresa como la secuencia de mensajes de ida entre los "
        "participantes del caso, con el nombre corto de cada uno. Los mensajes de retorno se "
        "omiten aquí a propósito: se ven en el diagrama de comunicación, que es su sitio."
    )
    for c in casos:
        w.h(7, f"{c['id']} — {c['nombre']}")
        filas = [
            ["Campo", "Descripción"],
            ["Caso de uso", f"{c['id']} {c['nombre']}"],
            ["Paquete", c["paquete"]],
            ["Propósito", c["descripcion"]],
            ["Actores", c["actores"]],
            ["Actor iniciador", c["actor"]],
            ["Precondición", c["precondicion"]],
            ["Flujo de sucesos", c["flujo"]],
            ["Postcondición", c["postcondicion"]],
        ]
        if c["alternativos"]:
            filas.append(
                [
                    "Flujos alternativos",
                    [f"{a['nombre']}: {a['texto']}" for a in c["alternativos"]],
                ]
            )
        filas.append(
            [
                "Clases de análisis",
                [
                    f"{p['alias']} : {p['clase']} «{p['estereotipo']}»"
                    for p in c["participantes"]
                ],
            ]
        )
        w.tabla(filas, columnas=2)
        w.hueco("detalle")

    w.h(4, "ESTRUCTURAR EL MODELO DE CASOS DE USO")
    w.p(
        "El diagrama de casos de uso del sistema, con los seis actores, los diecinueve casos y las "
        "relaciones de generalización entre los papeles de proyecto."
    )
    w.hueco("estructurar")


def analisis(w, datos):
    casos = datos["casos"]

    w.h(2, "FLUJO DE TRABAJO: ANÁLISIS")
    w.p(
        "El objetivo de esta fase es refinar los requisitos capturados y transformarlos en una "
        "estructura de objetos que sirva de entrada al diseño. Se identifican los paquetes de "
        "análisis, y dentro de cada caso de uso, las clases de análisis que participan y los "
        "mensajes que se intercambian."
    )

    w.h(4, "ANÁLISIS DE ARQUITECTURA")
    w.h(6, "IDENTIFICAR PAQUETES")
    w.p(
        "El modelo se reparte en seis paquetes de análisis. El criterio de reparto es funcional y "
        "coincide con la agrupación de los casos de uso, no con la separación por capas: las capas "
        "aparecen dentro de cada paquete, en los estereotipos de las clases de análisis."
    )
    filas = [["Paquete", "Contenido"]]
    for p in datos["paquetes"]:
        filas.append([p["nombre"], f"{p['descripcion']} Casos: {', '.join(p['casos'])}."])
    w.tabla(filas, columnas=2)
    w.hueco("paquetes")

    w.h(6, "RELACIONAR PAQUETES Y CASOS DE USO")
    w.hueco("relacionar")
    w.h(6, "VISTA DE PAQUETES")
    w.hueco("vista")

    w.h(4, "ANÁLISIS DE CASOS DE USO")
    w.p(
        "Cada caso de uso se analiza identificando sus clases de análisis con los tres "
        "estereotipos del método —«boundary» para lo que toca el usuario, «control» para la lógica "
        "que coordina y «entity» para lo que persiste— y el intercambio de mensajes entre ellas. "
        "Las clases de análisis de cada caso están listadas en la tabla de detalle correspondiente "
        "de la sección anterior, y cada una lleva anotado el fichero del proyecto que la respalda: "
        "no son clases inventadas para el documento."
    )

    w.h(6, "DIAGRAMAS DE COMUNICACIÓN")
    w.p(
        "Un diagrama de comunicación por caso de uso, con los participantes, los mensajes "
        "numerados de ida y los de retorno."
    )
    for c in casos:
        w.h(7, f"{c['id']} — {c['nombre']}")
        w.hueco("comunicacion")

    w.h(6, "DIAGRAMAS DE ACTIVIDADES")
    w.p(
        "Se modelan los casos con bifurcación real, es decir, aquellos en que el flujo depende de "
        "una decisión y no es una secuencia lineal."
    )
    for cid in ["CU3", "CU9", "CU11", "CU13", "CU16", "CU18"]:
        c = next(x for x in casos if x["id"] == cid)
        w.h(7, f"{c['id']} — {c['nombre']}")
        w.hueco("actividad")

    w.h(6, "DIAGRAMAS DE SECUENCIA")
    w.p(
        "Se modelan los casos en que el orden temporal y la duración de la activación aportan algo "
        "que el diagrama de comunicación no muestra."
    )
    for cid in ["CU1", "CU8", "CU9", "CU13", "CU15", "CU16"]:
        c = next(x for x in casos if x["id"] == cid)
        w.h(7, f"{c['id']} — {c['nombre']}")
        w.hueco("secuencia")

    w.h(6, "DIAGRAMAS DE ESTADO")
    w.p(
        "Se modelan las entidades cuyo ciclo de vida tiene estados con transiciones restringidas."
    )
    for entidad in ["Proyecto", "Documento colaborativo", "Envío de la bandeja de salida"]:
        w.h(7, f"Entidad: {entidad}")
        w.hueco("estado")

    w.h(6, "ANÁLISIS DE CLASES")
    w.p(
        "Diagrama de clases de análisis por caso de uso, con los tres estereotipos y las "
        "asociaciones entre ellos."
    )
    for cid in ["CU1", "CU8", "CU9", "CU11", "CU13", "CU15"]:
        c = next(x for x in casos if x["id"] == cid)
        w.h(7, f"{c['id']} — {c['nombre']}")
        w.hueco("clases_cu")


def diseno(w):
    w.h(2, "FLUJO DE TRABAJO: DISEÑO")

    w.h(4, "DISEÑO DE ARQUITECTURA")
    w.p(
        "La arquitectura se documenta con el modelo C4, que describe el sistema en cuatro niveles "
        "de zoom sucesivos: contexto, contenedores, componentes y código. El criterio para bajar "
        "de nivel es que el nivel anterior ya no responda la pregunta que se está haciendo."
    )
    w.h(6, "NIVEL 1 — CONTEXTO")
    w.p(
        "El sistema, sus seis actores y los tres sistemas externos con los que habla: el proveedor "
        "del modelo de lenguaje, la herramienta UML de terceros con la que se intercambia XMI, y "
        "el backend Spring Boot generado, que es un sistema aparte con el que la aplicación móvil "
        "se comunica directamente."
    )
    w.h(6, "NIVEL 2 — CONTENEDORES")
    w.p(
        "La aplicación web instalable, el servidor de aplicación —que sirve tanto la API REST como "
        "el canal WebSocket—, la base de datos PostgreSQL y la aplicación móvil Flutter."
    )
    w.h(6, "NIVEL 3 — COMPONENTES")
    w.p(
        "Los cuatro paquetes del monorepo y las dependencias dirigidas entre ellos: el modelo "
        "compartido no depende de nadie, el generador y el servidor dependen del modelo, y la "
        "aplicación web depende del modelo y habla con el servidor."
    )
    for componente in [
        "modelo compartido, validación y XMI",
        "generador de código Spring Boot",
        "API REST y almacenes de persistencia",
        "servidor de colaboración y control de permisos",
        "editor de diagramas y lienzo",
        "asistencia por voz y visión",
    ]:
        w.h(7, f"Componente: {componente}")
        w.hueco("componente")
    w.h(6, "NIVEL 4 — CÓDIGO")
    w.p(
        "Diagrama de clases del generador, que es el componente en que el nivel de código aporta "
        "algo: la representación intermedia y su recorrido por las plantillas."
    )

    w.h(6, "DISEÑO LÓGICO")
    w.p("Diagrama de paquetes organizado en capas.")

    w.h(4, "DISEÑO DE DATOS")
    w.h(6, "DIAGRAMA DE CLASES")
    w.p(
        "El diagrama de clases del dominio de la herramienta. Conviene no confundirlo con el "
        "diagrama que el usuario dibuja dentro de la herramienta: aquel es el dato, este es el "
        "sistema."
    )
    w.hueco("clases_ciclo")

    w.h(4, "DISEÑO FÍSICO")
    w.p(
        "Esquema relacional sobre PostgreSQL 16. Se aplica al arrancar y es idempotente: todo va "
        "con «if not exists», porque se ejecuta en cada arranque y no como una migración única. "
        "Los nombres van en español porque el resto del dominio también."
    )
    w.n()
    w.n("Tabla usuarios")
    w.codigo(
        [
            "create table if not exists usuarios (",
            "  id          uuid primary key,",
            "  correo      text not null unique,",
            "  nombre      text not null,",
            "  sal         text not null,",
            "  hash        text not null,",
            "  creado_en   timestamptz not null default now()",
            ");",
            "",
            "alter table usuarios add column if not exists sal_recuperacion  text;",
            "alter table usuarios add column if not exists hash_recuperacion text;",
        ]
    )
    w.p(
        "La contraseña no se guarda: se guarda «hash», que es scrypt sobre la contraseña con la "
        "«sal» de la fila. El código de recuperación recibe el mismo tratamiento, de modo que "
        "quien pueda leer la tabla tampoco puede recuperar cuentas con lo que ve. Las dos columnas "
        "de recuperación se añaden con «alter table» y no dentro del «create», porque el «create» "
        "lleva «if not exists» y en una base que ya existía no habría añadido nada."
    )
    w.n()
    w.n("Tabla proyectos")
    w.codigo(
        [
            "create table if not exists proyectos (",
            "  id             uuid primary key,",
            "  nombre         text not null,",
            "  descripcion    text not null default '',",
            "  propietario_id uuid not null,",
            "  creado_en      timestamptz not null default now(),",
            "  actualizado_en timestamptz not null default now()",
            ");",
        ]
    )
    w.n()
    w.n("Tabla miembros")
    w.codigo(
        [
            "create table if not exists miembros (",
            "  proyecto_id uuid not null references proyectos(id) on delete cascade,",
            "  usuario_id  uuid not null,",
            "  rol         text not null check (rol in ('owner', 'editor', 'viewer')),",
            "  primary key (proyecto_id, usuario_id)",
            ");",
            "",
            "create index if not exists miembros_por_usuario on miembros (usuario_id);",
        ]
    )
    w.p(
        "El rol lleva una restricción de dominio declarada en la base y no solo comprobada en el "
        "código: es exactamente el tipo de invariante que conviene que sobreviva a un fallo de la "
        "aplicación. El índice por usuario existe porque «mis proyectos» es la consulta de la "
        "pantalla inicial y va por el lado por el que la clave primaria compuesta no ayuda."
    )
    w.p(
        "«propietario_id» y «miembros.usuario_id» no llevan clave foránea contra «usuarios», y no "
        "es un descuido. El almacén de proyectos y el proveedor de identidad son dos interfaces "
        "independientes, y esa independencia es deliberada: si la identidad la aporta algún día un "
        "proveedor externo, sus usuarios no estarán en esta base. Una foránea aquí haría imposible "
        "esa combinación justo cuando tocara hacerla. Dentro de un mismo almacén sí se usan, "
        "porque ahí no hay frontera que cruzar."
    )
    w.n()
    w.n("Tabla documentos")
    w.codigo(
        [
            "create table if not exists documentos (",
            "  sala_id        text primary key,",
            "  estado         bytea not null,",
            "  actualizado_en timestamptz not null default now()",
            ");",
        ]
    )
    w.p(
        "«estado» es el documento colaborativo entero codificado como binario opaco: no se "
        "consulta por su contenido. Vive en una tabla aparte de «proyectos» porque los ciclos de "
        "vida no se parecen —los metadatos cambian una vez al mes y el documento cada dos "
        "segundos— y porque una fila con un binario grande reescrito constantemente es justo lo "
        "que no conviene tener pegado a la tabla que se consulta para pintar la lista de "
        "proyectos."
    )
    w.n()
    w.p(
        "El esquema que produce el generador para el proyecto Spring Boot es distinto de este y no "
        "se escribe a mano: sale del diagrama de clases del usuario como migraciones versionadas, "
        "con las claves foráneas de las asociaciones uno a muchos y las tablas intermedias de las "
        "muchos a muchos. Se añade además una tabla de idempotencia, que es la que permite que la "
        "aplicación móvil reenvíe lo que quedó pendiente sin conexión sin duplicar registros."
    )
    w.hueco("fisico")


def implementacion(w):
    w.h(2, "FLUJO DE TRABAJO: IMPLEMENTACIÓN")
    w.p(
        "La implementación se organiza como un monorepo con cuatro paquetes y dependencias "
        "declaradas, más dos proyectos que viven fuera del árbol de TypeScript: la aplicación "
        "móvil en Flutter y el proyecto Spring Boot que el generador produce."
    )
    w.li("shared — modelo UML, validación, operaciones colaborativas, XMI y catálogo de diagramas.")
    w.li("generator — representación intermedia y plantillas Handlebars del proyecto Spring Boot.")
    w.li("backend-tool — API REST, servidor de colaboración WebSocket, almacenes y asistencia IA.")
    w.li("frontend — aplicación web instalable, editor, lienzo y pantallas de revisión.")
    w.li("movil — aplicación Flutter genérica guiada por el manifiesto del backend generado.")
    w.p(
        "La aplicación se empaqueta en una imagen Docker que sirve el frontend construido desde el "
        "mismo servidor Express que expone la API, y no desde un almacenamiento aparte. Eso no es "
        "una simplificación: es lo que mantiene el mismo origen que el canal WebSocket necesita."
    )

    w.h(4, "DIAGRAMA DE COMPONENTES Y SUBSISTEMAS")
    w.hueco("componentes_sub")

    w.h(4, "DIAGRAMA DE DESPLIEGUE")
    w.p(
        "Los nodos físicos y el tráfico entre ellos: navegador y teléfono contra CloudFront, "
        "CloudFront contra la instancia EC2 por HTTP y WebSocket, y la instancia contra RDS dentro "
        "de la misma VPC."
    )


def prueba(w):
    w.h(2, "FLUJO DE TRABAJO: PRUEBA")
    w.p(
        "El repositorio ejecuta 1 245 pruebas automáticas repartidas en 49 ficheros, y pasan todas. "
        "La cifra por sí sola no dice mucho, así que conviene decir qué prueban: no que las "
        "funciones se llamen sin lanzar una excepción, sino el comportamiento observable. La "
        "prueba del generador comprueba el contenido del Java emitido; la del canal colaborativo "
        "abre dos clientes y verifica la convergencia; la de permisos comprueba que un lector "
        "recibe los cambios y no puede hacerlos."
    )
    w.p(
        "A continuación se detallan los casos de prueba de los módulos centrales. El campo Estado "
        "distingue lo verificado por una prueba automática de lo comprobado a mano, porque no es "
        "lo mismo y confundirlo sería mentir."
    )

    pruebas = [
        {
            "id": "CP-01",
            "cu": "CU13 — Generar el backend Spring Boot",
            "proposito": "Verificar que un diagrama de clases válido produce un proyecto Spring Boot "
            "que compila y arranca contra PostgreSQL.",
            "pre": "Existe un proyecto con al menos dos clases y una asociación uno a muchos entre "
            "ellas. El diagrama pasa la validación.",
            "pasos": [
                "1. Abrir el proyecto y pulsar «Generar backend».",
                "2. Comprobar el recuento por capas antes de descargar: entidad, repositorio, "
                "servicio, controlador y DTO por cada clase.",
                "3. Descargar el ZIP y descomprimirlo.",
                "4. Ejecutar la compilación del proyecto Maven y arrancarlo.",
            ],
            "esperado": "El proyecto compila sin errores, arranca, aplica las migraciones y "
            "responde en el punto de salud. La asociación uno a muchos aparece como clave foránea "
            "en el esquema y como las dos anotaciones JPA correspondientes.",
            "estado": "Verificado por prueba automática sobre el contenido emitido, y verificado a "
            "mano compilando y arrancando tres proyectos generados distintos.",
        },
        {
            "id": "CP-02",
            "cu": "CU8 — Editar el diagrama en tiempo real",
            "proposito": "Verificar que dos ediciones simultáneas sobre el mismo diagrama "
            "convergen al mismo estado en ambos clientes, sin pérdida.",
            "pre": "Dos sesiones abiertas sobre el mismo proyecto, ambas con permiso de edición.",
            "pasos": [
                "1. Mover una clase en el cliente A y crear otra clase en el cliente B, a la vez.",
                "2. Desconectar el cliente B, seguir editando en ambos.",
                "3. Reconectar el cliente B.",
            ],
            "esperado": "Los dos clientes muestran el mismo diagrama, con los cambios de ambos. "
            "Ninguna edición se pierde y ninguna se aplica dos veces.",
            "estado": "Verificado por prueba automática del canal colaborativo.",
        },
        {
            "id": "CP-03",
            "cu": "CU6 / CU7 — Abrir proyecto e invitar a un colaborador",
            "proposito": "Verificar que el permiso de solo lectura se aplica en el canal "
            "colaborativo y no únicamente en la interfaz.",
            "pre": "Un proyecto con un miembro de rol «viewer».",
            "pasos": [
                "1. Abrir el proyecto con la sesión del lector.",
                "2. Comprobar que recibe los cambios que hace un editor.",
                "3. Intentar enviar un cambio desde la sesión del lector, saltándose la interfaz.",
            ],
            "esperado": "El lector recibe los cambios. El mensaje que intenta escribir se rechaza "
            "en el servidor y queda registrado; el documento no se modifica.",
            "estado": "Verificado por prueba automática.",
        },
        {
            "id": "CP-04",
            "cu": "CU10 — Importar y exportar XMI",
            "proposito": "Verificar el intercambio en los dos sentidos con una herramienta UML "
            "externa sin pérdida de información del modelo.",
            "pre": "Un proyecto con clases, atributos tipados, herencia y relaciones con "
            "multiplicidad.",
            "pasos": [
                "1. Exportar el diagrama a XMI 2.1 y abrirlo en Enterprise Architect.",
                "2. Modificar el modelo en la herramienta externa y volver a exportarlo.",
                "3. Importar el fichero resultante en el editor.",
            ],
            "esperado": "La herramienta externa abre el fichero sin avisos. La importación se "
            "presenta como una lista de operaciones revisables, no como un reemplazo directo, y al "
            "aceptarlas el diagrama refleja los cambios.",
            "estado": "Verificado por prueba automática de ida y vuelta, y verificado a mano "
            "contra Enterprise Architect.",
        },
        {
            "id": "CP-05",
            "cu": "CU9 — Importar un diagrama desde una foto",
            "proposito": "Verificar que a partir de la fotografía de un diagrama de clases se "
            "obtienen clases, atributos y relaciones como operaciones revisables.",
            "pre": "Una fotografía legible de un diagrama de clases y la clave del modelo "
            "configurada.",
            "pasos": [
                "1. Abrir «Desde imagen» y tomar o seleccionar la fotografía.",
                "2. Esperar la lectura y revisar la lista de operaciones propuestas.",
                "3. Rechazar una operación incorrecta y aceptar el resto.",
            ],
            "esperado": "Se proponen las clases y relaciones detectadas. Nada se aplica al "
            "diagrama hasta que el usuario acepta. La operación rechazada no deja rastro.",
            "estado": "Verificado a mano sobre ejemplos. No medido contra un corpus: no hay cifra "
            "de acierto.",
        },
        {
            "id": "CP-06",
            "cu": "CU11 — Editar el diagrama por voz",
            "proposito": "Verificar que una orden dictada se traduce a la operación correcta y que "
            "las acciones destructivas piden confirmación hablada.",
            "pre": "Sesión abierta sobre un proyecto con permiso de edición y micrófono "
            "autorizado.",
            "pasos": [
                "1. Dictar «crea una clase Pedido con fecha y total».",
                "2. Dictar «relaciona Cliente con Pedido uno a muchos».",
                "3. Dictar «borra la clase Pedido».",
            ],
            "esperado": "Las dos primeras órdenes se ejecutan. La tercera se repite en voz alta y "
            "espera confirmación antes de aplicarse.",
            "estado": "Verificado por prueba automática del intérprete de órdenes. La confirmación "
            "hablada, verificada a mano en el dispositivo.",
        },
        {
            "id": "CP-07",
            "cu": "CU15 — Dictar una orden al asistente móvil",
            "proposito": "Verificar que un solo APK sirve para cualquier backend generado, sin "
            "recompilar, leyendo el manifiesto que el backend publica.",
            "pre": "Un backend generado en marcha y la aplicación móvil apuntando a él.",
            "pasos": [
                "1. Abrir la aplicación y comprobar que lista las entidades del backend.",
                "2. Dictar el alta de un registro con dos campos.",
                "3. Regenerar el backend desde un diagrama distinto y repetir sin reinstalar.",
            ],
            "esperado": "La aplicación muestra las entidades del backend actual en ambos casos. La "
            "orden dictada crea el registro con los campos correctos.",
            "estado": "Verificado por pruebas automáticas del manifiesto y del intérprete, y "
            "verificado a mano en un teléfono real.",
        },
        {
            "id": "CP-08",
            "cu": "CU16 — Registrar datos sin conexión y sincronizarlos al volver",
            "proposito": "Verificar que lo dictado sin cobertura se guarda y que al reenviarlo no "
            "se duplica.",
            "pre": "Aplicación móvil con la bandeja de salida vacía y el dispositivo en modo "
            "avión.",
            "pasos": [
                "1. Dictar dos altas sin conexión.",
                "2. Cerrar y volver a abrir la aplicación, comprobando que siguen en la bandeja.",
                "3. Restaurar la conexión y forzar el reenvío dos veces seguidas.",
            ],
            "esperado": "Los dos registros aparecen una sola vez en el backend. El segundo reenvío "
            "no crea duplicados, porque la clave de idempotencia se rechaza en el servidor.",
            "estado": "Verificado por prueba automática del filtro de idempotencia. El caso del "
            "modo avión en el teléfono está pendiente de comprobación.",
        },
        {
            "id": "CP-09",
            "cu": "CU3 / CU4 — Recuperar la contraseña y emitir el código",
            "proposito": "Verificar la recuperación sin servidor de correo y la revocación de las "
            "sesiones abiertas al cambiar la contraseña.",
            "pre": "Una cuenta con un código de recuperación emitido y una sesión abierta en otro "
            "navegador.",
            "pasos": [
                "1. Usar el código para fijar una contraseña nueva.",
                "2. Intentar reutilizar el mismo código.",
                "3. Recargar en el navegador donde había una sesión abierta.",
            ],
            "esperado": "La contraseña cambia. El código no vale una segunda vez. La sesión que "
            "estaba abierta deja de valer y pide entrar de nuevo.",
            "estado": "Verificado por pruebas automáticas sobre las dos implementaciones del "
            "proveedor de identidad.",
        },
        {
            "id": "CP-10",
            "cu": "CU17 / CU18 — Revisar el modelado y arreglar lo que impide generar",
            "proposito": "Verificar que el revisor señala los defectos del modelo antes de generar "
            "y que la corrección automática los resuelve sin romper nada más.",
            "pre": "Un diagrama con una clase sin identificador, un atributo sin tipo y una "
            "relación sin multiplicidad.",
            "pasos": [
                "1. Pulsar el revisor y leer la lista de problemas.",
                "2. Pulsar «Arreglar lo que impide generar».",
                "3. Volver a revisar y generar.",
            ],
            "esperado": "El revisor enumera los tres problemas con la clase afectada. Tras la "
            "corrección no queda ninguno que impida generar, y la generación produce un proyecto "
            "que compila.",
            "estado": "Verificado por prueba automática del revisor y de las correcciones.",
        },
    ]

    w.h(7, "Diseño de casos de prueba")
    for cp in pruebas:
        w.h(7, f"{cp['id']}: {cp['cu']}")
        w.tabla(
            [
                ["Campo", "Descripción"],
                ["ID caso de prueba", cp["id"]],
                ["Caso de uso asociado", cp["cu"]],
                ["Propósito", cp["proposito"]],
                ["Precondiciones", cp["pre"]],
                ["Pasos a ejecutar", cp["pasos"]],
                ["Resultado esperado", cp["esperado"]],
                ["Estado", cp["estado"]],
            ],
            columnas=2,
        )
        w.hueco("cp")

    w.h(4, "LO QUE NO ESTÁ CUBIERTO")
    w.p(
        "Decir qué falta vale más que inflar la lista de lo que hay. Tres cosas están "
        "implementadas y no las vigila ninguna prueba: el dictado sin conexión en el teléfono en "
        "modo avión, la lectura desde fotografía medida contra un corpus —funciona sobre ejemplos, "
        "pero no hay una cifra de acierto— y el pase completo de aceptación de la interfaz con "
        "teclado. Además, las pruebas de componente del frontend están escritas pero no se "
        "ejecutan todavía por una dependencia de entorno pendiente de instalar."
    )


def guia_de_uso(w):
    w.h(1, "GUÍA DE USO")
    w.p(
        "El sistema no se explica con un manual aparte: la propia aplicación responde preguntas "
        "sobre sí misma. Aun así, este es el recorrido completo, en el orden en que tiene sentido "
        "hacerlo la primera vez."
    )
    w.hueco("guia")

    w.h(4, "ENTRAR Y CREAR EL PRIMER PROYECTO")
    w.li(
        "Registrar la cuenta con correo y contraseña. Al terminar el registro se muestra una sola "
        "vez un código de recuperación: conviene copiarlo antes de cerrar esa pantalla, porque no "
        "se vuelve a enseñar y aquí no hay «te hemos enviado un correo»."
    )
    w.li("Entrar. La pantalla inicial es la lista de proyectos.")
    w.li(
        "Crear un proyecto con nombre y descripción. Quien lo crea es su propietario y es el único "
        "que puede repartir permisos y pedir la generación del backend."
    )

    w.h(4, "DIBUJAR EL DIAGRAMA")
    w.li(
        "La paleta de la izquierda tiene los elementos y las relaciones. Se arrastra una clase al "
        "lienzo y se editan sus atributos y métodos en el panel de propiedades."
    )
    w.li(
        "Para crear una relación se arrastra de un borde de una clase al borde de otra, y después "
        "se ajusta la multiplicidad en cada extremo. La multiplicidad importa: es lo que decide si "
        "el generador emite una clave foránea o una tabla intermedia."
    )
    w.li(
        "El árbol del proyecto y la barra de estado —zoom, conexión, presencia y selección— dicen "
        "en todo momento con quién se está compartiendo el lienzo."
    )
    w.li(
        "No hay botón de guardar y no es un olvido: cada cambio se propaga y se persiste solo. Si "
        "se pierde la conexión se sigue trabajando, y al volver los cambios se mezclan."
    )

    w.h(4, "PARTIR DE UNA FOTO O DE OTRA HERRAMIENTA")
    w.li(
        "«Desde imagen» toma una fotografía del diagrama dibujado en una pizarra y propone las "
        "clases, los atributos y las relaciones que ha leído. Nada se aplica hasta aceptarlo: la "
        "propuesta llega como una lista de operaciones que se revisan una a una, y la foto se "
        "puede ampliar y arrastrar para comprobarlas contra el original."
    )
    w.li(
        "«Importar XMI» hace lo mismo desde un fichero de Enterprise Architect, Papyrus o StarUML. "
        "«Exportar XMI» produce el fichero para el camino contrario."
    )

    w.h(4, "HABLARLE AL EDITOR")
    w.li(
        "El botón del micrófono escucha órdenes sobre el diagrama: crear clases, añadir atributos, "
        "relacionar, renombrar y borrar."
    )
    w.li(
        "Las acciones destructivas se repiten en voz alta y esperan una confirmación antes de "
        "aplicarse. Es deliberado: dictar es rápido y equivocarse dictando también."
    )

    w.h(4, "REVISAR ANTES DE GENERAR")
    w.li(
        "El revisor de modelado dice qué está mal en el diagrama: clases sin identificador, "
        "atributos sin tipo, relaciones sin multiplicidad, nombres que no son válidos en Java."
    )
    w.li(
        "«Arreglar lo que impide generar» corrige automáticamente lo que tiene una corrección "
        "evidente, y deja para el usuario lo que exige una decisión."
    )

    w.h(4, "GENERAR EL BACKEND Y VER QUÉ SALE")
    w.li(
        "«Generar backend» muestra el recuento por capas antes de descargar nada: contesta si "
        "están las cuatro capas más el DTO sin necesidad de abrir el ZIP."
    )
    w.li(
        "El diagrama de comunicación del backend generado muestra quién llama a quién entre las "
        "cuatro capas, con la línea de Java que respalda cada mensaje. No sale de las relaciones "
        "del diagrama de clases, sino del código emitido."
    )
    w.li("Descargado el ZIP, el proyecto se compila y se arranca con Maven contra PostgreSQL.")

    w.h(4, "USAR EL BACKEND GENERADO DESDE EL TELÉFONO")
    w.li(
        "La aplicación móvil no se recompila para cada proyecto. Se apunta al backend generado, "
        "lee el manifiesto que este publica y construye sola las pantallas de alta, consulta y "
        "edición de sus entidades."
    )
    w.li(
        "Se le puede dictar el alta de un registro. Conviene no confundir esto con dictarle al "
        "editor: en el editor se habla para cambiar el diagrama; aquí se habla para dar de alta un "
        "dato en la aplicación que salió de ese diagrama."
    )
    w.li(
        "Sin cobertura lo dictado queda en una bandeja de salida y se reenvía al volver la "
        "conexión. Reenviar no duplica: cada envío lleva una clave que el servidor rechaza si ya "
        "la vio."
    )

    w.h(4, "PREGUNTARLE A LA APLICACIÓN")
    w.li(
        "El botón de ayuda busca dentro de la documentación del propio proyecto y responde. "
        "Funciona contra un modelo remoto o contra uno local; si no hay ninguno de los dos, "
        "devuelve el fragmento del manual que corresponde en vez de fallar."
    )


def rehacer_indice(doc):
    """Sustituye el índice congelado del original por un campo TOC de verdad.

    El bloque `sdt` de la plantilla no traía un campo: traía el índice ya
    resuelto, con los títulos del proyecto anterior, sus números de página y
    enlaces a marcadores que ya no existen. Copiarlo tal cual habría dejado en
    la página dos un índice que miente sobre el resto del documento.

    Se deja en su lugar un campo `TOC` marcado como sucio, que Word rellena al
    abrir el fichero. Hasta entonces se ve el texto de aviso.
    """
    from docx.oxml import parse_xml
    from docx.oxml.ns import nsmap

    sdt = doc.element.body.find(qn("w:sdt"))
    if sdt is None:
        return False
    contenido = sdt.find(qn("w:sdtContent"))
    for hijo in list(contenido):
        contenido.remove(hijo)

    ns = " ".join(f'xmlns:{p}="{u}"' for p, u in nsmap.items() if p in ("w",))
    contenido.append(
        parse_xml(
            f"<w:p {ns}>"
            '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>'
            '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-4" \\h \\z \\u </w:instrText></w:r>'
            '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
            "<w:r><w:t>Índice: haz clic aquí y pulsa F9 para generarlo.</w:t></w:r>"
            '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
            "</w:p>"
        )
    )
    return True


# --- Figuras del documento original -----------------------------------------
#
# El original traía 105 figuras y se conservan todas, incluidas las que no
# tienen nada que ver con este proyecto: se reaprovechan después por fuera.
#
# No se recodifica ninguna. Se copia el `w:p` entero que la contenía, con su
# `w:drawing`, su anclaje y su `docPr`, y se deja intacto `word/media`, así que
# resolución, formato y metadatos son los mismos bytes del fichero de partida.
# El `r:embed` sigue apuntando a la relación que ya existe en el paquete,
# porque la plantilla es el propio documento original.
#
# Tramos por orden de aparición en el original y ancla de destino. Cuando hay
# más figuras que anclas, las que sobran se apilan en la última ancla del
# tramo, para que ningún grupo se desparrame a otra sección.
TRAMOS = [
    (5, 23, "detalle"),          # 19 fichas de caso de uso
    (24, 24, "estructurar"),
    (25, 28, "paquetes"),
    (29, 32, "relacionar"),
    (33, 33, "vista"),
    (34, 52, "comunicacion"),    # 19 diagramas de comunicación
    (53, 66, "actividad"),       # 14 de actividad para 6 anclas
    (67, 69, "estado"),
    (70, 75, "secuencia"),
    (76, 80, "fisico"),
    (81, 86, "componente"),
    (87, 88, "clases_ciclo"),
    (89, 89, "componentes_sub"),
    (90, 102, "cp"),             # 13 de casos de prueba para 10 anclas
    (103, 105, "guia"),
]


def limpiar_figura(p):
    """Deja el párrafo con la figura y nada más.

    Una imagen anclada cuelga del párrafo que la precede, y en el original ese
    párrafo era muchas veces el título de la sección. Copiarlo entero
    devolvía al documento dieciséis títulos del proyecto anterior —y al
    índice con ellos—, así que se tira todo lo que no sea el dibujo: el texto,
    los marcadores y los enlaces. La figura y su anclaje no se tocan.

    Devuelve cuánto texto se ha quitado, para poder contarlo.
    """
    quitado = 0
    for hijo in list(p):
        if hijo.tag == qn("w:pPr"):
            continue
        tiene_figura = (
            hijo.tag == qn("w:r")
            and (hijo.find(f".//{qn('w:drawing')}") is not None
                 or hijo.find(f".//{qn('w:pict')}") is not None)
        )
        if tiene_figura:
            # Dentro del run puede venir texto pegado a la imagen.
            for t in hijo.findall(qn("w:t")):
                quitado += len(t.text or "")
                hijo.remove(t)
            continue
        quitado += len("".join(hijo.itertext()))
        p.remove(hijo)

    pPr = p.find(qn("w:pPr"))
    if pPr is not None:
        # Sin estilo de título no entra en el índice ni finge ser una sección.
        for etiqueta in ("w:pStyle", "w:outlineLvl", "w:numPr"):
            el = pPr.find(qn(etiqueta))
            if el is not None:
                pPr.remove(el)
    return quitado


def cosechar_figuras(cuerpo, corte):
    """Copia los párrafos con figura que hay detrás de la portada, en orden.

    Devuelve copias porque el cuerpo se vacía justo después. Se recorre con
    `iter`, que da los párrafos en orden de documento incluidos los de dentro
    de las tablas: trece de las figuras viven en celdas.
    """
    hijos = list(cuerpo.iterchildren())
    portada = {id(p) for h in hijos[:corte] for p in h.iter(qn("w:p"))}
    cosecha = []
    for p in cuerpo.iter(qn("w:p")):
        if id(p) in portada:
            continue
        cuantas = len(p.findall(f".//{qn('w:drawing')}")) + len(
            p.findall(f".//{qn('w:pict')}")
        )
        if cuantas:
            copia = copy.deepcopy(p)
            limpiar_figura(copia)
            cosecha.append((copia, cuantas))
    return cosecha


def repartir_figuras(cosecha, huecos):
    """Pega cada figura delante del ancla que le toca. Devuelve el reparto."""
    # `cosecha` va por párrafos y `TRAMOS` por figuras: hay párrafos con más
    # de una. Se numera cada párrafo con el ordinal de su primera figura,
    # contando desde la quinta, que es la primera de detrás de la portada.
    numerados = []
    n = 5
    for parrafo, cuantas in cosecha:
        numerados.append((n, parrafo, cuantas))
        n += cuantas

    reparto = {}
    colocadas = 0
    for desde, hasta, clave in TRAMOS:
        destinos = huecos.get(clave)
        if not destinos:
            continue
        del_tramo = [(i, p) for i, p, _ in numerados if desde <= i <= hasta]
        for pos, (_, parrafo) in enumerate(del_tramo):
            ancla = destinos[min(pos, len(destinos) - 1)]
            ancla.addprevious(parrafo)
            colocadas += 1
        reparto[clave] = (len(del_tramo), len(destinos))
    return reparto, colocadas


def comprobar_medios(ruta):
    """Ninguna imagen del paquete debe quedarse sin referenciar."""
    z = zipfile.ZipFile(ruta)
    documento = z.read("word/document.xml").decode("utf-8")
    usados = set(re.findall(r'r:(?:embed|id|link)="([^"]+)"', documento))
    rels = z.read("word/_rels/document.xml.rels").decode("utf-8")
    vivas = set()
    for rel in re.findall(r"<Relationship\b[^>]*/>", rels):
        rid = re.search(r'Id="([^"]+)"', rel).group(1)
        destino = re.search(r'Target="([^"]+)"', rel).group(1)
        if "/image" in rel and rid in usados:
            vivas.add(posixpath.normpath(posixpath.join("word", destino)))
    todas = {n for n in z.namelist() if n.startswith("word/media/")}
    return len(todas), len(vivas), sorted(todas - vivas)


def podar_medios(ruta):
    """Quita del .zip las imágenes que ya no referencia nadie.

    Ya no se usa: ahora se conservan todas las figuras del original. Se deja
    porque es la operación inversa y cuesta poco tenerla a mano.

    Devuelve (borradas, bytes_ahorrados).
    """
    origen = zipfile.ZipFile(ruta)
    partes = {n: origen.read(n) for n in origen.namelist()}
    origen.close()

    # Identificadores de relación que alguna parte usa de verdad.
    usados = {}
    for nombre, datos in partes.items():
        if not nombre.endswith(".xml"):
            continue
        try:
            texto = datos.decode("utf-8")
        except UnicodeDecodeError:
            continue
        usados[nombre] = set(re.findall(r'r:(?:embed|id|link)="([^"]+)"', texto))

    vivos = set()
    for nombre, datos in list(partes.items()):
        if not nombre.endswith(".rels"):
            continue
        duenyo = posixpath.join(
            posixpath.dirname(posixpath.dirname(nombre)),
            posixpath.basename(nombre)[:-5],
        ).lstrip("/")
        referencias = usados.get(duenyo, set())
        texto = datos.decode("utf-8")
        conservadas = []
        for rel in re.findall(r"<Relationship\b[^>]*/>", texto):
            rid = re.search(r'Id="([^"]+)"', rel).group(1)
            destino = re.search(r'Target="([^"]+)"', rel).group(1)
            es_imagen = "/image" in rel and not destino.startswith("http")
            if es_imagen and rid not in referencias:
                continue
            conservadas.append(rel)
            if es_imagen:
                vivos.add(
                    posixpath.normpath(
                        posixpath.join(posixpath.dirname(duenyo), destino)
                    )
                )
        nuevo = re.sub(r"<Relationship\b[^>]*/>", "", texto)
        nuevo = nuevo.replace("</Relationships>", "".join(conservadas) + "</Relationships>")
        partes[nombre] = nuevo.encode("utf-8")

    sobrantes = [
        n for n in partes
        if n.startswith("word/media/") and posixpath.normpath(n) not in vivos
    ]
    ahorro = sum(len(partes[n]) for n in sobrantes)
    for n in sobrantes:
        del partes[n]

    temporal = ruta.with_suffix(".tmp")
    with zipfile.ZipFile(temporal, "w", zipfile.ZIP_DEFLATED) as destino:
        for nombre, datos in partes.items():
            destino.writestr(nombre, datos)
    shutil.move(str(temporal), str(ruta))
    return len(sobrantes), ahorro


# --- Montaje ----------------------------------------------------------------


def main():
    if not PLANTILLA.exists():
        sys.exit(f"No existe la plantilla {PLANTILLA}")
    if not CASOS.exists():
        sys.exit(f"No existe {CASOS}. Ejecuta antes `npx tsx backend-tool/scripts/casos-a-json.ts`.")

    datos = json.loads(CASOS.read_text(encoding="utf-8"))
    doc = Document(str(PLANTILLA))
    cuerpo = doc.element.body

    # Prototipos: hay que capturarlos antes de vaciar el cuerpo.
    proto_tbl6 = copy.deepcopy(doc.tables[0]._tbl)
    proto_tbl2 = copy.deepcopy(doc.tables[7]._tbl)
    proto_numpr = None
    for p in doc.paragraphs:
        if p.style.name == "List Paragraph":
            pPr = p._p.find(qn("w:pPr"))
            if pPr is not None and pPr.find(qn("w:numPr")) is not None:
                proto_numpr = copy.deepcopy(pPr.find(qn("w:numPr")))
                break

    # La portada y el índice se conservan; el cuerpo se tira entero. El corte va
    # justo detrás del bloque `sdt`, que es la tabla de contenido como campo.
    hijos = list(cuerpo.iterchildren())
    corte = next(i for i, h in enumerate(hijos) if h.tag.endswith("}sdt")) + 1

    # Las figuras se rescatan antes del borrado y se vuelven a colocar al final.
    cosecha = cosechar_figuras(cuerpo, corte)

    for h in hijos[corte:]:
        if h.tag.endswith("}sectPr"):
            continue
        cuerpo.remove(h)

    # La portada dice el semestre equivocado.
    for p in doc.paragraphs:
        for t in p.runs:
            if "Semestre 1" in t.text:
                t.text = t.text.replace("Semestre 1", "Semestre 2")

    # El índice de la plantilla no es un campo: es una copia congelada del
    # índice del proyecto anterior, con sus títulos y sus páginas.
    indice = rehacer_indice(doc)

    w = Escritor(doc, proto_numpr, proto_tbl6, proto_tbl2)
    fundamentacion(w)
    captura_de_requisitos(w, datos)
    analisis(w, datos)
    diseno(w)
    implementacion(w)
    prueba(w)
    guia_de_uso(w)

    reparto, colocadas = repartir_figuras(cosecha, w.huecos)

    doc.save(str(SALIDA))

    imagenes = len(cuerpo.findall(
        ".//{http://schemas.openxmlformats.org/drawingml/2006/main}blip"
    ))
    total, vivas, huerfanas = comprobar_medios(SALIDA)
    print(f"{SALIDA}")
    print(f"  casos de uso : {len(datos['casos'])}")
    print(f"  tablas       : {w.tablas}")
    print(f"  títulos      : {len(w.titulos)}")
    print(f"  índice       : {'campo TOC nuevo' if indice else 'NO SE PUDO REHACER'}")
    print(f"  figuras      : {imagenes} colocadas ({colocadas} recuperadas "
          f"del original + 4 de portada)")
    print(f"  word/media   : {total} partes, {vivas} referenciadas, "
          f"{len(huerfanas)} huérfanas{' ' + str(huerfanas) if huerfanas else ''}")
    print(f"  tamaño       : {SALIDA.stat().st_size / 1024 / 1024:.1f} MB")
    print("  reparto por sección (figuras/anclas):")
    for desde, hasta, clave in TRAMOS:
        if clave in reparto:
            n, anclas = reparto[clave]
            sobran = f"  <- {n - anclas} apiladas en la última" if n > anclas else ""
            print(f"      {clave:<16} {n:3d} / {anclas:<3d}{sobran}")


if __name__ == "__main__":
    main()
