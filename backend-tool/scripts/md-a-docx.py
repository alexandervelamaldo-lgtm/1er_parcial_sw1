"""
Convierte `docs/08-casos-de-uso.md` en un .docx que Google Docs abre bien.

Existe por una razón concreta y temporal: el conector de Drive no puede
escribir, así que el documento se sube a mano. Si algún día el conector
funciona, esto sobra — el contenido de verdad vive en
`shared/src/xmi/casos-de-uso.ts` y el markdown se genera con
`npm run diagramas`.

No es un conversor de markdown general y no pretende serlo. Entiende
exactamente lo que el generador emite: títulos de tres niveles, citas,
tablas de tubería, listas de guión y párrafos, con `código`, **negrita** y
*cursiva* en línea. Cualquier otra cosa pasa como texto plano, que para este
documento es un caso que no ocurre.
"""

import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor

RAIZ = Path(__file__).resolve().parents[2]
ENTRADA = RAIZ / "docs" / "08-casos-de-uso.md"
SALIDA = RAIZ / "docs" / "08-casos-de-uso.docx"

# `code`, **negrita**, *cursiva*. El orden importa: el código se parte primero
# para que un asterisco dentro de un identificador no se lea como cursiva.
TROZO = re.compile(r"(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)")

GRIS = RGBColor(0x44, 0x44, 0x44)


def escribir_texto(parrafo, texto):
    """Reparte el texto en tramos con su formato."""
    for trozo in TROZO.split(texto):
        if not trozo:
            continue
        if trozo.startswith("`") and trozo.endswith("`"):
            t = parrafo.add_run(trozo[1:-1])
            t.font.name = "Consolas"
            t.font.size = Pt(9)
            t.font.color.rgb = GRIS
        elif trozo.startswith("**") and trozo.endswith("**"):
            parrafo.add_run(trozo[2:-2]).bold = True
        elif trozo.startswith("*") and trozo.endswith("*"):
            parrafo.add_run(trozo[1:-1]).italic = True
        else:
            parrafo.add_run(trozo)


def celdas(linea):
    return [c.strip() for c in linea.strip().strip("|").split("|")]


def es_separador(linea):
    """La segunda fila de una tabla markdown: `| --- | --- |`."""
    return bool(re.fullmatch(r"\|[\s:|-]+\|", linea.strip()))


def main():
    if not ENTRADA.exists():
        sys.exit(f"No existe {ENTRADA}. Ejecuta antes `npm run diagramas`.")

    lineas = ENTRADA.read_text(encoding="utf-8").split("\n")
    doc = Document()
    doc.styles["Normal"].font.name = "Calibri"
    doc.styles["Normal"].font.size = Pt(11)

    i = 0
    tablas = 0
    while i < len(lineas):
        linea = lineas[i]
        pelada = linea.strip()

        if not pelada:
            i += 1
            continue

        # Tabla: cabecera, separador y filas hasta que se acaben.
        if pelada.startswith("|") and i + 1 < len(lineas) and es_separador(lineas[i + 1]):
            cabecera = celdas(pelada)
            filas = []
            i += 2
            while i < len(lineas) and lineas[i].strip().startswith("|"):
                filas.append(celdas(lineas[i]))
                i += 1

            tabla = doc.add_table(rows=1, cols=len(cabecera))
            tabla.style = "Light Grid Accent 1"
            for celda, texto in zip(tabla.rows[0].cells, cabecera):
                celda.text = ""
                escribir_texto(celda.paragraphs[0], texto)
                for t in celda.paragraphs[0].runs:
                    t.bold = True
            for fila in filas:
                destino = tabla.add_row().cells
                # Una fila con menos columnas que la cabecera se rellena sola.
                for celda, texto in zip(destino, fila):
                    celda.text = ""
                    escribir_texto(celda.paragraphs[0], texto)
            doc.add_paragraph()
            tablas += 1
            continue

        if pelada.startswith("### "):
            doc.add_heading(pelada[4:], level=3)
        elif pelada.startswith("## "):
            doc.add_heading(pelada[3:], level=2)
        elif pelada.startswith("# "):
            doc.add_heading(pelada[2:], level=1)
        elif pelada.startswith("> "):
            # La cita se junta entera en un párrafo: en el markdown viene
            # cortada a 90 columnas, y respetar ese corte en Word daría
            # saltos de línea donde no los hay.
            trozos = []
            while i < len(lineas) and lineas[i].strip().startswith(">"):
                trozos.append(lineas[i].strip().lstrip(">").strip())
                i += 1
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Pt(18)
            escribir_texto(p, " ".join(trozos))
            for t in p.runs:
                t.italic = True
                t.font.color.rgb = GRIS
            continue
        elif pelada.startswith("- "):
            escribir_texto(doc.add_paragraph(style="List Bullet"), pelada[2:])
        else:
            # Párrafo: se juntan las líneas seguidas, por lo mismo que la cita.
            trozos = []
            while i < len(lineas) and lineas[i].strip() and not re.match(
                r"^\s*(#|>|-\s|\|)", lineas[i]
            ):
                trozos.append(lineas[i].strip())
                i += 1
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            escribir_texto(p, " ".join(trozos))
            continue

        i += 1

    doc.save(SALIDA)
    casos = sum(1 for l in lineas if re.match(r"^## CU\d+ ", l))
    print(f"{SALIDA.relative_to(RAIZ)}  ({casos} casos, {tablas} tablas)")


if __name__ == "__main__":
    main()
