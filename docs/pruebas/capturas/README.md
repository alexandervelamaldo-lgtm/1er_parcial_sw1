# Capturas de evidencia de los casos de prueba (sección 2.5.1)

Una imagen por caso de prueba, nombrada con su identificador: `CP-01.png` … `CP-16.png`.

Cada captura contiene, en la propia imagen:

- el **identificador** del caso y su título, arriba a la izquierda;
- el **estado de la ejecución** —ÉXITO en verde o FALLO en rojo— arriba a la derecha, con el
  número de pruebas ejecutadas;
- el caso de uso asociado, el paquete, el propósito y las precondiciones;
- la **fecha y hora** de la ejecución, con la rama y el commit del repositorio;
- el entorno (sistema, Node, vitest, Flutter, Python);
- los **pasos ejecutados**, numerados;
- el **resultado esperado** y el **resultado obtenido**, uno al lado del otro;
- la **salida real del ejecutor de pruebas**, con el comando que la produjo, el recuento y la
  duración.

## Cómo se regeneran

```
py backend-tool/scripts/capturas-pruebas.py            # los dieciséis
py backend-tool/scripts/capturas-pruebas.py CP-07 CP-12  # solo algunos
```

El script **ejecuta** las pruebas de cada caso y compone la ficha con lo que devuelven. No
hay manera de que una captura afirme un éxito que no ocurrió: si una prueba falla, la
cabecera sale en rojo, el bloque de salida muestra la línea del fallo y el script termina con
código 2. Por eso la evidencia se regenera en lugar de retocarse.

La ficha se dibuja con Pillow, sin navegador. El script mide el texto, lo envuelve y va
bajando el cursor; después repite el dibujo sobre un lienzo del alto exacto que salió de esa
cuenta, así que la imagen no lleva blanco de sobra ni hay que recortarla. Cada una mide
2560 px de ancho —el doble de lo necesario— para que siga leyéndose cuando Word la reduce al
ancho de una página A4.

## Salida completa

En `logs/` queda la salida íntegra de cada ejecución, sin recortar, por si hace falta
consultar una línea que en la imagen aparece elidida.

## Lo que estas capturas no cubren

Tres pasos de la sección 2.5.1 no son automatizables en esta máquina y aparecen marcados
dentro de su propia imagen, en un aviso ámbar, en lugar de darse por hechos:

| Caso | Paso no cubierto | Motivo |
| --- | --- | --- |
| CP-06 | Abrir el XMI exportado en Enterprise Architect | EA no está instalado aquí |
| CP-07 | `mvn package` sobre el proyecto emitido | Maven no está instalado aquí; se verificó al cerrar las tareas 64 y 70 |
| CP-12 | Dictado sin conexión en un teléfono real en modo avión | Pendiente, tarea 47 del plan |

Para esos tres hay que adjuntar la captura hecha a mano junto a la generada.
