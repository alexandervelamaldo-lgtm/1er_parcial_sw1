import 'package:flutter/material.dart';

import 'acceso_rest.dart';
import 'almacen_sesion.dart';
import 'huella.dart';
import 'token.dart';

/// La pantalla de acceso, nativa.
///
/// Es la única pantalla de esta app que pide una contraseña, y por eso está
/// aquí y no dentro del WebView: lo que se escribe en un formulario de la
/// página lo puede leer cualquier JavaScript que corra en ella, y el token que
/// sale del formulario acabaría en el `localStorage`. Escrito en Flutter, el
/// campo es un `TextField` del sistema y el token no llega a existir dentro del
/// navegador más que en memoria.
///
/// Devuelve la sesión por `Navigator.pop`, ya guardada en el almacén cifrado.
/// Guardarla aquí y no en quien llama evita el estado a medias: no hay ningún
/// momento en el que haya sesión en memoria y no en el disco.
class PantallaAcceso extends StatefulWidget {
  const PantallaAcceso({
    super.key,
    required this.servicio,
    required this.almacen,
    required this.desbloqueo,
    this.ultimoCorreo = '',
    this.aviso,
  });

  final ServicioAcceso servicio;
  final AlmacenSesion almacen;
  final Desbloqueo desbloqueo;

  /// El correo de la última sesión, para no volver a escribirlo.
  ///
  /// Solo el correo. La contraseña no se recuerda ni se ofrece recordar: para
  /// eso está la sesión guardada, que es lo que esta pantalla evita tener que
  /// repetir.
  final String ultimoCorreo;

  /// Por qué se ha llegado aquí, si no fue a propósito.
  ///
  /// Lo pone quien navega: «la sesión ha caducado», «la huella ya no está
  /// disponible». Sin esto, volver a la pantalla de acceso sin haber pulsado
  /// «salir» parece un fallo de la aplicación.
  final String? aviso;

  @override
  State<PantallaAcceso> createState() => _PantallaAccesoState();
}

class _PantallaAccesoState extends State<PantallaAcceso> {
  late final TextEditingController _correo = TextEditingController(
    text: widget.ultimoCorreo,
  );
  final TextEditingController _clave = TextEditingController();
  final FocusNode _focoClave = FocusNode();

  bool _entrando = false;
  bool _verClave = false;
  bool _exigirHuella = false;
  bool _hayHuella = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _mirarHuella();
  }

  @override
  void dispose() {
    _correo.dispose();
    _clave.dispose();
    _focoClave.dispose();
    super.dispose();
  }

  /// Se pregunta al aparato antes de ofrecer la casilla.
  ///
  /// Ofrecer «pedir la huella al abrir» en un teléfono que no puede pedirla
  /// sería prometer algo que en el arranque siguiente se traduce en una
  /// contraseña inesperada, por la regla de `pasoDeArranque`. Mejor no
  /// enseñarla.
  Future<void> _mirarHuella() async {
    final puede = await widget.desbloqueo.disponible();
    final yaLoPidio = await widget.almacen.exigeHuella();
    if (!mounted) return;
    setState(() {
      _hayHuella = puede;
      _exigirHuella = puede && yaLoPidio;
    });
  }

  Future<void> _entrar() async {
    if (_entrando) return;
    setState(() {
      _entrando = true;
      _error = null;
    });

    final resultado = await widget.servicio.entrar(_correo.text, _clave.text);

    if (resultado is AccesoRechazado) {
      if (!mounted) return;
      setState(() {
        _entrando = false;
        _error = resultado.motivo;
      });
      return;
    }

    final sesion = (resultado as AccesoLogrado).sesion;
    await widget.almacen.guardar(sesion);
    await widget.almacen.anotarExigeHuella(_exigirHuella && _hayHuella);
    /*
      La contraseña se borra de la memoria en cuanto deja de hacer falta. No es
      teatro: el controlador vive mientras viva el widget, y el widget puede
      quedarse detrás en la pila de navegación mientras se usa el editor. Un
      `String` en Dart no se puede sobreescribir de verdad —es inmutable y lo
      recoge el recolector cuando quiere—, así que esto no borra nada del
      montón; lo que hace es quitar la única referencia viva, que es lo máximo
      que se puede hacer desde aquí y cuesta una línea.
    */
    _clave.clear();

    if (!mounted) return;
    Navigator.of(context).pop(sesion);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Entrar')),
      /*
        El formulario va dentro de un `SingleChildScrollView` y no en una
        columna suelta, y es la línea que evita el fallo clásico del móvil: al
        enfocar la contraseña, el teclado ocupa media pantalla y el campo queda
        debajo. Con `resizeToAvoidBottomInset` —que es el valor por omisión del
        `Scaffold`— el cuerpo se encoge hasta el borde del teclado, y con el
        desplazamiento Flutter arrastra solo el campo enfocado hasta dejarlo a
        la vista.
      */
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'La sesión se guarda cifrada en este teléfono, no dentro de la '
                'página.',
                style: TextStyle(color: Color(0xFF8A93A6), height: 1.4),
              ),
              if (widget.aviso != null) ...[
                const SizedBox(height: 16),
                _Aviso(texto: widget.aviso!),
              ],
              const SizedBox(height: 24),
              TextField(
                controller: _correo,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                autocorrect: false,
                // Sin esto, el teclado de Android pone mayúscula inicial y el
                // correo se escribe mal en cada intento.
                textCapitalization: TextCapitalization.none,
                onSubmitted: (_) => _focoClave.requestFocus(),
                decoration: const InputDecoration(
                  labelText: 'Correo',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _clave,
                focusNode: _focoClave,
                obscureText: !_verClave,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _entrar(),
                decoration: InputDecoration(
                  labelText: 'Contraseña',
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    // Con el texto oculto no hay forma de ver qué se ha
                    // escrito, y en un teclado táctil eso son intentos
                    // fallidos que parecen contraseñas equivocadas.
                    icon: Icon(
                      _verClave ? Icons.visibility_off : Icons.visibility,
                    ),
                    tooltip: _verClave
                        ? 'Ocultar la contraseña'
                        : 'Mostrar la contraseña',
                    onPressed: () => setState(() => _verClave = !_verClave),
                  ),
                ),
              ),
              if (_hayHuella) ...[
                const SizedBox(height: 8),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: _exigirHuella,
                  onChanged: (valor) => setState(() => _exigirHuella = valor),
                  title: const Text('Pedir la huella al abrir'),
                  subtitle: const Text(
                    'Protege la sesión guardada si alguien coge el teléfono ya '
                    'desbloqueado.',
                  ),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 16),
                _Aviso(texto: _error!, grave: true),
              ],
              const SizedBox(height: 24),
              SizedBox(
                // El mínimo táctil de 48 dp, que aquí es el botón que más se
                // pulsa de toda la aplicación.
                height: 52,
                child: FilledButton(
                  onPressed: _entrando ? null : _entrar,
                  child: _entrando
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Entrar'),
                ),
              ),
              const SizedBox(height: 20),
              const Text(
                'Para registrarse o recuperar la cuenta con el código, entre '
                'desde el navegador: son operaciones de una sola vez y la '
                'página ya las tiene resueltas.',
                style: TextStyle(
                  color: Color(0xFF8A93A6),
                  fontSize: 12,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Aviso extends StatelessWidget {
  const _Aviso({required this.texto, this.grave = false});

  final String texto;
  final bool grave;

  @override
  Widget build(BuildContext context) {
    final color = grave ? const Color(0xFFFF6B6B) : const Color(0xFFFFC85C);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Text(texto, style: TextStyle(color: color, height: 1.4)),
    );
  }
}
