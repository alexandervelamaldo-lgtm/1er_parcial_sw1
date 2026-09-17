import { describe, expect, it } from 'vitest';
import {
  CANAL_SESION,
  ESPERA_SESION_NATIVA_MS,
  RECEPTOR_SESION,
  leerMensajeDeSesion,
  origenDelToken,
} from './sesion-nativa';

/**
 * Lo que se comprueba aquí es una sola promesa: **dentro de la app, el token no
 * se escribe en el WebView**. Todo lo demás son las formas de romperla sin que
 * se note, que es lo que hace falta vigilar, porque ninguna de ellas da un
 * error: dan una aplicación que funciona perfectamente con el token otra vez en
 * claro en el disco.
 */

describe('de dónde sale el token al arrancar', () => {
  it('con puente manda el lado nativo', () => {
    expect(origenDelToken({ hayPuente: true, tokenGuardado: null })).toBe('nativo');
  });

  it('sin puente y con algo guardado, el navegador de siempre', () => {
    expect(origenDelToken({ hayPuente: false, tokenGuardado: 'abc' })).toBe('navegador');
  });

  it('sin puente y sin nada, a la pantalla de acceso', () => {
    expect(origenDelToken({ hayPuente: false, tokenGuardado: null })).toBe('ninguno');
  });

  it('con puente se ignora lo que hubiera en localStorage', () => {
    /*
      La prueba que sostiene todo el diseño. Lo que puede haber ahí es el resto
      de una versión anterior del APK, la que guardaba el token dentro del
      WebView. Usarlo «por si acaso» resucitaría en silencio el almacenamiento
      del que se está huyendo, y nadie lo notaría: la app entraría igual de
      bien, solo que con la llave otra vez en un fichero de texto.
    */
    expect(origenDelToken({ hayPuente: true, tokenGuardado: 'resto-de-otra-version' })).toBe(
      'nativo',
    );
  });

  it('la cadena vacía cuenta como no tener nada', () => {
    // `localStorage.getItem` no devuelve cadena vacía por su cuenta, pero sí la
    // devuelve si alguna vez se guardó una. Tratarla como token daría una
    // cabecera `Authorization: Bearer ` y un 401 en cada petición.
    expect(origenDelToken({ hayPuente: false, tokenGuardado: '' })).toBe('ninguno');
  });
});

describe('lo que contesta el lado nativo', () => {
  const mensaje = (cuerpo: unknown): string => JSON.stringify(cuerpo);

  it('una sesión completa se entiende entera', () => {
    const leido = leerMensajeDeSesion(
      mensaje({
        tipo: 'sesion',
        token: 't0ken',
        usuario: { id: 'u1', email: 'a@b.c', nombre: 'Ana' },
      }),
    );
    expect(leido).toEqual({
      token: 't0ken',
      usuario: { id: 'u1', email: 'a@b.c', nombre: 'Ana' },
    });
  });

  it('no tener sesión guardada se dice, no se calla', () => {
    // Es la respuesta legítima de una carcasa que todavía no ha guardado nada.
    // Tiene que llegar a la página para que deje de esperar y enseñe el acceso.
    expect(leerMensajeDeSesion(mensaje({ tipo: 'sesion', token: null }))).toEqual({
      token: null,
      usuario: null,
    });
  });

  it('«sin sesión» y «mensaje roto» no son lo mismo', () => {
    /*
      La distinción no es cosmética. `null` significa «esto no era para
      nosotros» y no debe cambiar nada; `{token: null}` significa «hay que
      entrar». Confundirlos mandaría a la pantalla de acceso por un mensaje
      ajeno que pasara por el mismo receptor.
    */
    expect(leerMensajeDeSesion('{no es json')).toBeNull();
    expect(leerMensajeDeSesion(mensaje({ tipo: 'respaldo', datos: 'x' }))).toBeNull();
    expect(leerMensajeDeSesion(mensaje(['sesion']))).toBeNull();
    expect(leerMensajeDeSesion(mensaje(null))).toBeNull();
  });

  it('un token que no es texto se rechaza en vez de usarse', () => {
    // Un número pasaría a la cabecera como `Bearer 42` y daría 401 en cada
    // petición sin que nada dijera que el mensaje venía mal.
    expect(leerMensajeDeSesion(mensaje({ tipo: 'sesion', token: 42 }))).toBeNull();
  });

  it('un token vacío es no tener sesión', () => {
    expect(leerMensajeDeSesion(mensaje({ tipo: 'sesion', token: '' }))).toEqual({
      token: null,
      usuario: null,
    });
  });

  it('un perfil incompleto no tira la sesión', () => {
    /*
      Un token sin perfil legible sigue siendo un token bueno: la página puede
      preguntar `GET /api/auth/yo`. Rechazar la sesión entera por no saber cómo
      se llama quien ya está dentro sería pedir la contraseña por un nombre.
    */
    const leido = leerMensajeDeSesion(mensaje({ tipo: 'sesion', token: 't', usuario: { id: 'u1' } }));
    expect(leido?.token).toBe('t');
    expect(leido?.usuario).toEqual({ id: 'u1', email: '', nombre: '' });
  });

  it('sin perfil ninguno, la sesión vale igual', () => {
    const leido = leerMensajeDeSesion(mensaje({ tipo: 'sesion', token: 't' }));
    expect(leido).toEqual({ token: 't', usuario: null });
  });

  it('un perfil sin identificador no se inventa', () => {
    // Sin `id` no hay a quién atribuir nada, y un usuario a medias en el estado
    // es peor que ninguno: la interfaz lo pintaría como si se supiera quién es.
    const leido = leerMensajeDeSesion(
      mensaje({ tipo: 'sesion', token: 't', usuario: { email: 'a@b.c' } }),
    );
    expect(leido?.usuario).toBeNull();
  });
});

describe('el contrato con el lado de Flutter', () => {
  it('los nombres son los que espera el APK', () => {
    // Las mismas dos cadenas están en `mobile/lib/sesion_nativa.dart`, donde
    // también se afirman. No hay compilador que una las dos mitades: cambiar
    // una sin la otra deja la app pidiendo la contraseña dos veces, en Flutter
    // y otra vez dentro del WebView, sin ningún error por medio.
    expect(CANAL_SESION).toBe('SesionNativa');
    expect(RECEPTOR_SESION).toBe('__sesionNativa');
  });

  it('la espera es finita', () => {
    /*
      Lo que se protege es el arranque. El canal no garantiza respuesta —si el
      APK es más viejo que esta página no conoce el tipo «pedir»— y no hay
      ningún error que avise. Sin tope, la app se queda parada en la pantalla
      de carga para siempre, sin poder entrar ni llegar a lo que ya tenía
      guardado.
    */
    expect(ESPERA_SESION_NATIVA_MS).toBeGreaterThan(0);
    expect(ESPERA_SESION_NATIVA_MS).toBeLessThanOrEqual(10_000);
  });
});
