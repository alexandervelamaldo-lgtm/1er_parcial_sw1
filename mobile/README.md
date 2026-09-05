# uml_movil

Cliente móvil de la herramienta colaborativa de diagramas UML.

Son **dos aplicaciones dentro de la misma app**, y conviene saber cuál se está
mirando antes de tocar nada:

| | Qué es | Dónde vive |
|---|---|---|
| **Editor** | Una carcasa `WebView` sobre el editor de diagramas, con un puente nativo para el micrófono y el altavoz | `lib/main.dart` (`PantallaWeb`), `lib/voz_nativa.dart` |
| **Asistente** | Un cliente genérico del **backend generado**: lee su manifiesto y de ahí saca pantallas, formularios y vocabulario | `lib/asistente/` |

El editor sirve para dibujar el modelo. El asistente sirve para operar sobre los
datos de la aplicación que ese modelo generó: «apúntame una cita para mañana a
las diez» y la cita acaba en PostgreSQL.

## La guía está en `docs/`

**[docs/10-asistente-movil.md](../docs/10-asistente-movil.md)** es la
documentación de uso del asistente: el repertorio de órdenes, el ciclo hablado,
la bandeja de salida cuando no hay cobertura y por qué reenviar no duplica
nada. Este fichero solo tiene lo justo para arrancar.

## Arranque rápido

Con el backend generado ya escuchando en el 8080 y el teléfono por cable:

```bash
adb reverse tcp:8080 tcp:8080   # hay que repetirlo cada vez que se desconecta
cd mobile
flutter run --release
```

Dentro: **Asistente** → dirección del backend → **Conectar** → botón flotante
**«Pedir»**.

Para apuntar a otra dirección sin escribirla a mano cada vez:

```bash
flutter run --dart-define=BACKEND_URL=http://192.168.1.40:8080
```

Si la conexión falla, el sospechoso número uno es el `adb reverse`: con
`localhost` el teléfono se busca a sí mismo, no al portátil.

## Pruebas

```bash
flutter analyze
flutter test
```

Todo el asistente está probado sin teléfono. Eso es deliberado: el
reconocimiento de voz y la síntesis se usan a través de la interfaz `MotorDeVoz`
(`lib/asistente/voz.dart`) precisamente para poder sustituirlos en las pruebas,
porque los plugins reales hablan por canales de plataforma y lanzan
`MissingPluginException` bajo `flutter test`. Una prueba que necesita un teléfono
es una prueba que no se ejecuta.

Lo que sí hay que comprobar a mano en un dispositivo real está listado en
[§10.10](../docs/10-asistente-movil.md#1010-qué-está-probado).
