import 'package:flutter/material.dart';

import 'pantalla_entidades.dart';
import 'sesion.dart';

/// Primera pantalla del asistente: a qué backend nos conectamos.
///
/// Es la única pantalla de toda la app que está escrita a mano para algo
/// concreto. Todo lo que viene después —qué entidades hay, qué campos tienen,
/// qué se puede hacer con ellas— sale del manifiesto que se descarga aquí.
class PantallaConexion extends StatefulWidget {
  const PantallaConexion({super.key, required this.sesion});

  final Sesion sesion;

  @override
  State<PantallaConexion> createState() => _PantallaConexionState();
}

class _PantallaConexionState extends State<PantallaConexion> {
  late final TextEditingController _url =
      TextEditingController(text: backendPorDefecto);

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _conectar() async {
    final listo = await widget.sesion.conectar(_url.text);
    if (!listo || !mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PantallaEntidades(sesion: widget.sesion),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Asistente')),
      body: AnimatedBuilder(
        animation: widget.sesion,
        builder: (context, _) {
          final sesion = widget.sesion;
          return SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Conectar con un backend generado',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 10),
                const Text(
                  'La app no lleva dentro ningún proyecto: pregunta al servidor '
                  'qué sabe hacer y construye las pantallas con lo que le '
                  'conteste. Cualquier backend generado sirve.',
                  style: TextStyle(color: Color(0xFF8A93A6), height: 1.4),
                ),
                const SizedBox(height: 24),
                TextField(
                  controller: _url,
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: 'Dirección del servidor',
                    hintText: 'http://localhost:8080',
                    border: OutlineInputBorder(),
                  ),
                  onSubmitted: (_) => _conectar(),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: sesion.cargando ? null : _conectar,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(sesion.cargando ? 'Conectando…' : 'Conectar'),
                  ),
                ),
                if (sesion.error != null) ...[
                  const SizedBox(height: 20),
                  _Aviso(mensaje: sesion.error!),
                ],
                const SizedBox(height: 28),
                const _AyudaCable(),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Aviso extends StatelessWidget {
  const _Aviso({required this.mensaje});

  final String mensaje;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0x33FF5C5C),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0x66FF5C5C)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline, size: 20, color: Color(0xFFFF8A8A)),
          const SizedBox(width: 10),
          Expanded(child: SelectableText(mensaje, style: const TextStyle(height: 1.4))),
        ],
      ),
    );
  }
}

/// El fallo más probable en la defensa no es del código.
///
/// Se explica aquí, en la pantalla donde va a pasar, en vez de en un README que
/// nadie va a abrir con el proyector encendido.
class _AyudaCable extends StatelessWidget {
  const _AyudaCable();

  @override
  Widget build(BuildContext context) {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Si dice que no se puede conectar',
            style: TextStyle(fontWeight: FontWeight.bold)),
        SizedBox(height: 8),
        SelectableText(
          'Con «localhost» el teléfono se busca a sí mismo. Hace falta el túnel\n'
          'por cable, y hay que repetirlo cada vez que se desconecta:\n\n'
          '    adb reverse tcp:8080 tcp:8080\n\n'
          'Y que el backend esté arrancado en el portátil.',
          style: TextStyle(
            color: Color(0xFF8A93A6),
            fontFamily: 'monospace',
            fontSize: 12.5,
            height: 1.5,
          ),
        ),
      ],
    );
  }
}
