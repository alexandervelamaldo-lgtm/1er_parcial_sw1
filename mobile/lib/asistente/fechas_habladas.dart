/// Fechas y horas dichas en voz alta, convertidas a lo que espera el backend.
///
/// Vive aparte del intérprete porque es la parte con más casos particulares y
/// la que más barato sale probar sola: son funciones puras sobre texto ya
/// plegado más un reloj que se inyecta, así que «mañana» se puede comprobar sin
/// esperar a mañana.
///
/// Todo lo de aquí trabaja sobre el texto **plegado** —minúsculas, sin acentos—
/// que produce `plegar()` en `manifiesto.dart`. Es lo que permite que «miércoles»
/// y «miercoles» acaben en el mismo sitio sin escribir cada palabra dos veces.
library;

import 'valores.dart';

/// Lo que se ha entendido de un trozo de texto dictado.
class MomentoHablado {
  const MomentoHablado({this.fecha, this.hora, required this.resto});

  /// `yyyy-MM-dd`, o `null` si no se dijo ninguna fecha.
  final String? fecha;

  /// `HH:mm`, o `null` si no se dijo ninguna hora.
  final String? hora;

  /// La entrada con los trozos consumidos sustituidos por espacios.
  ///
  /// Se devuelve con la **misma longitud** que la entrada, y no recortado, a
  /// propósito: quien llama sigue usando los índices para cortar el texto
  /// original —el que conserva mayúsculas y acentos— por los mismos sitios. Un
  /// recorte aquí desplazaría todo lo de después y los nombres saldrían
  /// cortados por la mitad.
  final String resto;

  bool get vacio => fecha == null && hora == null;

  /// Las dos juntas como las lee `LocalDateTime`, si están las dos.
  String? get fechaHora =>
      (fecha != null && hora != null) ? '$fecha $hora' : null;
}

/// Busca una fecha y una hora en [plano], que debe venir ya plegado.
///
/// El orden importa y no es el que parece: **primero la hora y después la
/// fecha**. La razón es «mañana», que en español es a la vez el día siguiente y
/// la primera mitad del día. Si se buscara la fecha antes, «a las nueve de la
/// mañana» se entendería como «a las nueve» + «mañana el día siguiente», que es
/// justo lo contrario de lo que se dijo. Consumir primero la hora se lleva por
/// delante el «de la mañana» y deja el texto sin ambigüedad.
MomentoHablado leerMomento(String plano, DateTime ahora) {
  var resto = plano;

  String? hora;
  for (final patron in _patronesHora) {
    final encaje = patron.firstMatch(resto);
    if (encaje == null) continue;
    final leida = _componerHora(
      encaje.group(1)!,
      encaje.group(2),
      encaje.group(3),
    );
    if (leida == null) continue;
    hora = leida;
    resto = _blanquear(resto, encaje.start, encaje.end);
    break;
  }

  if (hora == null) {
    final encaje = _mediodia.firstMatch(resto);
    if (encaje != null) {
      hora = encaje.group(0)!.contains('medianoche') ? '00:00' : '12:00';
      resto = _blanquear(resto, encaje.start, encaje.end);
    }
  }

  String? fecha;
  for (final leer in _lectoresFecha) {
    final leida = leer(resto, ahora);
    if (leida == null) continue;
    fecha = leida.valor;
    resto = _blanquear(resto, leida.inicio, leida.fin);
    break;
  }

  return MomentoHablado(fecha: fecha, hora: hora, resto: resto);
}

// ---------------------------------------------------------------------------
// Números dichos con letra.

/// Del uno al treinta y uno: es todo lo que cabe en un día del mes o en una
/// hora. No se pretende un lector de números general; se pretende que «a las
/// tres» y «el veintitrés de septiembre» funcionen.
const Map<String, int> _cardinales = <String, int>{
  'un': 1, 'uno': 1, 'una': 1,
  'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6, 'siete': 7,
  'ocho': 8, 'nueve': 9, 'diez': 10, 'once': 11, 'doce': 12, 'trece': 13,
  'catorce': 14, 'quince': 15, 'dieciseis': 16, 'diecisiete': 17,
  'dieciocho': 18, 'diecinueve': 19, 'veinte': 20, 'veintiuno': 21,
  'veintiuna': 21, 'veintidos': 22, 'veintitres': 23, 'veinticuatro': 24,
  'veinticinco': 25, 'veintiseis': 26, 'veintisiete': 27, 'veintiocho': 28,
  'veintinueve': 29, 'treinta': 30, 'treinta y uno': 31,
};

/// Las claves de mayor a menor longitud.
///
/// En una alternación de expresión regular gana la primera que encaja, no la
/// más larga. Sin este orden, «veintitres» se leería como «veinte» y el día 23
/// se convertiría en el 20 sin que nadie se enterara.
final List<String> _clavesCardinales = _cardinales.keys.toList()
  ..sort((a, b) => b.length.compareTo(a.length));

final String _numero = '(?:\\d{1,2}|${_clavesCardinales.join('|')})';

int? _aNumero(String texto) =>
    int.tryParse(texto) ?? _cardinales[texto.trim()];

const List<String> _meses = <String>[
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/// Formas que también se dicen y que no son la del calendario oficial.
const Map<String, int> _mesesAlternos = <String, int>{'setiembre': 9};

final String _mesesPatron =
    '(?:${(<String>[..._meses, ..._mesesAlternos.keys]..sort((a, b) => b.length.compareTo(a.length))).join('|')})';

int? _aMes(String texto) {
  final indice = _meses.indexOf(texto);
  if (indice >= 0) return indice + 1;
  return _mesesAlternos[texto];
}

const Map<String, int> _diasSemana = <String, int>{
  'lunes': DateTime.monday,
  'martes': DateTime.tuesday,
  'miercoles': DateTime.wednesday,
  'jueves': DateTime.thursday,
  'viernes': DateTime.friday,
  'sabado': DateTime.saturday,
  'domingo': DateTime.sunday,
};

// ---------------------------------------------------------------------------
// Horas.

/// «y media», «y cuarto», «menos cuarto», «en punto», «y veinte minutos».
final String _modificador = '(?:\\s+y\\s+media|\\s+y\\s+cuarto|'
    '\\s+menos\\s+cuarto|\\s+en\\s+punto|\\s+y\\s+$_numero(?:\\s+minutos?)?)';

final String _meridiano =
    '(?:\\s+de\\s+la\\s+(?:manana|tarde|noche|madrugada)|\\s+del\\s+mediodia)';

/// Tres formas de decir una hora, en orden de menos a más ambigua.
///
/// No se admite un número suelto como hora. «Crea un producto precio 19» no
/// dice las siete de la tarde, y aceptarlo convertiría cualquier cifra del
/// dictado en una cita. Hace falta una de tres señales: el «a las» delante, los
/// dos puntos del reloj, o el «de la tarde» detrás.
final List<RegExp> _patronesHora = <RegExp>[
  RegExp('\\ba\\s+las?\\s+(\\d{1,2}:\\d{2}|$_numero)'
      '($_modificador)?($_meridiano)?'),
  RegExp('\\b(\\d{1,2}:\\d{2})($_modificador)?($_meridiano)?'),
  RegExp('\\b($_numero)($_modificador)?($_meridiano)'),
];

final RegExp _mediodia = RegExp(r'\b(?:al?\s+)?(?:mediodia|medianoche)\b');

final RegExp _minutosDichos = RegExp('y\\s+($_numero)');

String? _componerHora(String base, String? modificador, String? meridiano) {
  int horas;
  var minutos = 0;
  final digital = base.contains(':');

  if (digital) {
    final partes = base.split(':');
    horas = int.parse(partes[0]);
    minutos = int.parse(partes[1]);
  } else {
    final leido = _aNumero(base);
    if (leido == null) return null;
    horas = leido;
  }

  if (modificador != null) {
    // «menos cuarto» antes que «cuarto»: la segunda es subcadena de la primera
    // y comprobarla antes daría las tres y cuarto donde se dijo las tres menos
    // cuarto, media hora larga de diferencia en una cita.
    if (modificador.contains('menos cuarto')) {
      minutos = 45;
      horas -= 1;
    } else if (modificador.contains('media')) {
      minutos = 30;
    } else if (modificador.contains('cuarto')) {
      minutos = 15;
    } else if (modificador.contains('en punto')) {
      minutos = 0;
    } else {
      final sueltos = _minutosDichos.firstMatch(modificador);
      final leidos = sueltos == null ? null : _aNumero(sueltos.group(1)!);
      if (leidos == null) return null;
      minutos = leidos;
    }
  }

  if (meridiano != null) {
    if (meridiano.contains('mediodia')) {
      horas = 12;
    } else if (meridiano.contains('tarde')) {
      if (horas < 12) horas += 12;
    } else if (meridiano.contains('noche')) {
      // «las doce de la noche» es medianoche, no mediodía.
      horas = horas == 12 ? 0 : (horas < 12 ? horas + 12 : horas);
    } else if (meridiano.contains('madrugada')) {
      if (horas == 12) horas = 0;
    }
    // «de la mañana» no cambia nada: las nueve de la mañana son las nueve.
  } else if (!digital && horas >= 1 && horas <= 7) {
    // Nadie reserva hora en la barbería a las tres de la madrugada. Cuando se
    // dice un número entre uno y siete sin decir la mitad del día, se entiende
    // la tarde. Es una suposición, y por eso solo se aplica al número dicho:
    // quien escribe «06:00» en el formulario está diciendo las seis de la
    // mañana y ahí no se toca nada.
    horas += 12;
  }

  if (horas == 24) horas = 0;
  if (horas < 0 || horas > 23 || minutos > 59) return null;
  return '${_dos(horas)}:${_dos(minutos)}';
}

// ---------------------------------------------------------------------------
// Fechas.

class _Hallazgo {
  const _Hallazgo(this.valor, this.inicio, this.fin);
  final String valor;
  final int inicio;
  final int fin;
}

typedef _LectorFecha = _Hallazgo? Function(String texto, DateTime ahora);

final List<_LectorFecha> _lectoresFecha = <_LectorFecha>[
  _fechaIso,
  _fechaConBarras,
  _fechaDeMes,
  _fechaRelativa,
  _fechaDiaSemana,
];

final RegExp _iso = RegExp(r'\b(\d{4})-(\d{1,2})-(\d{1,2})\b');

_Hallazgo? _fechaIso(String texto, DateTime ahora) {
  final m = _iso.firstMatch(texto);
  if (m == null) return null;
  final valor = _armar(
    int.parse(m.group(1)!),
    int.parse(m.group(2)!),
    int.parse(m.group(3)!),
  );
  return valor == null ? null : _Hallazgo(valor, m.start, m.end);
}

final RegExp _barras = RegExp(r'\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b');

_Hallazgo? _fechaConBarras(String texto, DateTime ahora) {
  final m = _barras.firstMatch(texto);
  if (m == null) return null;
  final anoDicho = m.group(3);
  var ano = ahora.year;
  if (anoDicho != null) {
    ano = int.parse(anoDicho);
    if (ano < 100) ano += 2000;
  }
  // Día antes que mes: es el orden en que se escribe una fecha en español.
  final valor = _armar(ano, int.parse(m.group(2)!), int.parse(m.group(1)!));
  return valor == null ? null : _Hallazgo(valor, m.start, m.end);
}

final RegExp _deMes = RegExp(
  '\\b(?:el\\s+)?($_numero)\\s+de\\s+($_mesesPatron)'
  '(?:\\s+del?\\s+(\\d{4}))?\\b',
);

_Hallazgo? _fechaDeMes(String texto, DateTime ahora) {
  final m = _deMes.firstMatch(texto);
  if (m == null) return null;
  final dia = _aNumero(m.group(1)!);
  final mes = _aMes(m.group(2)!);
  if (dia == null || mes == null) return null;

  final anoDicho = m.group(3);
  var ano = anoDicho != null ? int.parse(anoDicho) : ahora.year;
  if (anoDicho == null) {
    // Sin año, se entiende la próxima vez que llegue esa fecha. Quien dice «el
    // tres de enero» en diciembre no está pidiendo una cita once meses atrás.
    final candidata = DateTime(ano, mes, dia);
    final hoy = DateTime(ahora.year, ahora.month, ahora.day);
    if (candidata.isBefore(hoy)) ano += 1;
  }
  final valor = _armar(ano, mes, dia);
  return valor == null ? null : _Hallazgo(valor, m.start, m.end);
}

const Map<String, int> _relativas = <String, int>{
  'pasado manana': 2,
  'anteayer': -2,
  'antes de ayer': -2,
  'manana': 1,
  'hoy': 0,
  'esta noche': 0,
  'ayer': -1,
};

/// Igual que con los cardinales: de más larga a más corta, o «pasado mañana»
/// se leería como «mañana» y la cita caería un día antes.
final RegExp _relativa = RegExp(
  '\\b(?:${(_relativas.keys.toList()..sort((a, b) => b.length.compareTo(a.length))).join('|')})\\b',
);

_Hallazgo? _fechaRelativa(String texto, DateTime ahora) {
  final m = _relativa.firstMatch(texto);
  if (m == null) return null;
  final dias = _relativas[m.group(0)!]!;
  final dia = DateTime(ahora.year, ahora.month, ahora.day)
      .add(Duration(days: dias));
  return _Hallazgo(comoFecha(dia), m.start, m.end);
}

final RegExp _diaSemana = RegExp(
  '\\b(?:el\\s+|este\\s+)?(?:(proximo|siguiente)\\s+)?'
  '(${_diasSemana.keys.join('|')})'
  '(?:\\s+(que\\s+viene|proximo))?\\b',
);

_Hallazgo? _fechaDiaSemana(String texto, DateTime ahora) {
  final m = _diaSemana.firstMatch(texto);
  if (m == null) return null;
  final objetivo = _diasSemana[m.group(2)!]!;
  final hoy = DateTime(ahora.year, ahora.month, ahora.day);

  var salto = (objetivo - hoy.weekday) % 7;
  if (salto < 0) salto += 7;
  // «el próximo martes» dicho un martes es el de dentro de siete días; «el
  // martes» a secas dicho un martes es hoy. La diferencia la marca la palabra,
  // así que se respeta en vez de elegir una de las dos para todo.
  final insiste = m.group(1) != null || m.group(3) != null;
  if (salto == 0 && insiste) salto = 7;

  return _Hallazgo(
    comoFecha(hoy.add(Duration(days: salto))),
    m.start,
    m.end,
  );
}

/// Construye la fecha si existe de verdad.
///
/// `DateTime(2026, 2, 30)` no falla: devuelve el 2 de marzo. Aceptarlo sería
/// mandar al backend una fecha que nadie dictó, así que se comprueba que el
/// día y el mes hayan sobrevivido a la construcción.
String? _armar(int ano, int mes, int dia) {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  if (ano < 1900 || ano > 2999) return null;
  final fecha = DateTime(ano, mes, dia);
  if (fecha.month != mes || fecha.day != dia) return null;
  return comoFecha(fecha);
}

// ---------------------------------------------------------------------------

String _dos(int n) => n.toString().padLeft(2, '0');

/// Sustituye un tramo por espacios conservando la longitud total.
String _blanquear(String texto, int inicio, int fin) =>
    texto.substring(0, inicio) + ' ' * (fin - inicio) + texto.substring(fin);
