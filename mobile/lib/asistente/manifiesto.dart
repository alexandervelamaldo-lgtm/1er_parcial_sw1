/// El manifiesto tal y como lo entiende la app.
///
/// Es la otra mitad del contrato que emite el generador en
/// `generator/src/asistente/manifiesto.ts` y que define
/// `shared/src/asistente/manifiesto.ts`. Que existan dos implementaciones —una
/// en TypeScript, otra en Dart— no es duplicación evitable: son dos runtimes
/// distintos, y el precio de tener una app sola para todos los proyectos
/// generados es escribir el lector una vez en cada lado.
///
/// Lo que **no** se hace aquí es confiar. La URL del backend la teclea el
/// usuario en la pantalla de conexión, así que el documento que llega es
/// entrada externa como cualquier otra: sus rutas acaban concatenadas en una
/// URL y sus nombres acaban en la interfaz. Se validan con lista blanca —la
/// misma que aplica el emisor— y se rechaza el documento entero si algo no
/// encaja. Nunca se «limpia» quitando caracteres: una ruta saneada a medias
/// sigue siendo una ruta que nadie escribió.
library;

/// Versión del contrato que esta app sabe leer.
///
/// Se compara con igualdad y no con «mayor o igual» a propósito. Un manifiesto
/// de la versión 2 puede haber cambiado el significado de un campo existente,
/// no solo añadido campos nuevos; seguir adelante sería adivinar. El mensaje de
/// error dice qué versión habla cada lado, que es lo único accionable.
const int versionManifiesto = 1;

/// Cabecera de idempotencia por defecto, si el manifiesto no anuncia otra.
const String cabeceraIdempotenciaPorDefecto = 'Idempotency-Key';

/// El documento no es válido y no se puede seguir.
class ManifiestoInvalido implements Exception {
  const ManifiestoInvalido(this.mensaje);

  final String mensaje;

  @override
  String toString() => 'Manifiesto inválido: $mensaje';
}

/// Tipos de campo del contrato. El orden es el de `TipoCampoSchema`.
enum TipoCampo {
  texto,
  entero,
  decimal,
  booleano,
  fecha,
  fechaHora,
  hora,
  uuid,
  enumerado,
  referencia;

  static TipoCampo desde(String valor, String donde) {
    for (final tipo in TipoCampo.values) {
      if (tipo.name == valor) return tipo;
    }
    // Se rechaza en vez de caer a `texto`. Como la versión está clavada en 1, un
    // tipo desconocido solo puede venir de un backend incoherente, y mandarle un
    // texto donde espera un número convierte un fallo ruidoso en uno callado.
    throw ManifiestoInvalido('$donde: tipo «$valor» desconocido');
  }
}

/// Acciones que una entidad admite.
enum Accion {
  listar,
  ver,
  crear,
  actualizar,
  borrar;

  static Accion desde(String valor, String donde) {
    for (final accion in Accion.values) {
      if (accion.name == valor) return accion;
    }
    throw ManifiestoInvalido('$donde: acción «$valor» desconocida');
  }
}

/// Un campo de una entidad, tal y como se dicta y se rellena.
class CampoManifiesto {
  const CampoManifiesto({
    required this.nombre,
    required this.etiqueta,
    required this.tipo,
    required this.obligatorio,
    required this.soloLectura,
    this.maxLongitud,
    this.valores = const <String>[],
    this.entidad,
  });

  /// Nombre exacto en el DTO de entrada. Es la clave del JSON que se envía.
  final String nombre;

  /// Cómo se lee y se dice: `precioUnitario` llega aquí como «precio unitario».
  final String etiqueta;

  final TipoCampo tipo;
  final bool obligatorio;
  final bool soloLectura;

  /// Tope de `@Size(max = n)`, cuando la entidad lo declara.
  final int? maxLongitud;

  /// Lista cerrada de valores, solo para [TipoCampo.enumerado].
  ///
  /// Esto es lo que ninguna API REST cuenta de sí misma y que el diagrama sí
  /// sabe: sin ella el asistente no puede corregir «pedido enviado» a
  /// `ENVIADO`, solo puede mandarlo y esperar un 400.
  final List<String> valores;

  /// Entidad apuntada, solo para [TipoCampo.referencia].
  final String? entidad;

  factory CampoManifiesto.desdeJson(Map<String, dynamic> json, String donde) {
    final nombre = _cadena(json, 'nombre', donde);
    _exigirIdentificador(nombre, '$donde: nombre de campo');
    final tipo = TipoCampo.desde(_cadena(json, 'tipo', donde), '$donde/$nombre');

    final valores = _listaDeCadenas(json['valores'], '$donde/$nombre.valores');
    if (tipo == TipoCampo.enumerado && valores.isEmpty) {
      throw ManifiestoInvalido(
        '$donde/$nombre: un enumerado sin valores no se puede rellenar',
      );
    }

    final entidad = json['entidad'];
    if (tipo == TipoCampo.referencia && entidad is! String) {
      throw ManifiestoInvalido(
        '$donde/$nombre: una referencia debe decir a qué entidad apunta',
      );
    }
    if (entidad is String) {
      _exigirIdentificador(entidad, '$donde/$nombre: entidad apuntada');
    }

    final maximo = json['maxLongitud'];
    if (maximo != null && (maximo is! int || maximo <= 0)) {
      throw ManifiestoInvalido('$donde/$nombre: maxLongitud debe ser positiva');
    }

    return CampoManifiesto(
      nombre: nombre,
      etiqueta: _cadena(json, 'etiqueta', '$donde/$nombre'),
      tipo: tipo,
      obligatorio: _booleano(json, 'obligatorio', '$donde/$nombre'),
      soloLectura: _booleano(json, 'soloLectura', '$donde/$nombre'),
      maxLongitud: maximo as int?,
      valores: valores,
      entidad: entidad as String?,
    );
  }
}

/// El identificador de una entidad: cómo se llama y de qué tipo es.
class IdentificadorManifiesto {
  const IdentificadorManifiesto({required this.nombre, required this.tipo});

  final String nombre;
  final TipoCampo tipo;

  factory IdentificadorManifiesto.desdeJson(
    Map<String, dynamic> json,
    String donde,
  ) {
    final nombre = _cadena(json, 'nombre', donde);
    _exigirIdentificador(nombre, '$donde: identificador');
    return IdentificadorManifiesto(
      nombre: nombre,
      tipo: TipoCampo.desde(_cadena(json, 'tipo', donde), '$donde/$nombre'),
    );
  }
}

/// Una entidad: una pantalla de lista, un formulario y un puñado de órdenes.
class EntidadManifiesto {
  const EntidadManifiesto({
    required this.nombre,
    required this.ruta,
    required this.etiquetaHablada,
    required this.identificador,
    required this.campos,
    required this.acciones,
    required this.criticas,
    required this.borradoEnCascada,
    this.campoEtiqueta,
  });

  /// Nombre de la clase del diagrama. Es el que se enseña como título.
  final String nombre;

  /// Ruta REST relativa a `baseUrl`, en kebab-case y con barra inicial.
  final String ruta;

  /// Cómo se nombra al hablar: singular primero, plural después.
  ///
  /// El plural sale de [ruta] y no de una segunda pluralización, justamente
  /// para que no puedan divergir. Si se pluralizara aquí otra vez, la app
  /// acabaría pidiendo `/citas` mientras dice «citaes» y no habría manera de
  /// saber cuál de las dos está mal.
  final List<String> etiquetaHablada;

  final IdentificadorManifiesto identificador;

  /// Campo que representa al registro en una lista. Puede no haberlo.
  final String? campoEtiqueta;

  final List<CampoManifiesto> campos;
  final List<Accion> acciones;

  /// Acciones que hay que confirmar antes de ejecutar.
  final List<Accion> criticas;

  /// Qué otras entidades desaparecen al borrar una de esta.
  ///
  /// Sale del rombo relleno de una composición y **no se puede deducir desde
  /// REST**: es la diferencia entre avisar «esto también borrará sus líneas» y
  /// soltar un «¿seguro?» que no informa de nada.
  final List<String> borradoEnCascada;

  bool admite(Accion accion) => acciones.contains(accion);
  bool esCritica(Accion accion) => criticas.contains(accion);

  /// Singular para hablar y para titular una ficha.
  String get singular => etiquetaHablada.first;

  /// Plural; si el manifiesto solo trajo una forma, se reutiliza.
  String get plural => etiquetaHablada.length > 1
      ? etiquetaHablada[1]
      : etiquetaHablada.first;

  factory EntidadManifiesto.desdeJson(Map<String, dynamic> json) {
    final nombre = _cadena(json, 'nombre', 'entidad');
    _exigirIdentificador(nombre, 'entidad: nombre');

    final ruta = _cadena(json, 'ruta', nombre);
    _exigirRutaSegura(ruta, nombre);

    final habladas = _listaDeCadenas(json['etiquetaHablada'], '$nombre.etiquetaHablada');
    if (habladas.isEmpty) {
      throw ManifiestoInvalido('$nombre: sin etiqueta hablada no se puede dictar');
    }

    final campos = _lista(json['campos'], '$nombre.campos')
        .map((c) => CampoManifiesto.desdeJson(c, nombre))
        .toList(growable: false);

    final etiqueta = json['campoEtiqueta'];
    if (etiqueta != null) {
      if (etiqueta is! String) {
        throw ManifiestoInvalido('$nombre: campoEtiqueta debe ser texto');
      }
      if (!campos.any((c) => c.nombre == etiqueta)) {
        throw ManifiestoInvalido(
          '$nombre: campoEtiqueta «$etiqueta» no está entre los campos',
        );
      }
    }

    final acciones = _listaDeCadenas(json['acciones'], '$nombre.acciones')
        .map((a) => Accion.desde(a, nombre))
        .toList(growable: false);
    final criticas = _listaDeCadenas(json['criticas'], '$nombre.criticas')
        .map((a) => Accion.desde(a, nombre))
        .toList(growable: false);

    for (final critica in criticas) {
      if (!acciones.contains(critica)) {
        throw ManifiestoInvalido(
          '$nombre: «${critica.name}» está marcada como crítica pero no se ofrece',
        );
      }
    }

    final cascada = _listaDeCadenas(json['borradoEnCascada'], '$nombre.borradoEnCascada');
    for (final apuntada in cascada) {
      _exigirIdentificador(apuntada, '$nombre.borradoEnCascada');
    }

    return EntidadManifiesto(
      nombre: nombre,
      ruta: ruta,
      etiquetaHablada: habladas,
      identificador: IdentificadorManifiesto.desdeJson(
        _objeto(json['identificador'], '$nombre.identificador'),
        nombre,
      ),
      campoEtiqueta: etiqueta as String?,
      campos: campos,
      acciones: acciones,
      criticas: criticas,
      borradoEnCascada: cascada,
    );
  }

  /// Campos que el formulario debe pedir: todos menos los de solo lectura.
  List<CampoManifiesto> get camposEditables =>
      campos.where((c) => !c.soloLectura).toList(growable: false);

  CampoManifiesto? campoPorNombre(String nombre) {
    for (final campo in campos) {
      if (campo.nombre == nombre) return campo;
    }
    return null;
  }
}

/// Un enumerado del diagrama, con su lista cerrada de valores.
class EnumeradoManifiesto {
  const EnumeradoManifiesto({required this.nombre, required this.valores});

  final String nombre;
  final List<String> valores;

  factory EnumeradoManifiesto.desdeJson(Map<String, dynamic> json) {
    final nombre = _cadena(json, 'nombre', 'enumerado');
    _exigirIdentificador(nombre, 'enumerado: nombre');
    final valores = _listaDeCadenas(json['valores'], '$nombre.valores');
    if (valores.isEmpty) {
      throw ManifiestoInvalido('$nombre: un enumerado sin valores no sirve');
    }
    return EnumeradoManifiesto(nombre: nombre, valores: valores);
  }
}

/// El documento completo.
class Manifiesto {
  const Manifiesto({
    required this.version,
    required this.proyecto,
    required this.baseUrl,
    required this.idioma,
    required this.entidades,
    required this.enumerados,
    required this.cabeceraIdempotencia,
  });

  final int version;
  final String proyecto;
  final String baseUrl;
  final String idioma;
  final List<EntidadManifiesto> entidades;
  final List<EnumeradoManifiesto> enumerados;

  /// Cabecera con la que reenviar sin duplicar. Puede faltar: entonces el
  /// backend no la implementa y la bandeja de salida no debe mandarla.
  final String? cabeceraIdempotencia;

  factory Manifiesto.desdeJson(Map<String, dynamic> json) {
    final version = json['version'];
    if (version is! int) {
      throw const ManifiestoInvalido('falta el número de versión');
    }
    if (version != versionManifiesto) {
      throw ManifiestoInvalido(
        'esta app entiende la versión $versionManifiesto y el backend habla la '
        '$version. Actualiza la que se haya quedado atrás.',
      );
    }

    final baseUrl = _cadena(json, 'baseUrl', 'manifiesto');
    if (!RegExp(r'^/[a-z0-9/-]*$').hasMatch(baseUrl)) {
      throw ManifiestoInvalido('baseUrl no segura: «$baseUrl»');
    }

    final entidades = _lista(json['entidades'], 'entidades')
        .map(EntidadManifiesto.desdeJson)
        .toList(growable: false);

    final nombres = entidades.map((e) => e.nombre).toSet();
    if (nombres.length != entidades.length) {
      throw const ManifiestoInvalido('hay dos entidades con el mismo nombre');
    }
    // Una referencia a una entidad que no viene en el documento dejaría el
    // selector del formulario sin nada que ofrecer, y el fallo aparecería al
    // tocar el campo y no al conectar. Mejor ahora.
    for (final entidad in entidades) {
      for (final campo in entidad.campos) {
        if (campo.entidad != null && !nombres.contains(campo.entidad)) {
          throw ManifiestoInvalido(
            '${entidad.nombre}/${campo.nombre}: apunta a «${campo.entidad}», '
            'que no está en el manifiesto',
          );
        }
      }
    }

    final cabecera = json['cabeceraIdempotencia'];
    if (cabecera != null && cabecera is! String) {
      throw const ManifiestoInvalido('cabeceraIdempotencia debe ser texto');
    }

    return Manifiesto(
      version: version,
      proyecto: _cadena(json, 'proyecto', 'manifiesto'),
      baseUrl: baseUrl,
      idioma: _cadena(json, 'idioma', 'manifiesto'),
      entidades: entidades,
      enumerados: _lista(json['enumerados'], 'enumerados')
          .map(EnumeradoManifiesto.desdeJson)
          .toList(growable: false),
      cabeceraIdempotencia: cabecera as String?,
    );
  }

  EntidadManifiesto? entidadPorNombre(String nombre) {
    for (final entidad in entidades) {
      if (entidad.nombre == nombre) return entidad;
    }
    return null;
  }

  /// Busca la entidad por cualquiera de sus formas habladas.
  ///
  /// Compara sin acentos y sin mayúsculas porque quien dicta no las pronuncia:
  /// «categoría» y «categoria» tienen que llegar al mismo sitio.
  EntidadManifiesto? buscarHablada(String termino) {
    final buscado = plegar(termino);
    if (buscado.isEmpty) return null;
    for (final entidad in entidades) {
      for (final etiqueta in entidad.etiquetaHablada) {
        if (plegar(etiqueta) == buscado) return entidad;
      }
      if (plegar(entidad.nombre) == buscado) return entidad;
    }
    return null;
  }
}

/// Normaliza para comparar lo dictado: minúsculas, sin acentos, sin dobles
/// espacios. Se escribe el rango de diacríticos con `\u` y no con los
/// caracteres literales para que ninguna recodificación del fichero lo rompa.
String plegar(String texto) {
  final sinAcentos = texto.toLowerCase().split('').map((c) {
    const origen = 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
    const destino = 'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc';
    final indice = origen.indexOf(c);
    return indice >= 0 ? destino[indice] : c;
  }).join();
  return sinAcentos.replaceAll(RegExp(r'\s+'), ' ').trim();
}

// ---------------------------------------------------------------------------
// Lectura defensiva. Todo lo de aquí abajo existe para que un documento raro
// produzca un mensaje que diga dónde está el problema, y no un
// `type 'Null' is not a subtype of type 'String'` a mitad de pantalla.

/// Mismo patrón que `RUTA_SEGURA` en el emisor. La ruta se concatena a una URL,
/// así que un `..` o una barra de más aquí es una petición a otro sitio.
final RegExp _rutaSegura = RegExp(r'^/[a-z0-9]+(-[a-z0-9]+)*$');

/// Los nombres acaban en claves de JSON y en texto de pantalla. Lista blanca.
final RegExp _identificador = RegExp(r'^[A-Za-z_][A-Za-z0-9_]*$');

void _exigirRutaSegura(String ruta, String donde) {
  if (!_rutaSegura.hasMatch(ruta)) {
    throw ManifiestoInvalido('$donde: ruta no segura «$ruta»');
  }
}

void _exigirIdentificador(String nombre, String donde) {
  if (nombre.length > 64 || !_identificador.hasMatch(nombre)) {
    throw ManifiestoInvalido('$donde: nombre no válido «$nombre»');
  }
}

String _cadena(Map<String, dynamic> json, String clave, String donde) {
  final valor = json[clave];
  if (valor is! String || valor.isEmpty) {
    throw ManifiestoInvalido('$donde: falta «$clave»');
  }
  return valor;
}

bool _booleano(Map<String, dynamic> json, String clave, String donde) {
  final valor = json[clave];
  if (valor is! bool) {
    throw ManifiestoInvalido('$donde: «$clave» debe ser verdadero o falso');
  }
  return valor;
}

Map<String, dynamic> _objeto(Object? valor, String donde) {
  if (valor is! Map<String, dynamic>) {
    throw ManifiestoInvalido('$donde: se esperaba un objeto');
  }
  return valor;
}

List<Map<String, dynamic>> _lista(Object? valor, String donde) {
  if (valor is! List) {
    throw ManifiestoInvalido('$donde: se esperaba una lista');
  }
  return valor
      .map((e) => _objeto(e, donde))
      .toList(growable: false);
}

List<String> _listaDeCadenas(Object? valor, String donde) {
  if (valor == null) return const <String>[];
  if (valor is! List) {
    throw ManifiestoInvalido('$donde: se esperaba una lista');
  }
  return valor.map((e) {
    if (e is! String || e.isEmpty) {
      throw ManifiestoInvalido('$donde: todos los elementos deben ser texto');
    }
    return e;
  }).toList(growable: false);
}
