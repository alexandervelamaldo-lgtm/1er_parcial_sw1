import 'package:flutter/material.dart';

import 'manifiesto.dart';
import 'pantalla_asistente.dart';
import 'pantalla_lista.dart';
import 'sesion.dart';

/// Índice de lo que el backend sabe hacer.
///
/// Nada de esta pantalla está escrito para un dominio concreto: la lista son
/// las entidades del manifiesto, y el subtítulo de cada fila cuenta cuántos
/// campos tiene y si borrarla arrastra otras cosas. Contra el proyecto «tienda»
/// salen cinco filas; contra el de una barbería saldrán las suyas, con el mismo
/// código y sin recompilar.
class PantallaEntidades extends StatelessWidget {
  const PantallaEntidades({super.key, required this.sesion});

  final Sesion sesion;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: sesion,
      builder: (context, _) {
        final manifiesto = sesion.manifiesto;
        if (manifiesto == null) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        final visibles = manifiesto.entidades
            .where((e) => e.admite(Accion.listar))
            .toList(growable: false);

        return Scaffold(
          appBar: AppBar(
            title: Text(manifiesto.proyecto),
            actions: [
              IconButton(
                tooltip: 'Volver a leer el manifiesto',
                icon: const Icon(Icons.refresh),
                onPressed: () async {
                  final cambio = await sesion.refrescar();
                  if (!context.mounted) return;
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(cambio
                          ? 'El modelo cambió: pantallas actualizadas'
                          : 'El modelo sigue igual'),
                    ),
                  );
                },
              ),
            ],
          ),
          // El asistente va en un botón flotante y no escondido en un menú: es
          // la forma principal de usar la app, y la lista de entidades queda
          // como el camino manual para cuando lo dictado no se entienda.
          floatingActionButton: FloatingActionButton.extended(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => PantallaAsistente(sesion: sesion),
              ),
            ),
            icon: const Icon(Icons.auto_awesome),
            label: const Text('Pedir'),
          ),
          body: ListView.separated(
            // Hueco para que el botón flotante no tape la última entidad.
            padding: const EdgeInsets.only(bottom: 88),
            itemCount: visibles.length + 1,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (context, indice) {
              if (indice == 0) return _Cabecera(manifiesto: manifiesto);
              final entidad = visibles[indice - 1];
              return ListTile(
                title: Text(entidad.nombre),
                subtitle: Text(_resumen(entidad)),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => PantallaLista(sesion: sesion, entidad: entidad),
                  ),
                ),
              );
            },
          ),
        );
      },
    );
  }

  String _resumen(EntidadManifiesto entidad) {
    final partes = <String>[
      '${entidad.campos.length} campos',
      'se dice «${entidad.singular}»',
    ];
    if (entidad.borradoEnCascada.isNotEmpty) {
      partes.add('al borrar arrastra ${entidad.borradoEnCascada.join(', ')}');
    }
    return partes.join(' · ');
  }
}

class _Cabecera extends StatelessWidget {
  const _Cabecera({required this.manifiesto});

  final Manifiesto manifiesto;

  @override
  Widget build(BuildContext context) {
    final idempotencia = manifiesto.cabeceraIdempotencia;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${manifiesto.entidades.length} entidades leídas del manifiesto',
            style: const TextStyle(color: Color(0xFF8A93A6)),
          ),
          const SizedBox(height: 4),
          Text(
            idempotencia == null
                ? 'Este backend no admite reenvíos sin duplicar'
                : 'Reenvío seguro con $idempotencia',
            style: const TextStyle(color: Color(0xFF8A93A6), fontSize: 12.5),
          ),
        ],
      ),
    );
  }
}
