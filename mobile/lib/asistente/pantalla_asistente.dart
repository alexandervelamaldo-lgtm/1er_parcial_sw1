import 'package:flutter/material.dart';

import 'cliente_rest.dart';
import 'gramatica.dart';
import 'manifiesto.dart';
import 'pantalla_ficha.dart';
import 'pantalla_lista.dart';
import 'sesion.dart';
import 'valores.dart';
import 'voz.dart';

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
  const PantallaAsistente({super.key, required this.sesion, this.motor});

  final Sesion sesion;

  /// El micrófono. Se inyecta solo en las pruebas, donde no hay plataforma al
  /// otro lado del canal y un `SpeechToText` de verdad lanzaría al primer uso.
  final MotorDeVoz? motor;

  @override
  State<PantallaAsistente> createState() => _PantallaAsistenteState();
}

class _PantallaAsistenteState extends State<PantallaAsistente> {
  final _control = TextEditingController();
  final _foco = FocusNode();
  final List<_Turno> _turnos = <_Turno>[];
  late final Voz _voz;

  Interpretacion? _pendiente;
  bool _trabajando = false;

  /// Si lo último entró por el micrófono. Decide si se contesta en voz alta:
  /// a quien escribe no se le lee la respuesta, que sería una sorpresa ruidosa.
  bool _porVoz = false;

  /// Mientras un diálogo espera un sí o un no, lo dictado lo contesta a él y no
  /// abre una orden nueva. Es lo que permite terminar un borrado sin tocar la
  /// pantalla, que es la mitad de la promesa de este módulo.
  void Function(bool)? _esperandoRespuesta;

  Manifiesto get _manifiesto => widget.sesion.manifiesto!;
  ClienteRest get _cliente => widget.sesion.cliente!;

  @override
  void initState() {
    super.initState();
    _voz = Voz(motor: widget.motor)..alDictar = _oido;
  }

  @override
  void dispose() {
    _control.dispose();
    _foco.dispose();
    _voz.dispose();
    super.dispose();
  }

  /// Una frase terminada de dictar.
  ///
  /// El orden de las preguntas no es casual: primero se mira si contesta a algo
  /// que estaba esperando respuesta. Interpretar «no» como una orden nueva
  /// dejaría el diálogo abierto y al usuario repitiendo que no.
  void _oido(String frase) {
    final esperando = _esperandoRespuesta;
    if (esperando != null) {
      if (confirmaHablando(frase)) return esperando(true);
      if (cancelaHablando(frase)) return esperando(false);
      _voz.decir('Dime sí o no.');
      return;
    }

    final propuesta = _pendiente?.orden;
    if (propuesta != null) {
      if (confirmaHablando(frase)) {
        _ejecutar(propuesta);
        return;
      }
      if (cancelaHablando(frase)) {
        setState(() => _pendiente = null);
        _voz.decir('Vale, lo dejo.');
        return;
      }
      // Cualquier otra cosa es una orden nueva que sustituye a la propuesta.
      // Es lo que hace alguien que se ha explicado mal: no dice «no», vuelve a
      // decirlo de otra manera.
    }

    _control.text = frase;
    _interpretar(porVoz: true);
  }

  void _interpretar({bool porVoz = false}) {
    final dicho = _control.text.trim();
    if (dicho.isEmpty) return;
    final resultado = Interprete(_manifiesto).interpretar(dicho);
    setState(() {
      _porVoz = porVoz;
      _turnos.add(_Turno(dicho: dicho, resultado: resultado));
      _pendiente = resultado.entendida ? resultado : null;
      _control.clear();
    });
    if (porVoz) {
      _contestarEnVozAlta(resultado);
    } else {
      _foco.requestFocus();
    }
  }

  /// Lee la respuesta y, si hay algo que confirmar, vuelve a abrir el micrófono.
  ///
  /// Ese reenganche es la única escucha automática de toda la app, y está
  /// acotada a este caso: hay una pregunta en el aire y sería absurdo pedir un
  /// toque para contestarla. Fuera de aquí el micrófono se abre a mano, porque
  /// un micrófono que se enciende solo es un micrófono que graba sin que nadie
  /// se lo haya pedido.
  Future<void> _contestarEnVozAlta(Interpretacion resultado) async {
    final orden = resultado.orden;
    final partes = <String>[resultado.explicacion];
    if (orden?.advertencia != null) partes.add(orden!.advertencia!);
    if (resultado.aclaracion != null && orden == null) {
      partes.add(resultado.aclaracion!);
    }
    if (orden != null) partes.add('¿Lo hago?');

    await _voz.decir(partes.join(' '));
    if (orden != null && mounted && _pendiente?.orden == orden) {
      await _voz.escuchar();
    }
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

    final aviso = orden.advertencia ?? 'No se puede deshacer.';

    // Se pregunta contra el registro ya traído, no contra el número que se
    // dijo. Es la diferencia entre «¿borro el 7?» y «¿borro a Ana Pérez?»: la
    // segunda la puede contestar alguien que no se sepa los números de memoria.
    if (_porVoz) {
      await _voz.decir('$que $aviso ¿Lo confirmas?');
      if (!mounted) return false;
      await _voz.escuchar();
    }
    // Leer la pregunta lleva un par de segundos, tiempo de sobra para que
    // alguien salga de la pantalla. Preguntar por un `context` desmontado sería
    // un error en rojo justo encima de un borrado.
    if (!mounted) return false;

    // Se apunta *antes* de abrir el diálogo. `rootNavigator` cierra la ruta de
    // más arriba, que es el propio diálogo.
    _esperandoRespuesta =
        (ok) => Navigator.of(context, rootNavigator: true).pop(ok);
    final si = await showDialog<bool>(
      context: context,
      builder: (contexto) => AlertDialog(
        title: Text(que),
        content: Text(aviso),
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
    _esperandoRespuesta = null;
    await _voz.parar();

    if (si != true) _decir('Cancelado.', ok: false);
    return si == true;
  }

  Future<void> _abrir(Widget pantalla) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(builder: (_) => pantalla),
    );
  }

  /// Escribe la respuesta en la conversación y, si la orden vino hablada, la
  /// dice. Quien dictó tiene las manos ocupadas: enseñarle el resultado solo en
  /// la pantalla lo obliga a mirarla, que es justo lo que se quería evitar.
  void _decir(String texto, {bool ok = true}) {
    if (!mounted) return;
    setState(() => _turnos.add(_Turno.respuesta(texto, ok: ok)));
    if (_porVoz) _voz.decir(texto);
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
          ListenableBuilder(
            listenable: _voz,
            builder: (_, _) => _Entrada(
              control: _control,
              foco: _foco,
              habilitado: !_trabajando,
              voz: _voz,
              alEnviar: _interpretar,
            ),
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
    required this.voz,
    required this.alEnviar,
  });

  final TextEditingController control;
  final FocusNode foco;
  final bool habilitado;
  final Voz voz;
  final VoidCallback alEnviar;

  @override
  Widget build(BuildContext context) {
    final escuchando = voz.escuchando;
    final incidencia = voz.incidencia;

    return SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (incidencia != null)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.fromLTRB(12, 0, 12, 6),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.errorContainer,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // El texto es largo a propósito —dice qué pasó, cómo seguir
                  // ahora y cómo arreglarlo— así que se puede seleccionar y no
                  // se recorta.
                  Expanded(child: SelectableText(incidencia)),
                  IconButton(
                    onPressed: voz.olvidarIncidencia,
                    icon: const Icon(Icons.close, size: 18),
                    tooltip: 'Cerrar',
                  ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
            child: Row(
              children: [
                // El micrófono va el primero porque es la forma prevista de
                // usar esto; el teclado está para cuando el sitio es ruidoso.
                IconButton.filled(
                  onPressed: habilitado ? voz.alternar : null,
                  isSelected: escuchando,
                  icon: Icon(escuchando ? Icons.stop : Icons.mic),
                  tooltip: escuchando ? 'Parar' : 'Hablar',
                  style: escuchando
                      ? IconButton.styleFrom(
                          backgroundColor:
                              Theme.of(context).colorScheme.error,
                          foregroundColor:
                              Theme.of(context).colorScheme.onError,
                        )
                      : null,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: control,
                    focusNode: foco,
                    enabled: habilitado && !escuchando,
                    autofocus: true,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => alEnviar(),
                    decoration: InputDecoration(
                      // Mientras se dicta, lo que se lleva oído va aquí. Es la
                      // única señal de que el micrófono está captando algo:
                      // sin ella se repite la frase entera creyendo que falló.
                      hintText: escuchando
                          ? (voz.parcial.isEmpty ? 'Escuchando…' : voz.parcial)
                          : 'Di qué quieres hacer',
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  onPressed: habilitado && !escuchando ? alEnviar : null,
                  icon: const Icon(Icons.send),
                  tooltip: 'Interpretar',
                ),
              ],
            ),
          ),
        ],
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
