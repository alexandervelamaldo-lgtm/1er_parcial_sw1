/// En qué variante del castellano escucha el teléfono, y cuánto espera.
///
/// Está aparte de `voz_nativa.dart` y sin ninguna dependencia de Flutter para
/// poder probarlo con `flutter test` sin micrófono: es una decisión sobre listas
/// de cadenas, y las decisiones se prueban mejor solas.
///
/// Existe porque `localeId: 'es-ES'` estaba escrito a mano en la llamada a
/// `listen`. El modelo de reconocimiento de España espera la pronunciación de
/// España, y a quien habla castellano de América le devuelve otra palabra por
/// cada palabra que dice. Desde fuera eso no se ve como un idioma mal elegido:
/// se ve como «el micrófono no me entiende».
library;

/// Cuánto se escucha como máximo en una sola sesión de dictado.
///
/// El plugin, sin esto, usa el tope de Android, que es corto y no se anuncia. No
/// está para limitar al usuario sino para que un micrófono olvidado se apague:
/// dos minutos es más de lo que dura cualquier orden y menos de lo que tarda en
/// notarse en la batería.
const Duration duracionMaximaDelDictado = Duration(seconds: 120);

/// Silencio que da la frase por terminada.
///
/// Es el arreglo de «no me da tiempo». El valor de Android por omisión ronda los
/// dos segundos, y una orden como «crea la clase Pedido… con el atributo
/// total… de tipo Double» tiene dos pausas más largas que eso: el reconocedor
/// cerraba a mitad y enviaba media orden. Ocho segundos es más que cualquier
/// pausa al pensar y bastante menos que el olvido.
const Duration pausaQueTerminaElDictado = Duration(seconds: 8);

/// Lo que se pide cuando el teléfono no ofrece ninguna variante utilizable.
///
/// `null` y no `'es-ES'`: sin información, decidir por el usuario es
/// precisamente lo que estaba roto. Dejar que el plugin use el idioma del
/// sistema acierta más que imponer una región inventada desde aquí.
const String? sinIdiomaPreferido = null;

/// La lengua de una etiqueta de idioma, en minúsculas (`es_BO` → `es`).
String _lengua(String etiqueta) => _partes(etiqueta).first;

/// La región, en minúsculas, o cadena vacía si la etiqueta no la trae.
String _region(String etiqueta) {
  final partes = _partes(etiqueta);
  return partes.length > 1 ? partes[1] : '';
}

List<String> _partes(String etiqueta) =>
    etiqueta.trim().toLowerCase().replaceAll('-', '_').split('_');

bool _esCastellano(String etiqueta) => _lengua(etiqueta) == 'es';

/// Elige en qué variante del castellano escuchar, de entre las que hay.
///
/// Solo devuelve etiquetas que el propio teléfono ha declarado tener: pedir una
/// que no está instalada acaba en un fallo de idioma o, peor, en un modelo por
/// omisión que no se parece a lo pedido y que nadie eligió.
///
/// El orden de preferencia es el orden de la evidencia disponible:
///
/// 1. **La del sistema**, si es castellano y está. Es la mejor prueba que hay de
///    cómo habla quien tiene el teléfono en la mano.
/// 2. **La de la misma región que el sistema**, aunque el teléfono esté en otro
///    idioma. Un teléfono en inglés de México sigue siendo un teléfono en
///    México, y quien dicta en él dicta castellano de México.
/// 3. **Cualquier castellano que no sea el de España.** No es una manía: el
///    respaldo histórico de este código era `es-ES` y es justo el que menos
///    probabilidades tiene de acertar en el sitio donde se usa esto.
/// 4. **El de España**, si es el único que hay. Mal modelo es mejor que ninguno.
String? elegirIdiomaDeDictado({
  required List<String> disponibles,
  String? delSistema,
}) {
  final castellanos = disponibles.where(_esCastellano).toList();
  if (castellanos.isEmpty) return sinIdiomaPreferido;

  if (delSistema != null && _esCastellano(delSistema)) {
    final exacta = _mismaEtiqueta(castellanos, delSistema);
    if (exacta != null) return exacta;
  }

  if (delSistema != null) {
    final region = _region(delSistema);
    if (region.isNotEmpty) {
      final vecina = castellanos.firstWhere(
        (etiqueta) => _region(etiqueta) == region,
        orElse: () => '',
      );
      if (vecina.isNotEmpty) return vecina;
    }
  }

  final noPeninsular = castellanos.firstWhere(
    (etiqueta) => _region(etiqueta) != 'es',
    orElse: () => '',
  );
  return noPeninsular.isNotEmpty ? noPeninsular : castellanos.first;
}

/// La etiqueta de la lista que es la misma que la buscada, escrita como esté.
///
/// Se compara plegando el separador porque Android usa `es_BO` y la web usa
/// `es-BO` para lo mismo, pero se devuelve la forma original: la que entiende el
/// plugin es la que él mismo dio.
String? _mismaEtiqueta(List<String> lista, String buscada) {
  final objetivo = _partes(buscada).join('_');
  for (final etiqueta in lista) {
    if (_partes(etiqueta).join('_') == objetivo) return etiqueta;
  }
  return null;
}

/// Si el fallo es «no tengo ese idioma para reconocer aquí dentro».
///
/// Es la única familia de errores que no significa que el dictado no funcione:
/// significa que no funciona **sin salir a la red**, que es otra cosa y tiene
/// otra salida. De ahí que se distinga en vez de tratarla como un fallo más.
bool sinIdiomaEnElAparato(String codigo) {
  return codigo == 'error_language_unavailable' ||
      codigo == 'error_language_not_supported';
}

/// Si tras este fallo hay que dejar de reconocer dentro del aparato.
///
/// Dos motivos distintos con la misma salida. El primero es que el idioma no
/// está descargado, y entonces el reconocimiento local no es que falle: no
/// existe. El segundo es más incómodo de admitir: el modelo que cabe en un
/// teléfono entiende bastante peor que el que vive en el servidor de Google, y
/// cuando alguien acaba de hablar y lo único que recibe es «no se ha entendido»,
/// insistir con el mismo modelo le hará repetir la frase tres veces para nada.
///
/// Se cambia de modelo **una vez y avisando**, no en cada orden y no en
/// silencio. Callarlo sería peor que el fallo: cambia lo que se puede prometer
/// sobre el audio, que deja de quedarse en el teléfono.
bool dejarDeReconocerEnElAparato(String codigo) {
  return sinIdiomaEnElAparato(codigo) || codigo == 'error_no_match';
}
