import 'package:flutter/material.dart';

import 'cliente_rest.dart';
import 'manifiesto.dart';
import 'pantalla_ficha.dart';
import 'sesion.dart';
import 'valores.dart';

/// Los registros de una entidad, paginados como los devuelve Spring Data.
class PantallaLista extends StatefulWidget {
  const PantallaLista({super.key, required this.sesion, required this.entidad});

  final Sesion sesion;
  final EntidadManifiesto entidad;

  @override
  State<PantallaLista> createState() => _PantallaListaState();
}

class _PantallaListaState extends State<PantallaLista> {
  final List<Map<String, dynamic>> _registros = <Map<String, dynamic>>[];
  int _pagina = 0;
  int _total = 0;
  bool _cargando = false;
  bool _hayMas = true;
  String? _error;

  EntidadManifiesto get _entidad => widget.entidad;

  @override
  void initState() {
    super.initState();
    _cargarMas();
  }

  Future<void> _recargar() async {
    setState(() {
      _registros.clear();
      _pagina = 0;
      _hayMas = true;
      _error = null;
    });
    await _cargarMas();
  }

  Future<void> _cargarMas() async {
    if (_cargando || !_hayMas) return;
    final cliente = widget.sesion.cliente;
    final manifiesto = widget.sesion.manifiesto;
    if (cliente == null || manifiesto == null) return;

    setState(() => _cargando = true);
    try {
      final pagina = await cliente.listar(manifiesto, _entidad, pagina: _pagina);
      if (!mounted) return;
      setState(() {
        _registros.addAll(pagina.contenido);
        _total = pagina.total;
        _hayMas = pagina.hayMas;
        _pagina += 1;
        _error = null;
      });
    } on ErrorHttp catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } on ErrorDeRed catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _cargando = false);
    }
  }

  Future<void> _abrirFicha({Map<String, dynamic>? registro}) async {
    final guardado = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        builder: (_) => PantallaFicha(
          sesion: widget.sesion,
          entidad: _entidad,
          registro: registro,
        ),
      ),
    );
    if (guardado == true) await _recargar();
  }

  /// Confirmación de borrado.
  ///
  /// El aviso dice qué más desaparece porque el manifiesto lo sabe: eso sale
  /// del rombo relleno de una composición en el diagrama y no hay forma de
  /// deducirlo mirando la API. Es la diferencia entre «esto también eliminará
  /// sus líneas» y un «¿seguro?» que no informa de nada.
  Future<void> _borrar(Map<String, dynamic> registro) async {
    final cascada = _entidad.borradoEnCascada;
    final nombre = etiquetaDeRegistro(_entidad, registro);

    final confirmado = await showDialog<bool>(
      context: context,
      builder: (contexto) => AlertDialog(
        title: Text('¿Borrar $nombre?'),
        content: Text(
          cascada.isEmpty
              ? 'No se puede deshacer.'
              : 'También desaparecerá lo que cuelgue de él: '
                  '${cascada.join(', ')}. No se puede deshacer.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(contexto).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(contexto).pop(true),
            child: const Text('Borrar'),
          ),
        ],
      ),
    );
    if (confirmado != true || !mounted) return;

    final cliente = widget.sesion.cliente!;
    final manifiesto = widget.sesion.manifiesto!;
    try {
      await cliente.borrar(
        manifiesto,
        _entidad,
        registro[_entidad.identificador.nombre] as Object,
        // La clave se crea al confirmar, que es cuando empieza la orden. Si se
        // creara dentro del cliente, cada reintento traería una distinta.
        claveIdempotencia: nuevaClaveIdempotencia('borrar'),
      );
      await _recargar();
    } on Exception catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final puedeCrear = _entidad.admite(Accion.crear);
    return Scaffold(
      appBar: AppBar(
        title: Text(_entidad.nombre),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(20),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(
              _total == 0 ? '—' : '$_total ${_entidad.plural}',
              style: const TextStyle(color: Color(0xFF8A93A6), fontSize: 12.5),
            ),
          ),
        ),
      ),
      floatingActionButton: puedeCrear
          ? FloatingActionButton.extended(
              onPressed: () => _abrirFicha(),
              icon: const Icon(Icons.add),
              label: Text('Nuevo ${_entidad.singular}'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _recargar,
        child: _cuerpo(),
      ),
    );
  }

  Widget _cuerpo() {
    if (_error != null && _registros.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const Icon(Icons.cloud_off, size: 40, color: Color(0xFF8A93A6)),
          const SizedBox(height: 14),
          SelectableText(_error!, textAlign: TextAlign.center),
          const SizedBox(height: 18),
          Center(
            child: FilledButton(onPressed: _recargar, child: const Text('Reintentar')),
          ),
        ],
      );
    }

    if (_registros.isEmpty && !_cargando) {
      return ListView(
        padding: const EdgeInsets.all(32),
        children: [
          Text(
            'Todavía no hay ${_entidad.plural}.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Color(0xFF8A93A6)),
          ),
        ],
      );
    }

    return NotificationListener<ScrollEndNotification>(
      onNotification: (aviso) {
        final posicion = aviso.metrics;
        if (posicion.pixels >= posicion.maxScrollExtent - 240) _cargarMas();
        return false;
      },
      child: ListView.separated(
        itemCount: _registros.length + (_cargando ? 1 : 0),
        separatorBuilder: (_, _) => const Divider(height: 1),
        itemBuilder: (context, indice) {
          if (indice >= _registros.length) {
            return const Padding(
              padding: EdgeInsets.all(20),
              child: Center(child: CircularProgressIndicator()),
            );
          }
          final registro = _registros[indice];
          return ListTile(
            title: Text(etiquetaDeRegistro(_entidad, registro)),
            subtitle: Text(_resumen(registro), maxLines: 2, overflow: TextOverflow.ellipsis),
            onTap: _entidad.admite(Accion.actualizar)
                ? () => _abrirFicha(registro: registro)
                : null,
            trailing: _entidad.admite(Accion.borrar)
                ? IconButton(
                    tooltip: 'Borrar',
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () => _borrar(registro),
                  )
                : null,
          );
        },
      ),
    );
  }

  /// Segunda línea de cada fila: los primeros campos que no sean la etiqueta.
  String _resumen(Map<String, dynamic> registro) {
    final partes = <String>[];
    for (final campo in _entidad.campos) {
      if (campo.nombre == _entidad.campoEtiqueta) continue;
      final valor = registro[campo.nombre];
      if (valor == null) continue;
      partes.add('${campo.etiqueta}: ${textoDesdeValor(campo, valor)}');
      if (partes.length == 3) break;
    }
    return partes.join(' · ');
  }
}
