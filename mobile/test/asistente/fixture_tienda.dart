/// Copia literal del manifiesto que el generador emite para el corpus «tienda».
///
/// Se regenera con:
///
///     npm run demo -w @app/generator -- --corpus tienda --out ./salida/tienda
///
/// y aparece en `generator/salida/tienda/src/main/resources/asistente/manifiesto.json`.
///
/// Está copiado y no leído del disco porque las pruebas de la app no deben
/// exigir que alguien haya ejecutado el generador antes. La guarda contra que
/// las dos versiones se separen está en `manifiesto_test.dart`: si el fichero
/// de verdad existe, también se parsea.
const String manifiestoTienda = r'''
{
  "version": 1,
  "proyecto": "Tienda",
  "baseUrl": "/api",
  "idioma": "es",
  "cabeceraIdempotencia": "Idempotency-Key",
  "entidades": [
    {
      "nombre": "Cliente",
      "ruta": "/clientes",
      "etiquetaHablada": ["cliente", "clientes"],
      "identificador": { "nombre": "id", "tipo": "entero" },
      "campoEtiqueta": "nombre",
      "campos": [
        { "nombre": "nombre", "etiqueta": "nombre", "tipo": "texto", "obligatorio": true, "soloLectura": false, "maxLongitud": 255 },
        { "nombre": "email", "etiqueta": "email", "tipo": "texto", "obligatorio": true, "soloLectura": false, "maxLongitud": 255 },
        { "nombre": "fechaAlta", "etiqueta": "fecha alta", "tipo": "fecha", "obligatorio": false, "soloLectura": false }
      ],
      "acciones": ["listar", "ver", "crear", "actualizar", "borrar"],
      "criticas": ["borrar"],
      "borradoEnCascada": []
    },
    {
      "nombre": "Pedido",
      "ruta": "/pedidos",
      "etiquetaHablada": ["pedido", "pedidos"],
      "identificador": { "nombre": "id", "tipo": "entero" },
      "campos": [
        { "nombre": "fecha", "etiqueta": "fecha", "tipo": "fechaHora", "obligatorio": true, "soloLectura": false },
        { "nombre": "total", "etiqueta": "total", "tipo": "decimal", "obligatorio": true, "soloLectura": false },
        { "nombre": "estado", "etiqueta": "estado", "tipo": "enumerado", "obligatorio": true, "soloLectura": false,
          "valores": ["BORRADOR", "CONFIRMADO", "ENVIADO", "ENTREGADO", "CANCELADO"] },
        { "nombre": "clienteId", "etiqueta": "cliente", "tipo": "referencia", "obligatorio": true, "soloLectura": false, "entidad": "Cliente" }
      ],
      "acciones": ["listar", "ver", "crear", "actualizar", "borrar"],
      "criticas": ["borrar"],
      "borradoEnCascada": ["LineaPedido"]
    },
    {
      "nombre": "LineaPedido",
      "ruta": "/linea-pedidos",
      "etiquetaHablada": ["linea pedido", "linea pedidos"],
      "identificador": { "nombre": "id", "tipo": "entero" },
      "campos": [
        { "nombre": "cantidad", "etiqueta": "cantidad", "tipo": "entero", "obligatorio": true, "soloLectura": false },
        { "nombre": "precioUnitario", "etiqueta": "precio unitario", "tipo": "decimal", "obligatorio": true, "soloLectura": false },
        { "nombre": "pedidoId", "etiqueta": "pedido", "tipo": "referencia", "obligatorio": true, "soloLectura": false, "entidad": "Pedido" },
        { "nombre": "productoId", "etiqueta": "producto", "tipo": "referencia", "obligatorio": true, "soloLectura": false, "entidad": "Producto" }
      ],
      "acciones": ["listar", "ver", "crear", "actualizar", "borrar"],
      "criticas": ["borrar"],
      "borradoEnCascada": []
    },
    {
      "nombre": "Producto",
      "ruta": "/productos",
      "etiquetaHablada": ["producto", "productos"],
      "identificador": { "nombre": "id", "tipo": "entero" },
      "campoEtiqueta": "nombre",
      "campos": [
        { "nombre": "nombre", "etiqueta": "nombre", "tipo": "texto", "obligatorio": true, "soloLectura": false, "maxLongitud": 255 },
        { "nombre": "sku", "etiqueta": "sku", "tipo": "texto", "obligatorio": true, "soloLectura": false, "maxLongitud": 255 },
        { "nombre": "precio", "etiqueta": "precio", "tipo": "decimal", "obligatorio": true, "soloLectura": false },
        { "nombre": "activo", "etiqueta": "activo", "tipo": "booleano", "obligatorio": true, "soloLectura": false }
      ],
      "acciones": ["listar", "ver", "crear", "actualizar", "borrar"],
      "criticas": ["borrar"],
      "borradoEnCascada": []
    },
    {
      "nombre": "Categoria",
      "ruta": "/categorias",
      "etiquetaHablada": ["categoria", "categorias"],
      "identificador": { "nombre": "id", "tipo": "entero" },
      "campoEtiqueta": "nombre",
      "campos": [
        { "nombre": "nombre", "etiqueta": "nombre", "tipo": "texto", "obligatorio": true, "soloLectura": false, "maxLongitud": 255 }
      ],
      "acciones": ["listar", "ver", "crear", "actualizar", "borrar"],
      "criticas": ["borrar"],
      "borradoEnCascada": []
    }
  ],
  "enumerados": [
    {
      "nombre": "EstadoPedido",
      "valores": ["BORRADOR", "CONFIRMADO", "ENVIADO", "ENTREGADO", "CANCELADO"]
    }
  ]
}
''';
