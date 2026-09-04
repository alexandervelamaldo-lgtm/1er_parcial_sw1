/// Conversión entre lo que se teclea y lo que viaja en el JSON.
///
/// Está aparte de los widgets a propósito: son funciones puras y son las que
/// deciden si un formulario manda `"3,50"` —que el backend rechaza con un 400
/// desconcertante— o `3.5`. Poderlas probar sin levantar interfaz es la
/// diferencia entre saber que funcionan y suponerlo.
library;

import 'manifiesto.dart';

/// Con qué texto se representa un registro en una lista.
///
/// Si el manifiesto señaló un `campoEtiqueta` se usa ese —es el primer texto
/// obligatorio de la clase, normalmente el nombre—; si no, queda el
/// identificador, que al menos es único. Enseñar el id no es bonito, pero una
/// fila en blanco es peor.
String etiquetaDeRegistro(EntidadManifiesto entidad, Map<String, dynamic> registro) {
  final clave = entidad.campoEtiqueta;
  if (clave != null) {
    final valor = registro[clave];
    if (valor != null && '$valor'.trim().isNotEmpty) return '$valor';
  }
  final id = registro[entidad.identificador.nombre];
  return id == null ? '(sin identificar)' : '#$id';
}

/// Texto que el formulario debe mostrar para un valor que vino del servidor.
String textoDesdeValor(CampoManifiesto campo, Object? valor) {
  if (valor == null) return '';
  switch (campo.tipo) {
    case TipoCampo.decimal:
      // Se enseña con coma porque es como se escribe en español, y se vuelve a
      // convertir al enviar. El backend nunca ve la coma.
      return '$valor'.replaceAll('.', ',');
    case TipoCampo.fechaHora:
      // Jackson serializa `2026-09-04T10:30:00`; en pantalla sobra la T.
      return '$valor'.replaceFirst('T', ' ');
    default:
      return '$valor';
  }
}

/// Valida lo tecleado contra lo que el manifiesto promete del campo.
///
/// Devuelve el mensaje de error o `null` si vale. Duplica a propósito parte de
/// lo que el backend comprobará otra vez: la validación de cliente existe para
/// no gastar un viaje de red, no para sustituir a la del servidor, que es la
/// única que manda.
String? validarCampo(CampoManifiesto campo, String texto) {
  final limpio = texto.trim();

  if (limpio.isEmpty) {
    return campo.obligatorio ? 'Hace falta ${campo.etiqueta}' : null;
  }

  switch (campo.tipo) {
    case TipoCampo.texto:
      final maximo = campo.maxLongitud;
      if (maximo != null && limpio.length > maximo) {
        return 'Como mucho $maximo caracteres';
      }
      return null;

    case TipoCampo.entero:
    case TipoCampo.referencia:
      if (int.tryParse(limpio) == null) return 'Tiene que ser un número entero';
      return null;

    case TipoCampo.decimal:
      if (double.tryParse(limpio.replaceAll(',', '.')) == null) {
        return 'Tiene que ser un número';
      }
      return null;

    case TipoCampo.booleano:
      return null;

    case TipoCampo.fecha:
      return RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(limpio)
          ? null
          : 'Formato de fecha: 2026-09-23';

    case TipoCampo.fechaHora:
      return RegExp(r'^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$').hasMatch(limpio)
          ? null
          : 'Formato: 2026-09-23 10:30';

    case TipoCampo.hora:
      return RegExp(r'^\d{2}:\d{2}(:\d{2})?$').hasMatch(limpio)
          ? null
          : 'Formato de hora: 10:30';

    case TipoCampo.uuid:
      return RegExp(
        r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
      ).hasMatch(limpio)
          ? null
          : 'No parece un identificador válido';

    case TipoCampo.enumerado:
      // La lista es cerrada y viene del diagrama: si lo tecleado no está, no es
      // que el backend vaya a quejarse, es que no existe tal estado.
      return campo.valores.contains(limpio)
          ? null
          : 'Tiene que ser uno de: ${campo.valores.join(', ')}';
  }
}

/// Convierte lo tecleado en el valor que se manda en el JSON.
///
/// Un campo vacío y no obligatorio se manda como `null` explícito y no se omite:
/// el DTO es un `record` con todos sus componentes, y omitir la clave en un
/// `PUT` dejaría el campo a null igual pero por accidente. Mejor decirlo.
Object? valorParaEnviar(CampoManifiesto campo, String texto) {
  final limpio = texto.trim();
  if (limpio.isEmpty) return null;

  switch (campo.tipo) {
    case TipoCampo.entero:
    case TipoCampo.referencia:
      return int.tryParse(limpio);

    case TipoCampo.decimal:
      return double.tryParse(limpio.replaceAll(',', '.'));

    case TipoCampo.booleano:
      return limpio.toLowerCase() == 'true' || limpio == '1';

    case TipoCampo.fechaHora:
      // El espacio que se enseña vuelve a ser T, y si no se dictaron segundos se
      // completan: `LocalDateTime` de Jackson acepta ambos, pero mandar siempre
      // la misma forma hace que la huella de idempotencia de dos reintentos del
      // mismo dictado coincida.
      final conT = limpio.replaceFirst(' ', 'T');
      return RegExp(r':\d{2}:\d{2}$').hasMatch(conT) ? conT : '$conT:00';

    case TipoCampo.hora:
      return RegExp(r'^\d{2}:\d{2}$').hasMatch(limpio) ? '$limpio:00' : limpio;

    default:
      return limpio;
  }
}

/// Arma el cuerpo completo de un `POST` o un `PUT`.
///
/// Recorre los campos del manifiesto y no las claves del formulario: así, si el
/// diagrama gana un campo y la pantalla todavía no, el cuerpo sigue teniendo la
/// forma que el DTO espera.
Map<String, dynamic> cuerpoDesdeFormulario(
  EntidadManifiesto entidad,
  Map<String, String> textos,
) {
  final cuerpo = <String, dynamic>{};
  for (final campo in entidad.camposEditables) {
    cuerpo[campo.nombre] = valorParaEnviar(campo, textos[campo.nombre] ?? '');
  }
  return cuerpo;
}

/// Fecha de hoy en el formato que entiende `LocalDate`.
String comoFecha(DateTime momento) =>
    '${momento.year.toString().padLeft(4, '0')}-'
    '${momento.month.toString().padLeft(2, '0')}-'
    '${momento.day.toString().padLeft(2, '0')}';

/// Hora en el formato que entiende `LocalTime`.
String comoHora(DateTime momento) =>
    '${momento.hour.toString().padLeft(2, '0')}:'
    '${momento.minute.toString().padLeft(2, '0')}';

/// Fecha y hora como se enseñan en pantalla, con espacio en vez de T.
String comoFechaHora(DateTime momento) => '${comoFecha(momento)} ${comoHora(momento)}';
