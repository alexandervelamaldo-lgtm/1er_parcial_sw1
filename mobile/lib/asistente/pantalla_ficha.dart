import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'cliente_rest.dart';
import 'manifiesto.dart';
import 'selector_referencia.dart';
import 'sesion.dart';
import 'valores.dart';

/// Alta y edición de un registro, con el formulario armado desde el manifiesto.
///
/// Aquí no hay ni un campo escrito a mano. Cada widget sale del `tipo` que
/// declara el manifiesto: un enumerado es un desplegable con su lista cerrada,
/// una referencia es un selector que va a buscar los registros de la otra
/// entidad, una fecha abre el calendario. Añadir un atributo al diagrama y
/// regenerar el backend hace aparecer el campo aquí sin tocar Dart.
class PantallaFicha extends StatefulWidget {
  const PantallaFicha({
    super.key,
    required this.sesion,
    required this.entidad,
    this.registro,
    this.valoresIniciales,
    this.claveDictada,
  });

  final Sesion sesion;
  final EntidadManifiesto entidad;

  /// `null` para dar de alta; el registro existente para editar.
  final Map<String, dynamic>? registro;

  /// Lo que ya se dictó, indexado por nombre de campo.
  ///
  /// Una orden a medias —«nuevo cliente Ana Pérez», sin correo— no se rechaza:
  /// abre el formulario con lo entendido puesto y el cursor en lo que falta.
  /// Obligar a repetirlo todo por un dato que no se dijo sería la manera más
  /// rápida de que nadie volviera a usar el dictado.
  final Map<String, String>? valoresIniciales;

  /// La clave de idempotencia que se fijó al dictar.
  ///
  /// Viaja hasta aquí para que la orden siga siendo **la misma** orden: si la
  /// ficha generase una nueva, el reintento de un dictado que quizá ya llegó
  /// al servidor crearía un segundo registro. Si el usuario cambia algo en el
  /// formulario, el cuerpo deja de coincidir y la clave se renueva sola: eso ya
  /// es otra orden.
  final String? claveDictada;

  @override
  State<PantallaFicha> createState() => _PantallaFichaState();
}

class _PantallaFichaState extends State<PantallaFicha> {
  final _formulario = GlobalKey<FormState>();
  final Map<String, TextEditingController> _controles = {};
  final Map<String, String> _erroresDelServidor = {};

  /// Clave de idempotencia de la orden en curso, y el cuerpo con el que se
  /// emitió. Se conserva entre reintentos —que es toda su razón de ser— y solo
  /// se renueva si el usuario cambia algo: una clave identifica **una orden**,
  /// no una sesión, así que reusarla con otro cuerpo devolvería un 409 y sería
  /// el servidor quien tendría razón.
  String? _clave;
  String? _cuerpoDeLaClave;

  bool _guardando = false;
  String? _errorGeneral;

  EntidadManifiesto get _entidad => widget.entidad;
  bool get _esAlta => widget.registro == null;

  @override
  void initState() {
    super.initState();
    for (final campo in _entidad.camposEditables) {
      final dictado = widget.valoresIniciales?[campo.nombre];
      _controles[campo.nombre] = TextEditingController(
        text: dictado ?? textoDesdeValor(campo, widget.registro?[campo.nombre]),
      );
    }

    // La clave dictada se adopta junto con el cuerpo que le corresponde. Las
    // dos cosas van juntas o ninguna: guardar la clave sin su cuerpo haría que
    // el primer guardado la diera por caducada y generase otra, que es
    // exactamente lo que se quería evitar.
    final clave = widget.claveDictada;
    if (clave != null) {
      _clave = clave;
      _cuerpoDeLaClave = jsonEncode(cuerpoDesdeFormulario(_entidad, _textos));
    }
  }

  @override
  void dispose() {
    for (final control in _controles.values) {
      control.dispose();
    }
    super.dispose();
  }

  Map<String, String> get _textos =>
      _controles.map((clave, control) => MapEntry(clave, control.text));

  Future<void> _guardar() async {
    setState(() {
      _erroresDelServidor.clear();
      _errorGeneral = null;
    });
    if (!_formulario.currentState!.validate()) return;

    final cliente = widget.sesion.cliente!;
    final manifiesto = widget.sesion.manifiesto!;
    final cuerpo = cuerpoDesdeFormulario(_entidad, _textos);
    final serializado = jsonEncode(cuerpo);

    if (_clave == null || _cuerpoDeLaClave != serializado) {
      _clave = nuevaClaveIdempotencia(_esAlta ? 'alta' : 'edicion');
      _cuerpoDeLaClave = serializado;
    }

    setState(() => _guardando = true);
    try {
      if (_esAlta) {
        await cliente.crear(manifiesto, _entidad, cuerpo, claveIdempotencia: _clave);
      } else {
        await cliente.actualizar(
          manifiesto,
          _entidad,
          widget.registro![_entidad.identificador.nombre] as Object,
          cuerpo,
          claveIdempotencia: _clave,
        );
      }
      if (mounted) Navigator.of(context).pop(true);
    } on ErrorHttp catch (e) {
      if (!mounted) return;
      setState(() {
        // `fieldErrors` viene de `ErrorResponse`; poner cada mensaje debajo de
        // su campo es lo que convierte un 400 en algo accionable.
        _erroresDelServidor.addAll(e.erroresDeCampo);
        _errorGeneral = e.erroresDeCampo.isEmpty ? e.mensaje : null;
      });
      _formulario.currentState!.validate();
    } on ErrorDeRed catch (e) {
      if (mounted) {
        setState(() => _errorGeneral =
            '${e.mensaje}\n\nLa orden conserva su clave: al reintentar no se '
            'duplicará aunque la primera hubiera llegado.');
      }
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final titulo = _esAlta
        ? 'Nuevo ${_entidad.singular}'
        : 'Editar ${_entidad.singular}';

    return Scaffold(
      appBar: AppBar(title: Text(titulo)),
      body: Form(
        key: _formulario,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            for (final campo in _entidad.camposEditables) ...[
              _widgetDeCampo(campo),
              const SizedBox(height: 18),
            ],
            if (_errorGeneral != null) ...[
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0x33FF5C5C),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: SelectableText(_errorGeneral!),
              ),
              const SizedBox(height: 18),
            ],
            FilledButton(
              onPressed: _guardando ? null : _guardar,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(_guardando ? 'Guardando…' : 'Guardar'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// El validador combina lo que dice el manifiesto con lo que dijo el servidor.
  /// El del servidor gana: es el único que ha visto la base de datos.
  String? Function(String?) _validador(CampoManifiesto campo) {
    return (texto) {
      final delServidor = _erroresDelServidor[campo.nombre];
      if (delServidor != null) return delServidor;
      return validarCampo(campo, texto ?? '');
    };
  }

  Widget _widgetDeCampo(CampoManifiesto campo) {
    final control = _controles[campo.nombre]!;
    final etiqueta = campo.obligatorio ? '${campo.etiqueta} *' : campo.etiqueta;

    switch (campo.tipo) {
      case TipoCampo.booleano:
        return FormField<bool>(
          initialValue: control.text.toLowerCase() == 'true',
          onSaved: (valor) => control.text = '$valor',
          builder: (estado) => SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(campo.etiqueta),
            value: estado.value ?? false,
            onChanged: (valor) {
              estado.didChange(valor);
              control.text = '$valor';
            },
          ),
        );

      case TipoCampo.enumerado:
        final actual = campo.valores.contains(control.text) ? control.text : null;
        return DropdownButtonFormField<String>(
          initialValue: actual,
          decoration: InputDecoration(
            labelText: etiqueta,
            border: const OutlineInputBorder(),
            errorText: _erroresDelServidor[campo.nombre],
          ),
          items: [
            for (final valor in campo.valores)
              DropdownMenuItem(value: valor, child: Text(valor)),
          ],
          onChanged: (valor) => control.text = valor ?? '',
          validator: (valor) => campo.obligatorio && (valor == null || valor.isEmpty)
              ? 'Hace falta ${campo.etiqueta}'
              : null,
        );

      case TipoCampo.referencia:
        return SelectorReferencia(
          sesion: widget.sesion,
          campo: campo,
          control: control,
          validador: _validador(campo),
        );

      case TipoCampo.fecha:
        return _campoConCalendario(campo, control, etiqueta, hora: false);

      case TipoCampo.fechaHora:
        return _campoConCalendario(campo, control, etiqueta, hora: true);

      case TipoCampo.hora:
        return _campoDeTexto(
          campo,
          control,
          etiqueta,
          sufijo: IconButton(
            icon: const Icon(Icons.schedule),
            onPressed: () async {
              final elegida = await showTimePicker(
                context: context,
                initialTime: TimeOfDay.now(),
              );
              if (elegida == null) return;
              control.text =
                  '${elegida.hour.toString().padLeft(2, '0')}:${elegida.minute.toString().padLeft(2, '0')}';
            },
          ),
        );

      case TipoCampo.entero:
        return _campoDeTexto(campo, control, etiqueta,
            teclado: TextInputType.number,
            formatos: [FilteringTextInputFormatter.allow(RegExp(r'[0-9-]'))]);

      case TipoCampo.decimal:
        return _campoDeTexto(campo, control, etiqueta,
            teclado: const TextInputType.numberWithOptions(decimal: true),
            formatos: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,-]'))]);

      case TipoCampo.texto:
      case TipoCampo.uuid:
        return _campoDeTexto(campo, control, etiqueta,
            maximo: campo.maxLongitud);
    }
  }

  Widget _campoDeTexto(
    CampoManifiesto campo,
    TextEditingController control,
    String etiqueta, {
    TextInputType? teclado,
    List<TextInputFormatter>? formatos,
    int? maximo,
    Widget? sufijo,
  }) {
    return TextFormField(
      controller: control,
      keyboardType: teclado,
      inputFormatters: formatos,
      maxLength: maximo,
      decoration: InputDecoration(
        labelText: etiqueta,
        border: const OutlineInputBorder(),
        suffixIcon: sufijo,
        counterText: '',
      ),
      validator: _validador(campo),
    );
  }

  Widget _campoConCalendario(
    CampoManifiesto campo,
    TextEditingController control,
    String etiqueta, {
    required bool hora,
  }) {
    return _campoDeTexto(
      campo,
      control,
      etiqueta,
      sufijo: IconButton(
        icon: const Icon(Icons.event),
        onPressed: () async {
          final ahora = DateTime.now();
          final dia = await showDatePicker(
            context: context,
            initialDate: ahora,
            firstDate: DateTime(ahora.year - 20),
            lastDate: DateTime(ahora.year + 20),
          );
          if (dia == null) return;
          if (!hora) {
            control.text = comoFecha(dia);
            return;
          }
          if (!mounted) return;
          final momento = await showTimePicker(
            context: context,
            initialTime: TimeOfDay.now(),
          );
          if (momento == null) return;
          control.text = comoFechaHora(DateTime(
            dia.year,
            dia.month,
            dia.day,
            momento.hour,
            momento.minute,
          ));
        },
      ),
    );
  }
}
