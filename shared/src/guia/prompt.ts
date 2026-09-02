/**
 * Lo que se le dice al modelo antes de la pregunta.
 *
 * Vive aquí, en `shared/`, porque hay **dos** motores que contestan la misma
 * pregunta: Ollama desde el navegador y DeepSeek desde el servidor. Quien
 * pregunta no elige cuál —lo elige la disponibilidad, ver Guía §5.7—, así que
 * dos prompts distintos darían dos formatos de respuesta para la misma duda y
 * parecería un fallo aunque las dos fuesen correctas. Estuvo duplicado y la
 * copia del servidor se quedó atrás en cuanto se corrigió la del navegador; eso
 * es exactamente lo que este módulo impide que vuelva a pasar.
 *
 * La instrucción central es que no invente. Un modelo de tres mil millones de
 * parámetros al que se le pregunta por una herramienta que no conoce responde
 * con lo que sabe de herramientas parecidas, en un tono perfectamente seguro, y
 * eso en una guía es peor que no responder: quien pregunta no tiene forma de
 * distinguirlo. Por eso se le da el manual y se le pide que se limite a él.
 *
 * La segunda es que la explicación va **antes** que la cita, y ese énfasis está
 * medido, no es estilo. La versión anterior terminaba con «cita entre comillas
 * angulares el título de la sección», y un modelo pequeño se agarra a la última
 * instrucción y a su formato: preguntado por cómo exportar XMI, llama3.2:3b
 * contestaba `«Exportar XMI»` y nada más —la cita entera, sin la respuesta—. Un
 * modelo grande entiende que citar es un añadido; uno de 3B necesita que se le
 * diga cuál de las dos partes es el cuerpo y cuál el pie. De ahí la línea que le
 * prohíbe contestar solo con el título: describe un fallo observado, no uno
 * hipotético, y lo cazó la prueba de integración contra Ollama de verdad.
 */
export const SISTEMA_GUIA = [
  'Eres la guía de una herramienta web para dibujar diagramas de clases UML,',
  'importar y exportar XMI, y generar un backend Spring Boot.',
  '',
  'Respondes ÚNICAMENTE con lo que diga el MANUAL que viene a continuación.',
  'Si el manual no lo dice, respondes exactamente: «Eso no lo cubre el manual.»',
  'y no añades nada más. No inventes botones, menús ni opciones que no aparezcan.',
  '',
  'Formato de la respuesta, en este orden:',
  '1. Explica en español los pasos concretos, en dos o cuatro frases.',
  '2. En una línea aparte al final, escribe: Fuente: «título de la sección».',
  '',
  'NUNCA respondas solo con el título de una sección: eso no es una respuesta.',
  'El paso 1 es obligatorio; el paso 2 va después y es una sola línea.',
].join('\n');

/**
 * Lo que se contesta cuando la búsqueda no encuentra nada.
 *
 * Es una constante y no un literal suelto porque aparece en tres sitios que
 * tienen que coincidir: el prompt se la dicta al modelo, y los dos motores la
 * devuelven por su cuenta —sin llamar a nadie— cuando no hay fuentes que citar.
 */
export const NO_CUBIERTO = 'Eso no lo cubre el manual.';
