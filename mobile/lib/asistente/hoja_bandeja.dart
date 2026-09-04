import 'package:flutter/material.dart';

import 'bandeja.dart';
import 'sesion.dart';

/// Lo que quedó sin enviar, a la vista y con un botón para reintentarlo.
///
/// Una bandeja de salida invisible es indistinguible de haber perdido la orden:
/// el usuario dijo «apunta la cita», la app contestó «vale» y luego no pasó
/// nada. Esta hoja es el sitio donde se puede comprobar que sigue ahí, por qué
/// no ha salido todavía, y —lo que más importa el día de la defensa— forzar el
/// envío sin esperar a que la app decida reconectar por su cuenta.
Future<void> mostrarBandeja(BuildContext context, Sesion sesion) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _HojaBandeja(sesion: sesion),
  );
}

class _HojaBandeja extends StatefulWidget {
  const _HojaBandeja({required this.sesion});

  final Sesion sesion;

  @override
  State<_HojaBandeja> createState() => _HojaBandejaState();
}

class _HojaBandejaState extends State<_HojaBandeja> {
  bool _enviando = false;

  Future<void> _enviar() async {
    setState(() => _enviando = true);
    final resultado = await widget.sesion.sincronizar();
    if (!mounted) return;
    setState(() => _enviando = false);

    final mensaje = switch (resultado) {
      // `null` es «no se pudo ni intentar», que no es lo mismo que «no había
      // nada»: uno se arregla conectando y el otro no necesita arreglo.
      null => 'No hay conexión con ningún backend todavía.',
      final r when r.corteDeRed != null =>
        'Se enviaron ${r.enviadas}. El resto sigue esperando: ${r.corteDeRed}',
      final r when !r.huboAlgo => 'Nada que enviar.',
      final r => 'Enviadas ${r.enviadas}.'
          '${r.rechazadas > 0 ? ' ${r.rechazadas} rechazadas por el servidor.' : ''}',
    };
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(mensaje)));
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    return ListenableBuilder(
      listenable: widget.sesion.bandeja,
      builder: (context, _) {
        final bandeja = widget.sesion.bandeja;
        final ordenes = bandeja.ordenes;

        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Pendiente de enviar', style: tema.textTheme.titleLarge),
                const SizedBox(height: 6),
                Text(
                  'Cada orden guarda la clave con la que se intentó la primera '
                  'vez, así que reenviarla no puede duplicar nada.',
                  style: tema.textTheme.bodySmall,
                ),
                if (bandeja.errorAlCargar != null) ...[
                  const SizedBox(height: 12),
                  Text(bandeja.errorAlCargar!,
                      style: TextStyle(color: tema.colorScheme.error)),
                ],
                const SizedBox(height: 16),
                Flexible(
                  child: ordenes.isEmpty
                      ? const Padding(
                          padding: EdgeInsets.symmetric(vertical: 24),
                          child: Text('No queda nada por enviar.'),
                        )
                      : ListView.separated(
                          shrinkWrap: true,
                          itemCount: ordenes.length,
                          separatorBuilder: (_, _) => const Divider(height: 1),
                          itemBuilder: (context, i) => _Fila(
                            orden: ordenes[i],
                            alDescartar: () => bandeja.descartar(ordenes[i]),
                          ),
                        ),
                ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed:
                      _enviando || bandeja.esperando.isEmpty ? null : _enviar,
                  icon: _enviando
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.cloud_upload_outlined),
                  label: Text(_enviando ? 'Enviando…' : 'Enviar ahora'),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _Fila extends StatelessWidget {
  const _Fila({required this.orden, required this.alDescartar});

  final OrdenPendiente orden;
  final VoidCallback alDescartar;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final rechazada = orden.rechazada;

    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(
        rechazada ? Icons.error_outline : Icons.schedule,
        color: rechazada ? tema.colorScheme.error : null,
      ),
      title: Text(orden.resumen),
      subtitle: Text(
        [
          if (orden.ultimoError != null) orden.ultimoError!,
          if (orden.intentos > 0)
            '${orden.intentos} ${orden.intentos == 1 ? 'intento' : 'intentos'}',
        ].join(' · '),
        style: TextStyle(color: rechazada ? tema.colorScheme.error : null),
      ),
      isThreeLine: orden.ultimoError != null,
      // Solo lo rechazado se puede quitar a mano. Lo que sigue esperando se va
      // solo en cuanto haya red, y un botón de borrar al lado invitaría a
      // deshacerse de una orden que todavía va a cumplirse.
      trailing: rechazada
          ? IconButton(
              tooltip: 'Descartar',
              onPressed: alDescartar,
              icon: const Icon(Icons.close),
            )
          : null,
    );
  }
}
