/// El intérprete de órdenes de la app: de una frase dictada a una operación.
///
/// Es el hermano móvil de `shared/src/ai/grammar.ts`, pero no hace lo mismo ni
/// puede escribirse igual. Aquella gramática edita **el diagrama** y tiene el
/// vocabulario dentro de las expresiones regulares: «clase», «atributo»,
/// «relación» son palabras del dominio y no cambian nunca.
///
/// Aquí el dominio es el del proyecto generado, y cambia con cada diagrama. Por
/// eso la regla que gobierna este fichero es que **no puede aparecer ni una
/// palabra del negocio escrita a mano**: ni «cliente», ni «pedido», ni «cita».
/// Todo el vocabulario sale del manifiesto —`etiquetaHablada` para las
/// entidades, `etiqueta` para los campos, `valores` para los enumerados—. Lo
/// único fijo son los verbos y los conectores, que son español y no dominio.
/// Si alguna vez se cuela un nombre de entidad en este fichero, la app deja de
/// servir para el siguiente diagrama y nadie se entera hasta la demostración.
///
/// Lo dictado es entrada externa como cualquier otra. Nada de lo que sale de
/// aquí se concatena a una URL ni se convierte en un identificador: los nombres
/// de campo y de entidad se **eligen** entre los que el manifiesto ya trajo
/// —y esos ya pasaron la lista blanca al leerlo—, y lo que el usuario dicta
/// solo llega a ser un *valor*, que viaja en el cuerpo del JSON.
library;

import 'cliente_rest.dart' show nuevaClaveIdempotencia;
import 'fechas_habladas.dart';
import 'manifiesto.dart';
import 'valores.dart';

/// Una operación entendida, lista para ejecutarse o para abrir un formulario.
class Orden {
  Orden({
    required this.accion,
    required this.entidad,
    required this.explicacion,
    required this.confianza,
    this.identificador,
    this.busqueda,
    this.advertencia,
    Map<String, String>? valores,
    String? clave,
  })  : valores = Map<String, String>.unmodifiable(
          valores ?? const <String, String>{},
        ),
        claveIdempotencia = clave ?? nuevaClaveIdempotencia(_prefijos[accion]!);

  final Accion accion;
  final EntidadManifiesto entidad;

  /// Identificador dicho con número: «borra el cliente 4».
  final Object? identificador;

  /// Texto con el que buscar el registro cuando no se dijo el número: «borra
  /// el cliente Ana Pérez». Resolverlo exige una consulta, así que se deja
  /// dicho aquí y lo hace quien ejecute la orden.
  final String? busqueda;

  /// Lo dictado para cada campo, sin convertir, indexado por nombre de campo.
  ///
  /// Se guarda el texto y no el valor final para que la ficha pueda enseñarlo
  /// tal cual y para que la conversión la siga haciendo `valores.dart`, que es
  /// donde está probada.
  final Map<String, String> valores;

  /// Qué se va a hacer, dicho en las palabras del manifiesto.
  final String explicacion;

  /// Lo que conviene saber antes de decir que sí. Sale del rombo relleno de la
  /// composición: es lo que ningún API REST cuenta de sí misma.
  final String? advertencia;

  final double confianza;

  /// La clave de idempotencia se fija **al dictar**, no al enviar.
  ///
  /// Es la diferencia entre que un reintento no duplique y que sí lo haga: si
  /// se generara al salir la petición, cada reintento llevaría una clave
  /// distinta y el mecanismo entero no serviría para nada. La misma `Orden`
  /// reenviada tantas veces como haga falta lleva siempre esta.
  final String claveIdempotencia;

  /// Las órdenes que el manifiesto marca como críticas se confirman antes.
  bool get necesitaConfirmacion => entidad.esCritica(accion);

  /// Campos obligatorios que nadie ha dictado todavía.
  List<CampoManifiesto> get camposQueFaltan => entidad.camposEditables
      .where((c) => c.obligatorio && (valores[c.nombre] ?? '').trim().isEmpty)
      .toList(growable: false);

  /// Si se puede mandar sin preguntar nada más.
  bool get completa => camposQueFaltan.isEmpty;

  /// El cuerpo del `POST` o del `PUT`, con las conversiones de `valores.dart`.
  Map<String, dynamic> get cuerpo => cuerpoDesdeFormulario(entidad, valores);
}

/// El resultado de interpretar una frase.
///
/// Puede no haber orden y aun así haber algo que decir: cuando la acción no la
/// ofrece el backend, cuando falta decir de cuál, o cuando no se entendió nada.
/// Es la misma disciplina de la gramática web —una orden a medias es peor que
/// ninguna—, y por eso [orden] es nulo en todos esos casos y [aclaracion] lleva
/// exactamente lo que hay que preguntar.
class Interpretacion {
  const Interpretacion({
    required this.explicacion,
    required this.confianza,
    this.orden,
    this.aclaracion,
    this.esAyuda = false,
  });

  final Orden? orden;
  final String explicacion;
  final String? aclaracion;
  final double confianza;
  final bool esAyuda;

  bool get entendida => orden != null;
}

/// Traduce lo dictado usando solo lo que el manifiesto dice del proyecto.
class Interprete {
  Interprete(this.manifiesto, {DateTime Function()? reloj})
      : _reloj = reloj ?? DateTime.now;

  final Manifiesto manifiesto;
  final DateTime Function() _reloj;

  late final List<_Etiqueta> _etiquetas = _construirEtiquetas();

  Interpretacion interpretar(String texto) {
    final crudoInicial = texto.replaceAll(RegExp(r'\s+'), ' ').trim();
    if (crudoInicial.isEmpty) {
      return Interpretacion(
        explicacion: 'No he entendido nada.',
        aclaracion: _repertorio(),
        confianza: 0,
      );
    }

    var plano = plegar(crudoInicial);
    var crudo = crudoInicial;
    if (plano.length != crudo.length) {
      // Plegar es carácter a carácter y sobre un texto con los espacios ya
      // juntos no debería cambiar la longitud. Si alguna forma Unicode rara lo
      // hiciera, los índices dejarían de alinearse y los nombres saldrían
      // cortados por la mitad; antes que eso, se renuncia a los acentos.
      crudo = plano;
    }

    if (_pideAyuda(plano)) {
      return Interpretacion(
        explicacion: _repertorio(),
        confianza: 1,
        esAyuda: true,
      );
    }

    void borrar(int inicio, int fin) {
      plano = _blanquear(plano, inicio, fin);
      crudo = _blanquear(crudo, inicio, fin);
    }

    // 1. La entidad antes que el verbo.
    //
    // Se busca la primera que se nombra, y a igualdad de posición la etiqueta
    // más larga. Lo primero resuelve «crea un pedido para el cliente 3», donde
    // «cliente» es más largo pero es el destinatario y no el asunto; lo segundo
    // resuelve «crea una línea pedido», donde «pedido» también encaja pero
    // empieza más tarde. Elegir mal aquí es actuar sobre la tabla equivocada,
    // que en un borrado sería el peor fallo posible de este módulo.
    final hallada = _buscarEntidad(plano);
    if (hallada == null) {
      return Interpretacion(
        explicacion: 'No sé de qué me hablas.',
        aclaracion: _repertorio(),
        confianza: 0,
      );
    }
    final entidad = hallada.etiqueta.entidad;
    final finEntidad = hallada.fin;
    borrar(hallada.inicio, hallada.fin);

    // 2. El verbo, ya sin la entidad por medio: así, si algún diagrama llama a
    // una clase «Lista» o «Agenda», la palabra cuenta como entidad y no como
    // orden.
    final verbo = _buscarVerbo(plano);
    var confianza = 1.0;
    var accion = Accion.listar;
    if (verbo == null) {
      // Decir solo el nombre es pedir la lista. Se entiende, pero no tanto como
      // para no avisar de que se ha supuesto.
      confianza = 0.6;
    } else {
      accion = verbo.accion;
      if (verbo.inicio > 0) confianza = 0.9;
      borrar(verbo.inicio, verbo.fin);
    }

    // 3. De cuál. Solo para las acciones que actúan sobre un registro: en un
    // alta, un número suelto es el valor de un campo, no un identificador.
    Object? identificador;
    if (accion != Accion.crear) {
      final id = _buscarIdentificador(plano, finEntidad);
      if (id != null) {
        identificador = int.parse(plano.substring(id.inicio, id.fin).trim());
        borrar(id.inicio, id.fin);
      }
    }

    // 4. Los campos que se han nombrado.
    final valores = <String, String>{};
    for (final trozo in _trocearPorCampos(entidad, plano)) {
      final texto = _limpiar(crudo.substring(trozo.inicio, trozo.fin));
      if (texto.isEmpty) continue;
      final valor = _normalizar(trozo.campo, texto);
      if (valor == null) continue;
      valores[trozo.campo.nombre] = valor;
      borrar(trozo.etiquetaInicio, trozo.fin);
    }

    // 5. Lo que quedó suelto: una fecha u hora dicha sin nombrar el campo.
    //
    // «configúrame esta cita para mañana a las tres» no dice «fecha» en ningún
    // sitio. Se asigna solo si hay **un** campo temporal sin rellenar; con dos
    // no se adivina, porque colocar la hora en el campo equivocado es un error
    // que el usuario no llega a ver hasta que la cita se pierde.
    String? aclaracion;
    final momento = leerMomento(plano, _reloj());
    if (!momento.vacio) {
      final destino = _campoTemporalLibre(entidad, valores);
      if (destino != null) {
        final puesto = _colocarMomento(destino, momento);
        if (puesto != null) {
          valores[destino.nombre] = puesto;
          if (destino.tipo == TipoCampo.fechaHora && momento.hora == null) {
            aclaracion = '¿A qué hora?';
          }
          final consumido = momento.resto;
          for (var i = 0; i < plano.length; i++) {
            if (consumido[i] == ' ' && plano[i] != ' ') borrar(i, i + 1);
          }
        }
      }
    }

    // 6. Lo que sobra, si sobra algo con sentido.
    final sobra = _sinPalabrasVacias(plano, crudo);
    if (sobra.isNotEmpty) {
      final etiqueta = entidad.campoEtiqueta;
      if (accion == Accion.crear &&
          etiqueta != null &&
          (valores[etiqueta] ?? '').isEmpty) {
        // «nuevo cliente Ana Pérez»: sin nombrar el campo, pero el manifiesto
        // dice cuál representa al registro y no hay otra cosa que pueda ser.
        valores[etiqueta] = sobra;
      } else if (accion != Accion.crear && identificador == null) {
        // «borra el cliente Ana Pérez»: no es un número, así que hay que
        // buscarlo. Quien ejecute la orden decidirá qué hacer si hay dos.
        return _construir(
          entidad: entidad,
          accion: accion,
          identificador: null,
          busqueda: sobra,
          valores: valores,
          confianza: confianza,
          aclaracion: aclaracion,
        );
      } else {
        // Ni campo ni nombre: se ha oído algo que no se ha sabido colocar. Se
        // sigue, pero diciéndolo, que es lo que hace la gramática de la web
        // cuando un segmento se queda sin regla.
        confianza = confianza < 0.5 ? confianza : 0.5;
        aclaracion ??= 'No he sabido dónde poner «$sobra».';
      }
    }

    return _construir(
      entidad: entidad,
      accion: accion,
      identificador: identificador,
      busqueda: null,
      valores: valores,
      confianza: confianza,
      aclaracion: aclaracion,
    );
  }

  // -------------------------------------------------------------------------

  Interpretacion _construir({
    required EntidadManifiesto entidad,
    required Accion accion,
    required Object? identificador,
    required String? busqueda,
    required Map<String, String> valores,
    required double confianza,
    required String? aclaracion,
  }) {
    final sinDestino = identificador == null && busqueda == null;

    // «ver clientes» no abre nada: no hay un cual. Es la lista, y decirlo así
    // ahorra un «¿cuál?» que el usuario no esperaba.
    if (accion == Accion.ver && sinDestino) accion = Accion.listar;
    // «muéstrame el cliente 4» sí lo abre.
    if (accion == Accion.listar && !sinDestino) accion = Accion.ver;

    if ((accion == Accion.actualizar || accion == Accion.borrar) &&
        sinDestino) {
      return Interpretacion(
        explicacion: 'Sé qué quieres hacer, pero no sobre cuál.',
        aclaracion: '¿Qué ${entidad.singular}? Dime el número'
            '${entidad.campoEtiqueta != null ? ' o el nombre' : ''}.',
        confianza: confianza,
      );
    }

    if (!entidad.admite(accion)) {
      return Interpretacion(
        explicacion: 'Eso no se puede hacer aquí.',
        aclaracion: 'Este backend no ofrece ${_nombreAccion(accion)} '
            '${entidad.plural}. Puedo: '
            '${entidad.acciones.map(_nombreAccion).join(', ')}.',
        confianza: confianza,
      );
    }

    final orden = Orden(
      accion: accion,
      entidad: entidad,
      identificador: identificador,
      busqueda: busqueda,
      valores: valores,
      confianza: confianza,
      advertencia: accion == Accion.borrar ? _cascada(entidad) : null,
      explicacion: _explicar(accion, entidad, identificador, busqueda, valores),
    );

    return Interpretacion(
      orden: orden,
      explicacion: orden.explicacion,
      aclaracion: aclaracion ?? _queFalta(orden),
      confianza: confianza,
    );
  }

  String? _queFalta(Orden orden) {
    if (orden.accion != Accion.crear) return null;
    final faltan = orden.camposQueFaltan;
    if (faltan.isEmpty) return null;
    return 'Falta ${faltan.map((c) => c.etiqueta).join(', ')}.';
  }

  String? _cascada(EntidadManifiesto entidad) {
    if (entidad.borradoEnCascada.isEmpty) return null;
    final arrastra = entidad.borradoEnCascada
        .map((n) => manifiesto.entidadPorNombre(n)?.plural ?? n)
        .join(' y ');
    return 'También desaparecerán sus $arrastra.';
  }

  String _explicar(
    Accion accion,
    EntidadManifiesto entidad,
    Object? identificador,
    String? busqueda,
    Map<String, String> valores,
  ) {
    final cual = identificador != null
        ? '${entidad.singular} número $identificador'
        : busqueda != null
            ? '${entidad.singular} «$busqueda»'
            : entidad.singular;

    switch (accion) {
      case Accion.listar:
        return 'Abro la lista de ${entidad.plural}.';
      case Accion.ver:
        return 'Abro $cual.';
      case Accion.crear:
        final resumen = _resumir(entidad, valores);
        return resumen.isEmpty
            ? 'Doy de alta ${entidad.singular}.'
            : 'Doy de alta ${entidad.singular}: $resumen.';
      case Accion.actualizar:
        final resumen = _resumir(entidad, valores);
        return resumen.isEmpty
            ? 'Edito $cual.'
            : 'Cambio en $cual: $resumen.';
      case Accion.borrar:
        return 'Borro $cual.';
    }
  }

  String _resumir(EntidadManifiesto entidad, Map<String, String> valores) =>
      valores.entries
          .map((e) =>
              '${entidad.campoPorNombre(e.key)?.etiqueta ?? e.key} ${e.value}')
          .join(', ');

  /// Los nombres de las acciones en infinitivo, para explicárselas al usuario.
  /// Es lo único de este fichero que se dice en español fijo, y no es dominio.
  String _nombreAccion(Accion accion) => switch (accion) {
        Accion.listar => 'listar',
        Accion.ver => 'abrir',
        Accion.crear => 'crear',
        Accion.actualizar => 'cambiar',
        Accion.borrar => 'borrar',
      };

  /// Qué se puede pedir, dicho con las palabras de este proyecto.
  String _repertorio() {
    final nombres = manifiesto.entidades.map((e) => e.plural).join(', ');
    return 'Puedo listar, abrir, crear, cambiar y borrar: $nombres. '
        'Por ejemplo: «${_ejemplo()}».';
  }

  String _ejemplo() {
    final entidad = manifiesto.entidades.firstWhere(
      (e) => e.admite(Accion.listar),
      orElse: () => manifiesto.entidades.first,
    );
    return 'muéstrame los ${entidad.plural}';
  }

  // -------------------------------------------------------------------------
  // Búsquedas sobre el texto plegado.

  List<_Etiqueta> _construirEtiquetas() {
    final lista = <_Etiqueta>[];
    for (final entidad in manifiesto.entidades) {
      for (final hablada in entidad.etiquetaHablada) {
        lista.add(_Etiqueta(plegar(hablada), entidad));
      }
      // El nombre de la clase también vale: nadie dice «lineapedido», pero
      // quien teclea la orden en vez de dictarla a veces escribe el nombre tal
      // y como sale en el diagrama.
      lista.add(_Etiqueta(plegar(entidad.nombre), entidad));
    }
    lista.sort((a, b) => b.plano.length.compareTo(a.plano.length));
    return lista;
  }

  _Coincidencia? _buscarEntidad(String plano) {
    _Coincidencia? mejor;
    for (final etiqueta in _etiquetas) {
      final indice = _indiceDePalabra(plano, etiqueta.plano);
      if (indice < 0) continue;
      final fin = indice + etiqueta.plano.length;
      if (mejor == null ||
          indice < mejor.inicio ||
          (indice == mejor.inicio && fin > mejor.fin)) {
        mejor = _Coincidencia(etiqueta, indice, fin);
      }
    }
    return mejor;
  }

  _Verbo? _buscarVerbo(String plano) {
    _Verbo? mejor;
    for (final entrada in _verbos.entries) {
      for (final frase in entrada.value) {
        final indice = _indiceDePalabra(plano, frase);
        if (indice < 0) continue;
        final fin = indice + frase.length;
        if (mejor == null ||
            indice < mejor.inicio ||
            (indice == mejor.inicio && fin > mejor.fin)) {
          mejor = _Verbo(entrada.key, indice, fin);
        }
      }
    }
    return mejor;
  }

  /// El número que va justo detrás de la entidad, con o sin muletilla.
  ///
  /// Se exige que esté pegado y no en cualquier parte de la frase: en «cambia
  /// el precio del producto 4 a 20» hay dos números y solo uno es el registro.
  _Tramo? _buscarIdentificador(String plano, int finEntidad) {
    if (finEntidad > plano.length) return null;
    final cola = plano.substring(finEntidad);
    // La muletilla va en su propio grupo porque Dart no da los índices de los
    // grupos de una coincidencia —solo los del conjunto—, así que la posición
    // del número se calcula con la longitud de lo que lleva delante.
    final m = RegExp(
      r'^(\s*(?:numero\s+|num\s+|id\s+|codigo\s+|#\s*)?)(\d+)\b',
    ).firstMatch(cola);
    if (m == null) return null;
    final inicio = finEntidad + m.group(1)!.length;
    return _Tramo(inicio, inicio + m.group(2)!.length);
  }

  /// Parte el texto en trozos «etiqueta de campo → valor hasta la siguiente».
  List<_TrozoCampo> _trocearPorCampos(EntidadManifiesto entidad, String plano) {
    final encontrados = <_TrozoCampo>[];
    for (final campo in entidad.camposEditables) {
      // Se prueban la etiqueta hablada y el nombre técnico. Ninguno de los dos
      // está escrito aquí: los dos vienen del manifiesto.
      for (final aguja in <String>{plegar(campo.etiqueta), plegar(campo.nombre)}) {
        final indice = _indiceDePalabra(plano, aguja);
        if (indice < 0) continue;
        encontrados.add(_TrozoCampo(campo, indice, indice + aguja.length, 0));
        break;
      }
    }
    if (encontrados.isEmpty) return const <_TrozoCampo>[];

    encontrados.sort((a, b) => a.etiquetaInicio.compareTo(b.etiquetaInicio));
    final trozos = <_TrozoCampo>[];
    for (var i = 0; i < encontrados.length; i++) {
      final actual = encontrados[i];
      final fin = i + 1 < encontrados.length
          ? encontrados[i + 1].etiquetaInicio
          : plano.length;
      trozos.add(_TrozoCampo(
        actual.campo,
        actual.etiquetaInicio,
        actual.inicio,
        fin,
      ));
    }
    return trozos;
  }

  CampoManifiesto? _campoTemporalLibre(
    EntidadManifiesto entidad,
    Map<String, String> valores,
  ) {
    final libres = entidad.camposEditables
        .where((c) =>
            const <TipoCampo>{
              TipoCampo.fecha,
              TipoCampo.fechaHora,
              TipoCampo.hora,
            }.contains(c.tipo) &&
            (valores[c.nombre] ?? '').isEmpty)
        .toList(growable: false);
    return libres.length == 1 ? libres.single : null;
  }

  String? _colocarMomento(CampoManifiesto campo, MomentoHablado momento) {
    switch (campo.tipo) {
      case TipoCampo.fecha:
        return momento.fecha;
      case TipoCampo.hora:
        return momento.hora;
      case TipoCampo.fechaHora:
        if (momento.fecha == null) return null;
        // Sin hora se deja solo la fecha y se pregunta. Rellenar una hora que
        // nadie dijo daría una cita a las doce de la noche con toda la
        // apariencia de estar bien puesta.
        return momento.hora == null
            ? momento.fecha
            : '${momento.fecha} ${momento.hora}';
      default:
        return null;
    }
  }

  /// Convierte lo dictado al texto que el formulario espera para ese campo.
  String? _normalizar(CampoManifiesto campo, String texto) {
    switch (campo.tipo) {
      case TipoCampo.booleano:
        final plano = plegar(texto);
        if (_afirmaciones.contains(plano)) return 'true';
        if (_negaciones.contains(plano)) return 'false';
        return null;

      case TipoCampo.enumerado:
        // La lista es cerrada y viene del diagrama. Es lo que permite corregir
        // «pedido enviado» a `ENVIADO` en vez de mandarlo y esperar un 400.
        final plano = plegar(texto);
        for (final valor in campo.valores) {
          if (plegar(valor) == plano) return valor;
        }
        for (final valor in campo.valores) {
          if (plegar(valor).startsWith(plano) && plano.length >= 3) return valor;
        }
        return texto;

      case TipoCampo.entero:
      case TipoCampo.referencia:
        final m = RegExp(r'-?\d+').firstMatch(texto);
        return m?.group(0);

      case TipoCampo.decimal:
        // «diecinueve con noventa y nueve» no se intenta; «19 con 99» sí, que
        // es como sale del reconocedor de voz cuando se dicta un precio.
        final unido = texto.replaceAllMapped(
          RegExp(r'(\d+)\s*(?:con|coma|punto)\s*(\d+)'),
          (m) => '${m.group(1)},${m.group(2)}',
        );
        final m = RegExp(r'-?\d+(?:[.,]\d+)?').firstMatch(unido);
        return m?.group(0);

      case TipoCampo.fecha:
      case TipoCampo.hora:
      case TipoCampo.fechaHora:
        final momento = leerMomento(plegar(texto), _reloj());
        return _colocarMomento(campo, momento);

      default:
        return texto;
    }
  }

  /// Lo que queda del texto una vez fuera las palabras que no dicen nada.
  String _sinPalabrasVacias(String plano, String crudo) {
    final piezas = <String>[];
    var i = 0;
    while (i < plano.length) {
      if (plano[i] == ' ') {
        i++;
        continue;
      }
      var j = i;
      while (j < plano.length && plano[j] != ' ') {
        j++;
      }
      final palabra = plano.substring(i, j);
      if (!_vacias.contains(palabra) && !_soloPuntuacion.hasMatch(palabra)) {
        piezas.add(crudo.substring(i, j));
      }
      i = j;
    }
    return piezas.join(' ').trim();
  }

  bool _pideAyuda(String plano) {
    if (plano == 'ayuda' || plano == 'ayudame' || plano == 'socorro') {
      return true;
    }
    for (final frase in _frasesDeAyuda) {
      if (plano.contains(frase)) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Vocabulario fijo. Español, no dominio: ninguna de estas palabras depende del
// diagrama y ninguna de ellas es un nombre de entidad ni de campo.

const Map<Accion, List<String>> _verbos = <Accion, List<String>>{
  Accion.listar: <String>[
    'listar', 'lista', 'listame', 'mostrar', 'muestrame', 'muestra',
    'ensename', 'ver todos', 'ver todas', 'ver los', 'ver las',
    'dame la lista de', 'dame los', 'dame las', 'cuantos', 'cuantas',
    'todos los', 'todas las',
  ],
  Accion.ver: <String>[
    'ver', 'abrir', 'abre', 'abreme', 'consultar', 'consulta',
    'detalle de', 'ficha de', 'buscar', 'busca', 'buscame', 'encuentra',
  ],
  Accion.crear: <String>[
    'crear', 'crea', 'creame', 'nuevo', 'nueva', 'anadir', 'anade',
    'agregar', 'agrega', 'agregame', 'registrar', 'registra',
    'dar de alta', 'alta de', 'apunta', 'apuntame', 'configurame',
    'configura', 'reservar', 'reserva', 'reservame', 'programa',
    'programame', 'agendar', 'agenda', 'agendame',
  ],
  Accion.actualizar: <String>[
    'actualizar', 'actualiza', 'editar', 'edita', 'modificar', 'modifica',
    'cambiar', 'cambia', 'cambiale', 'corregir', 'corrige', 'ponle', 'pon',
  ],
  Accion.borrar: <String>[
    'borrar', 'borra', 'borrame', 'eliminar', 'elimina', 'quitar', 'quita',
    'suprimir', 'suprime', 'dar de baja', 'anular', 'anula',
  ],
};

const Map<Accion, String> _prefijos = <Accion, String>{
  Accion.listar: 'listar',
  Accion.ver: 'consulta',
  Accion.crear: 'alta',
  Accion.actualizar: 'edicion',
  Accion.borrar: 'borrar',
};

const List<String> _frasesDeAyuda = <String>[
  'que puedes hacer',
  'que puedo hacer',
  'que puedo decir',
  'que sabes hacer',
  'como funciona esto',
];

const Set<String> _afirmaciones = <String>{
  'si', 'sí', 'true', 'verdadero', 'verdadera', 'activo', 'activa', '1',
  'claro', 'correcto',
};

const Set<String> _negaciones = <String>{
  'no', 'false', 'falso', 'falsa', 'inactivo', 'inactiva', '0', 'ninguno',
};

/// Las palabras con las que se contesta a una propuesta, dichas en voz alta.
///
/// Son un repertorio aparte del de los campos booleanos —y no la misma
/// constante— porque no significan lo mismo. «Adelante» confirma una acción
/// pero no rellena un campo «activo»; juntarlas haría que dictar «producto
/// adelante» encendiera el interruptor sin que nadie lo hubiera pedido.
/// Sin acentos a propósito: lo dictado pasa por `plegar` antes de compararse,
/// así que un «sí» con tilde aquí dentro no llegaría a coincidir nunca.
const Set<String> _confirmacionesHabladas = <String>{
  'si', 'claro', 'correcto', 'vale', 'dale', 'adelante', 'hazlo',
  'confirmo', 'confirma', 'eso', 'exacto', 'perfecto', 'ok', 'okey',
};

const Set<String> _cancelacionesHabladas = <String>{
  'no', 'cancela', 'cancelar', 'para', 'espera', 'olvidalo',
  'deja', 'dejalo', 'mejor', 'nada', 'anula',
};

/// Si lo dicho es un «sí» a lo que se acaba de proponer, y nada más.
///
/// Va en la gramática y no en la pantalla porque es vocabulario del idioma,
/// igual que los verbos: la pantalla sabe de botones, no de español.
///
/// **Todas** las palabras tienen que ser de confirmación. Es lo que separa un
/// «sí, adelante» —que confirma— de un «sí, borra el cliente 4», que no es una
/// respuesta sino una orden nueva y tiene que volver a interpretarse entera. Un
/// «empieza por sí» habría ejecutado la propuesta anterior y descartado la
/// frase que de verdad se dijo.
bool confirmaHablando(String dicho) =>
    _todasEstanEn(dicho, _confirmacionesHabladas);

/// Si lo dicho descarta la propuesta. Mismas reglas que [confirmaHablando].
bool cancelaHablando(String dicho) =>
    _todasEstanEn(dicho, _cancelacionesHabladas);

bool _todasEstanEn(String dicho, Set<String> repertorio) {
  // La puntuación se cae: el reconocedor de Android devuelve «Sí.» con punto y
  // sin esto la respuesta más común del mundo no se reconocería.
  final palabras = plegar(dicho)
      .split(RegExp(r'[^a-z0-9]+'))
      .where((p) => p.isNotEmpty)
      .toList(growable: false);
  if (palabras.isEmpty) return false;
  return palabras.every(repertorio.contains);
}

/// Muletillas y conectores. Que sobren estas no baja la confianza; que sobre
/// cualquier otra cosa, sí.
const Set<String> _vacias = <String>{
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo', 'al', 'del',
  'de', 'a', 'y', 'e', 'o', 'u', 'con', 'para', 'por', 'que', 'en', 'es',
  'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'me', 'mi', 'mis', 'su',
  'sus', 'se', 'le', 'nueva', 'nuevo', 'favor', 'porfavor', 'oye', 'hola',
  'quiero', 'necesito', 'puedes', 'podrias', 'quisiera', 'gracias', 'llamado',
  'llamada', 'igual', 'como', 'hay', 'cual',
};

/// Lo que se quita del principio y del final del valor de un campo.
///
/// Los artículos **no** están aquí a propósito. «nombre La Paz» es un valor que
/// empieza por artículo, y quitárselo dejaría al cliente llamándose «Paz». Los
/// conectores de verdad —«de», «a», «con»— sí sobran siempre.
const Set<String> _conectores = <String>{
  'de', 'del', 'a', 'al', 'con', 'y', 'es', 'igual', 'como', 'para', 'por',
  'en', 'que', 'sea',
};

final RegExp _soloPuntuacion = RegExp(r'^[^a-z0-9@]+$');

// ---------------------------------------------------------------------------

class _Etiqueta {
  const _Etiqueta(this.plano, this.entidad);
  final String plano;
  final EntidadManifiesto entidad;
}

class _Coincidencia {
  const _Coincidencia(this.etiqueta, this.inicio, this.fin);
  final _Etiqueta etiqueta;
  final int inicio;
  final int fin;
}

class _Verbo {
  const _Verbo(this.accion, this.inicio, this.fin);
  final Accion accion;
  final int inicio;
  final int fin;
}

class _Tramo {
  const _Tramo(this.inicio, this.fin);
  final int inicio;
  final int fin;
}

class _TrozoCampo {
  const _TrozoCampo(this.campo, this.etiquetaInicio, this.inicio, this.fin);
  final CampoManifiesto campo;

  /// Dónde empieza la etiqueta del campo, para borrarla junto con el valor.
  final int etiquetaInicio;

  /// Dónde empieza el valor: justo detrás de la etiqueta.
  final int inicio;
  final int fin;
}

/// Índice de [aguja] en [texto] exigiendo que sea palabra entera.
///
/// Sin esto, la etiqueta «sku» encajaría dentro de un nombre propio y el campo
/// se llenaría con media palabra ajena. Las etiquetas pueden tener espacios
/// —«precio unitario»—, así que no vale `\b` de una expresión regular sobre una
/// alternación construida al vuelo: se comprueba a mano lo que hay a cada lado.
int _indiceDePalabra(String texto, String aguja) {
  if (aguja.isEmpty) return -1;
  var i = texto.indexOf(aguja);
  while (i >= 0) {
    final fin = i + aguja.length;
    final antes = i == 0 ? ' ' : texto[i - 1];
    final despues = fin >= texto.length ? ' ' : texto[fin];
    if (!_esAlfanumerico(antes) && !_esAlfanumerico(despues)) return i;
    i = texto.indexOf(aguja, i + 1);
  }
  return -1;
}

/// La arroba cuenta como parte de la palabra.
///
/// Sin esto, «nuevo@ejemplo.com» contiene la palabra entera «nuevo», que es uno
/// de los verbos de alta: una dirección de correo bastaría para que el asistente
/// creyera que se le está pidiendo crear algo. El punto no se incluye porque un
/// «borra el cliente 4.» con punto final es más frecuente que el problema que
/// resolvería.
bool _esAlfanumerico(String c) {
  final codigo = c.codeUnitAt(0);
  return (codigo >= 97 && codigo <= 122) ||
      (codigo >= 48 && codigo <= 57) ||
      codigo == 64;
}

/// Quita conectores y puntuación de los extremos del valor de un campo.
String _limpiar(String texto) {
  var piezas = texto.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  bool sobra(String pieza) {
    final plano = plegar(pieza.replaceAll(RegExp(r'^[^\wáéíóúñ]+|[^\wáéíóúñ]+$'), ''));
    return plano.isEmpty || _conectores.contains(plano);
  }

  while (piezas.isNotEmpty && sobra(piezas.first)) {
    piezas = piezas.sublist(1);
  }
  while (piezas.isNotEmpty && sobra(piezas.last)) {
    piezas = piezas.sublist(0, piezas.length - 1);
  }
  return piezas.join(' ').replaceAll(RegExp(r'[,;:.]+$'), '').trim();
}

String _blanquear(String texto, int inicio, int fin) =>
    texto.substring(0, inicio) + ' ' * (fin - inicio) + texto.substring(fin);
