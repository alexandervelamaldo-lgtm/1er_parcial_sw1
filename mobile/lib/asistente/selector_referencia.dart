import 'package:flutter/material.dart';

import 'cliente_rest.dart';
import 'manifiesto.dart';
import 'sesion.dart';
import 'valores.dart';

/// Campo para una asociación: se elige el registro apuntado, no se teclea su id.
///
/// El manifiesto expone las asociaciones como `clienteId`, igual que el DTO,
/// porque eso es lo que viaja en el JSON. Pero pedirle a alguien que escriba
/// «17» en un campo llamado «cliente» es trasladarle un detalle de la base de
/// datos. Aquí se enseña el nombre —el `campoEtiqueta` de la entidad apuntada—
/// y se guarda el número por debajo.
class SelectorReferencia extends StatefulWidget {
  const SelectorReferencia({
    super.key,
    required this.sesion,
    required this.campo,
    required this.control,
    required this.validador,
  });

  final Sesion sesion;
  final CampoManifiesto campo;
  final TextEditingController control;
  final String? Function(String?) validador;

  @override
  State<SelectorReferencia> createState() => _SelectorReferenciaState();
}

class _SelectorReferenciaState extends State<SelectorReferencia> {
  String? _etiqueta;
  bool _resolviendo = false;

  @override
  void initState() {
    super.initState();
    if (widget.control.text.isNotEmpty) _resolverEtiqueta();
  }

  EntidadManifiesto? get _apuntada =>
      widget.sesion.manifiesto?.entidadPorNombre(widget.campo.entidad ?? '');

  /// Al editar, el registro llega con `clienteId: 17` y hace falta el nombre.
  /// Se pide esa ficha concreta; si falla —borrada, sin red— se enseña el
  /// número, que es feo pero cierto, en vez de un hueco.
  Future<void> _resolverEtiqueta() async {
    final entidad = _apuntada;
    final cliente = widget.sesion.cliente;
    final manifiesto = widget.sesion.manifiesto;
    if (entidad == null || cliente == null || manifiesto == null) return;

    setState(() => _resolviendo = true);
    try {
      final registro = await cliente.obtener(manifiesto, entidad, widget.control.text);
      if (mounted) setState(() => _etiqueta = etiquetaDeRegistro(entidad, registro));
    } on Exception {
      if (mounted) setState(() => _etiqueta = null);
    } finally {
      if (mounted) setState(() => _resolviendo = false);
    }
  }

  Future<void> _elegir() async {
    final entidad = _apuntada;
    if (entidad == null) return;
    final elegido = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ListaParaElegir(sesion: widget.sesion, entidad: entidad),
    );
    if (elegido == null) return;
    setState(() {
      widget.control.text = '${elegido[entidad.identificador.nombre]}';
      _etiqueta = etiquetaDeRegistro(entidad, elegido);
    });
  }

  @override
  Widget build(BuildContext context) {
    final campo = widget.campo;
    final etiqueta = campo.obligatorio ? '${campo.etiqueta} *' : campo.etiqueta;
    final texto = widget.control.text;

    return FormField<String>(
      initialValue: texto,
      validator: (_) => widget.validador(widget.control.text),
      builder: (estado) => InputDecorator(
        decoration: InputDecoration(
          labelText: etiqueta,
          border: const OutlineInputBorder(),
          errorText: estado.errorText,
          suffixIcon: _resolviendo
              ? const Padding(
                  padding: EdgeInsets.all(12),
                  child: SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              : IconButton(icon: const Icon(Icons.search), onPressed: _elegir),
        ),
        child: InkWell(
          onTap: _elegir,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Text(
              texto.isEmpty
                  ? 'Sin elegir'
                  : (_etiqueta == null ? '#$texto' : '$_etiqueta  (#$texto)'),
              style: TextStyle(
                color: texto.isEmpty ? const Color(0xFF8A93A6) : null,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ListaParaElegir extends StatefulWidget {
  const _ListaParaElegir({required this.sesion, required this.entidad});

  final Sesion sesion;
  final EntidadManifiesto entidad;

  @override
  State<_ListaParaElegir> createState() => _ListaParaElegirState();
}

class _ListaParaElegirState extends State<_ListaParaElegir> {
  List<Map<String, dynamic>> _registros = const [];
  String? _error;
  bool _cargando = true;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    final cliente = widget.sesion.cliente;
    final manifiesto = widget.sesion.manifiesto;
    if (cliente == null || manifiesto == null) return;
    try {
      // Una sola página amplia: elegir entre cientos con el pulgar no se
      // resuelve paginando sino buscando, y la búsqueda por texto no está en la
      // API generada todavía. Mejor un tope honesto que un scroll infinito.
      final pagina = await cliente.listar(manifiesto, widget.entidad, tamano: 100);
      if (mounted) setState(() => _registros = pagina.contenido);
    } on ErrorHttp catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } on ErrorDeRed catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _cargando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              'Elegir ${widget.entidad.singular}',
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
            ),
          ),
          if (_cargando)
            const Padding(
              padding: EdgeInsets.all(28),
              child: CircularProgressIndicator(),
            )
          else if (_error != null)
            Padding(
              padding: const EdgeInsets.all(24),
              child: SelectableText(_error!, textAlign: TextAlign.center),
            )
          else if (_registros.isEmpty)
            Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                'No hay ${widget.entidad.plural} que elegir. '
                'Crea uno primero.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Color(0xFF8A93A6)),
              ),
            )
          else
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: _registros.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, indice) {
                  final registro = _registros[indice];
                  return ListTile(
                    title: Text(etiquetaDeRegistro(widget.entidad, registro)),
                    onTap: () => Navigator.of(context).pop(registro),
                  );
                },
              ),
            ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}
