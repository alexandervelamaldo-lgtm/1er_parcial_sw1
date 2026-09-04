import 'package:flutter/material.dart';

import 'cliente_rest.dart';
import 'gramatica.dart';
import 'manifiesto.dart';
import 'pantalla_ficha.dart';
import 'pantalla_lista.dart';
import 'sesion.dart';
import 'valores.dart';

/// La pantalla de órdenes: se escribe —y en la Fase 4, se dice— qué hacer.
///
/// Lo que se ve aquí no está escrito para ningún dominio. Los ejemplos que se
/// ofrecen, el repertorio de la ayuda y hasta el aviso de qué se lleva por
/// delante un borrado salen del manifiesto que publicó el backend generado.
/// Contra el proyecto «tienda» sugiere «muéstrame los clientes»; contra el de
/// una barbería sugerirá «muéstrame las citas», con el mismo APK.
///
/// La regla de oro de la ejecución: **nada irreversible sin decir antes qué va
/// a pasar**. Una lista se abre sin preguntar; un borrado enseña qué arrastra y
/// espera. Y una orden que se entendió a medias no se rechaza: abre la ficha
/// con lo entendido puesto, que es lo que un ayudante haría.
class PantallaAsistente extends StatefulWidget {
  const PantallaAsistente({super.key, required this.sesion});

  final Sesion sesion;

  @override
  State<PantallaAsistente> createState() => _PantallaAsistenteState();
}

class _PantallaAsistenteState extends State<PantallaAsistente> {
  final _control = TextEditingController();
  final _foco = FocusNode();
  final List<_Turno> _turnos = <_Turno>[];

  Interpretacion? _pendiente;
  bool _trabajando = false;

  Manifiesto get _manifiesto => widget.sesion.manifiesto!;
  ClienteRest get _cliente => widget.sesion.cliente!;

  @override
  void dispose() {
    _control.dispose();
    _foco.dispose();
    super.dispose();
  }

  void _interpretar() {
    final dicho = _control.text.trim();
    if (dicho.isEmpty) return;
    final resultado = Interprete(_manifiesto).interpretar(dicho);
    setState(() {
      _turnos.add(_Turno(dicho: dicho, resultado: resultado));
      _pendiente = resultado.entendida ? resultado : null;
      _control.clear();
    });
    _foco.requestFocus();
  }

  // -------------------------------------------------------------------------

  Future<void> _ejecutar(Orden orden) async {
    setState(() {
      _pendiente = null;
      _trabajando = true;
    });
    try {
      switch (orden.accion) {
        case Accion.listar:
          await _abrir(PantallaLista(
            sesion: widget.sesion,
            entidad: orden.entidad,
          ));
        case Accion.ver:
          final registro = await _resolver(orden);
          if (registro == null || !mounted) return;
          await _abrir(PantallaFicha(
            sesion: widget.sesion,
            entidad: orden.entidad,
            registro: registro,
          ));
        case Accion.crear:
          await _crear(orden);
        case Accion.actualizar:
          final registro = await _resolver(orden);
          if (registro == null || !mounted) return;
          await _abrir(PantallaFicha(
            sesion: widget.sesion,
            entidad: orden.entidad,
            registro: registro,
            valoresIniciales: orden.valores,
            claveDictada: orden.claveIdempotencia,
          ));
        case Accion.borrar:
          await _borrar(orden);
      }
    } on ErrorHttp catch (e) {
      _decir(e.mensaje, ok: false);
    } on ErrorDeRed catch (e) {
      _decir(
        '${e.mensaje}\n\nLa orden conserva su clave: al reintentarla no se '
        'duplicará aunque la primera hubiera llegado.',
        ok: false,
      );
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  /// Un alta se manda sola solo cuando no queda nada que preguntar.
  ///
  /// Si falta un campo obligatorio o la frase no se entendió del todo, se abre
  /// la ficha con lo que sí se entendió. Mandarlo igual daría un 400 que el
  /// usuario no sabría corregir, y rechazarlo del todo le obligaría a repetir
  /// entera una frase que estaba casi bien.
  Future<void> _crear(Orden orden) async {
    if (!orden.completa || orden.confianza < 0.8) {
      await _abrir(PantallaFicha(
        sesion: widget.sesion,
        entidad: orden.entidad,
        valoresIniciales: orden.valores,
        claveDictada: orden.claveIdempotencia,
      ));
      return;
    }
    if (orden.necesitaConfirmacion && !await _confirmar(orden)) return;

    final creado = await _cliente.crear(
      _manifiesto,
      orden.entidad,
      orden.cuerpo,
      claveIdempotencia: orden.claveIdempotencia,
    );
    _decir('Hecho: ${etiquetaDeRegistro(orden.entidad, creado)}.');
  }

  Future<void> _borrar(Orden orden) async {
    final registro = await _resolver(orden);
    if (registro == null || !mounted) return;
    if (!await _confirmar(orden, registro: registro)) return;

    await _cliente.borrar(
      _manifiesto,
      orden.entidad,
      registro[orden.entidad.identificador.nombre] as Object,
      claveIdempotencia: orden.claveIdempotencia,
    );
    _decir('Borrado ${etiquetaDeRegistro(orden.entidad, registro)}.');
  }

  /// Encuentra el registro del que habla la orden.
  ///
  /// Con número, una consulta directa. Con nombre hay que buscar, y si sale más
  /// de uno **no se elige por el usuario**: se le enseñan y decide. Quedarse con
  /// el primero sería borrar al cliente equivocado sin que nadie se enterase.
  Future<Map<String, dynamic>?> _resolver(Orden orden) async {
    final id = orden.identificador;
    if (id != null) {
      try {
        return await _cliente.obtener(_manifiesto, orden.entidad, id);
      } on ErrorHttp catch (e) {
        if (!e.noExiste) rethrow;
        _decir('No hay ${orden.entidad.singular} con el número $id.', ok: false);
        return null;
      }
    }

    final buscado = orden.busqueda;
    if (buscado == null) return null;

    final pagina = await _cliente.listar(
      _manifiesto,
      orden.entidad,
      tamano: 100,
    );
    final aguja = plegar(buscado);
    final candidatos = pagina.contenido
        .where((r) => plegar(etiquetaDeRegistro(orden.entidad, r)).contains(aguja))
        .toList(growable: false);

    if (candidatos.isEmpty) {
      _decir('No encuentro «$buscado» entre ${orden.entidad.plural}.', ok: false);
      return null;
    }
    if (candidatos.length == 1) return candidatos.single;
    if (!mounted) return null;
    return _elegir(orden.entidad, candidatos);
  }

  Future<Map<String, dynamic>?> _elegir(
    EntidadManifiesto entidad,
    List<Map<String, dynamic>> candidatos,
  ) =>
      showDialog<Map<String, dynamic>>(
        context: context,
        builder: (contexto) => SimpleDialog(
          title: Text('¿Cuál de los ${candidatos.length}?'),
          children: [
            for (final registro in candidatos)
              SimpleDialogOption(
                onPressed: () => Navigator.of(contexto).pop(registro),
                child: Text(
                  '${etiquetaDeRegistro(entidad, registro)}  '
                  '(#${registro[entidad.identificador.nombre]})',
                ),
              ),
          ],
        ),
      );

  Future<bool> _confirmar(Orden orden, {Map<String, dynamic>? registro}) async {
    final que = registro == null
        ? orden.explicacion
        : '${orden.explicacion.replaceAll(RegExp(r'\.$'), '')}: '
            '${etiquetaDeRegistro(orden.entidad, registro)}.';

    final si = await showDialog<bool>(
      context: context,
      builder: (contexto) => AlertDialog(
        title: Text(que),
        content: Text(orden.advertencia ?? 'No se puede deshacer.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(contexto).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(contexto).pop(true),
            child: const Text('Sí, adelante'),
          ),
        ],
      ),
    );
    if (si != true) _decir('Cancelado.', ok: false);
    return si == true;
  }

  Future<void> _abrir(Widget pantalla) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(builder: (_) => pantalla),
    );
  }

  void _decir(String texto, {bool ok = true}) {
    if (!mounted) return;
    setState(() => _turnos.add(_Turno.respuesta(texto, ok: ok)));
  }

  // -------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Asistente'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(20),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(
              _manifiesto.proyecto,
              style: const TextStyle(color: Color(0xFF8A93A6), fontSize: 12.5),
            ),
          ),
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: _turnos.isEmpty
                ? _Sugerencias(
                    manifiesto: _manifiesto,
                    alElegir: (frase) {
                      _control.text = frase;
                      _interpretar();
                    },
                  )
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                    itemCount: _turnos.length,
                    itemBuilder: (_, i) => _Burbuja(turno: _turnos[i]),
                  ),
          ),
          if (_pendiente?.orden != null) _Propuesta(
            interpretacion: _pendiente!,
            trabajando: _trabajando,
            alConfirmar: () => _ejecutar(_pendiente!.orden!),
            alDescartar: () => setState(() => _pendiente = null),
          ),
          _Entrada(
            control: _control,
            foco: _foco,
            habilitado: !_trabajando,
            alEnviar: _interpretar,
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------

class _Turno {
  _Turno({required this.dicho, required this.resultado}) : ok = true;
  _Turno.respuesta(String texto, {required this.ok})
      : dicho = null,
        resultado = Interpretacion(explicacion: texto, confianza: 1);

  final String? dicho;
  final Interpretacion resultado;
  final bool ok;
}

class _Burbuja extends StatelessWidget {
  const _Burbuja({required this.turno});

  final _Turno turno;

  @override
  Widget build(BuildContext context) {
    final dicho = turno.dicho;
    final resultado = turno.resultado;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (dicho != null)
          Align(
            alignment: Alignment.centerRight,
            child: Container(
              margin: const EdgeInsets.only(top: 10, left: 40),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primaryContainer,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Text(dicho),
            ),
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: Container(
            margin: const EdgeInsets.only(top: 8, right: 40),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
            decoration: BoxDecoration(
              color: turno.ok
                  ? Theme.of(context).colorScheme.surfaceContainerHighest
                  : Theme.of(context).colorScheme.errorContainer,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(resultado.explicacion),
                if (resultado.aclaracion != null) ...[
                  const SizedBox(height: 5),
                  Text(
                    resultado.aclaracion!,
                    style: const TextStyle(
                      color: Color(0xFF8A93A6),
                      fontSize: 12.5,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Lo que se va a hacer, antes de hacerlo.
class _Propuesta extends StatelessWidget {
  const _Propuesta({
    required this.interpretacion,
    required this.trabajando,
    required this.alConfirmar,
    required this.alDescartar,
  });

  final Interpretacion interpretacion;
  final bool trabajando;
  final VoidCallback alConfirmar;
  final VoidCallback alDescartar;

  @override
  Widget build(BuildContext context) {
    final orden = interpretacion.orden!;
    // Una orden mal entendida se ejecuta igual de rápido que una bien
    // entendida. Enseñar la confianza cuando es baja es lo único que le da al
    // usuario la ocasión de pararla.
    final dudosa = orden.confianza < 0.8;

    return Material(
      color: Theme.of(context).colorScheme.surfaceContainer,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  dudosa ? Icons.help_outline : Icons.play_arrow,
                  size: 18,
                  color: const Color(0xFF8A93A6),
                ),
                const SizedBox(width: 8),
                Expanded(child: Text(orden.explicacion)),
              ],
            ),
            if (orden.advertencia != null) ...[
              const SizedBox(height: 6),
              Text(
                orden.advertencia!,
                style: TextStyle(
                  fontSize: 12.5,
                  color: Theme.of(context).colorScheme.error,
                ),
              ),
            ],
            if (dudosa) ...[
              const SizedBox(height: 6),
              const Text(
                'No estoy seguro de haberlo entendido bien.',
                style: TextStyle(fontSize: 12.5, color: Color(0xFF8A93A6)),
              ),
            ],
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: trabajando ? null : alDescartar,
                  child: const Text('No'),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: trabajando ? null : alConfirmar,
                  child: Text(trabajando ? 'Un momento…' : 'Adelante'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Entrada extends StatelessWidget {
  const _Entrada({
    required this.control,
    required this.foco,
    required this.habilitado,
    required this.alEnviar,
  });

  final TextEditingController control;
  final FocusNode foco;
  final bool habilitado;
  final VoidCallback alEnviar;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: control,
                focusNode: foco,
                enabled: habilitado,
                autofocus: true,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => alEnviar(),
                decoration: const InputDecoration(
                  hintText: 'Di qué quieres hacer',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
            ),
            const SizedBox(width: 8),
            IconButton.filled(
              onPressed: habilitado ? alEnviar : null,
              icon: const Icon(Icons.send),
              tooltip: 'Interpretar',
            ),
          ],
        ),
      ),
    );
  }
}

/// Cuatro frases de ejemplo, armadas con las palabras de este proyecto.
///
/// Un asistente sin ejemplos obliga a adivinar qué entiende, y lo primero que
/// hace la gente cuando no acierta a la primera es dejar de usarlo. Ninguna de
/// estas frases está escrita a mano: todas salen del manifiesto.
class _Sugerencias extends StatelessWidget {
  const _Sugerencias({required this.manifiesto, required this.alElegir});

  final Manifiesto manifiesto;
  final void Function(String) alElegir;

  @override
  Widget build(BuildContext context) {
    final frases = <String>[];
    for (final entidad in manifiesto.entidades) {
      if (entidad.admite(Accion.listar)) {
        frases.add('muéstrame los ${entidad.plural}');
      }
      if (entidad.admite(Accion.crear) && frases.length < 4) {
        final etiqueta = entidad.campoEtiqueta;
        final campo =
            etiqueta == null ? null : entidad.campoPorNombre(etiqueta);
        frases.add(campo == null
            ? 'nuevo ${entidad.singular}'
            : 'nuevo ${entidad.singular} con ${campo.etiqueta} ...');
      }
      if (frases.length >= 4) break;
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 40, 24, 24),
      children: [
        const Icon(Icons.chat_bubble_outline, size: 36, color: Color(0xFF8A93A6)),
        const SizedBox(height: 14),
        Text(
          'Dime qué hacer con ${manifiesto.proyecto} y lo hago.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 20),
        Wrap(
          alignment: WrapAlignment.center,
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final frase in frases.take(4))
              ActionChip(label: Text(frase), onPressed: () => alElegir(frase)),
            ActionChip(
              label: const Text('¿qué puedes hacer?'),
              onPressed: () => alElegir('¿qué puedes hacer?'),
            ),
          ],
        ),
      ],
    );
  }
}
