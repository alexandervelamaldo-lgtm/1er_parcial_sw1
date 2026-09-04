import { describe, expect, it } from 'vitest';
import {
  LocalIdentityProvider,
  SesionFirmada,
  generarCodigoRecuperacion,
  marcaDeCredencial,
  normalizarCodigo,
  type UserProfile,
} from './identity.js';

/**
 * Las piezas sueltas de la identidad.
 *
 * El recorrido completo de recuperar una contraseña se prueba en `api.test.ts`
 * contra la aplicación entera, que es donde se ve si las rutas están conectadas.
 * Aquí se prueba lo que allí no se puede mirar de cerca: la forma del código, y
 * sobre todo la firma del token, cuyo comportamiento —que un token deje de valer
 * cuando cambia la contraseña— es el mecanismo de revocación entero.
 */

const ANA: UserProfile = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'ana@ejemplo.com',
  displayName: 'Ana',
};

describe('generarCodigoRecuperacion', () => {
  it('sale en grupos legibles', () => {
    expect(generarCodigoRecuperacion()).toMatch(/^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/);
  });

  it('no usa los caracteres que se confunden al copiar', () => {
    // La I y el 1, la O y el 0, la L: quien transcribe el código desde una
    // captura de pantalla se equivoca justo ahí. Se comprueba sobre bastantes
    // códigos porque uno solo podría no contener el carácter malo por azar.
    const muchos = Array.from({ length: 200 }, generarCodigoRecuperacion).join('');
    expect(muchos).not.toMatch(/[ILOU01]/);
  });

  it('no repite', () => {
    // No demuestra que sea aleatorio —eso no lo demuestra ninguna prueba—, pero
    // sí que no hay un contador ni una semilla fija, que es el fallo que
    // convertiría el código de otro en adivinable.
    const codigos = new Set(Array.from({ length: 500 }, generarCodigoRecuperacion));
    expect(codigos.size).toBe(500);
  });

  it('usa el alfabeto entero', () => {
    // Si el muestreo estuviera mal —por ejemplo tomando solo los bits bajos de
    // cada byte— faltarían símbolos del final del alfabeto y el código tendría
    // mucha menos entropía de la que aparenta.
    const muchos = Array.from({ length: 400 }, generarCodigoRecuperacion).join('');
    for (const simbolo of '23456789ABCDEFGHJKMNPQRSTVWXYZ') {
      expect(muchos).toContain(simbolo);
    }
  });
});

describe('normalizarCodigo', () => {
  it('quita los guiones con los que se enseña', () => {
    expect(normalizarCodigo('ABCDE-FGHJK')).toBe('ABCDEFGHJK');
  });

  it('perdona las minúsculas y los espacios de pegar desde otro sitio', () => {
    expect(normalizarCodigo('  abcde fghjk \n')).toBe('ABCDEFGHJK');
  });

  it('deja fuera lo que no puede formar parte de un código', () => {
    // La O y el 0 no están en el alfabeto, así que si aparecen es que alguien se
    // equivocó. Se descartan igual que los guiones en vez de rechazar el código
    // entero: el resultado será un código que no cuadra, y el mensaje de «no es
    // correcto» es más útil que uno sobre caracteres inválidos.
    expect(normalizarCodigo('AB0OI-LU!CD')).toBe('ABCD');
  });
});

describe('SesionFirmada', () => {
  const sesiones = new SesionFirmada('secreto-de-prueba', 3600);
  const siempre = (marca: string) => async () => marca;

  it('lee el token que ella misma emitió', async () => {
    const { token } = sesiones.emitir(ANA, 'marca-de-ana');
    expect(await sesiones.leer(token, siempre('marca-de-ana'))).toBe(ANA.id);
  });

  it('el token deja de valer si cambia la marca de la credencial', async () => {
    // Esto *es* la revocación. La marca sale del hash de la contraseña, así que
    // cambiarla —al recuperar la cuenta— mata todos los tokens emitidos antes,
    // sin lista negra ni tabla de sesiones.
    const { token } = sesiones.emitir(ANA, 'marca-vieja');
    expect(await sesiones.leer(token, siempre('marca-nueva'))).toBeNull();
  });

  it('rechaza el token de un usuario que ya no está', async () => {
    const { token } = sesiones.emitir(ANA, 'marca-de-ana');
    expect(await sesiones.leer(token, async () => null)).toBeNull();
  });

  it('rechaza un token caducado sin llegar a preguntar por el usuario', async () => {
    const caducadas = new SesionFirmada('secreto-de-prueba', -1);
    const { token } = caducadas.emitir(ANA, 'marca-de-ana');

    let consultas = 0;
    const resultado = await caducadas.leer(token, async () => {
      consultas += 1;
      return 'marca-de-ana';
    });

    expect(resultado).toBeNull();
    // La caducidad se mira antes de ir al almacén: si no, cualquiera podría
    // provocar consultas a la base mandando tokens vencidos a puñados.
    expect(consultas).toBe(0);
  });

  it('rechaza la firma hecha con otro secreto', async () => {
    const otras = new SesionFirmada('otro-secreto', 3600);
    const { token } = otras.emitir(ANA, 'marca-de-ana');
    expect(await sesiones.leer(token, siempre('marca-de-ana'))).toBeNull();
  });

  it('rechaza lo que ni siquiera tiene forma de token', async () => {
    for (const basura of ['', 'nada', 'a.b', 'a.b.c.d']) {
      expect(await sesiones.leer(basura, siempre('marca-de-ana'))).toBeNull();
    }
  });

  it('rechaza una caducidad que no es un número', async () => {
    // `parseInt` sobre «9999999999x» devuelve un número enorme y muy válido. Sin
    // la comprobación de que son solo dígitos, ese token pasaría el filtro de la
    // caducidad; la firma lo pararía después, pero depender de una sola barrera
    // para algo así es lo que se quiere evitar.
    expect(await sesiones.leer(`${ANA.id}.9999999999x.firma`, siempre('m'))).toBeNull();
  });
});

describe('marcaDeCredencial', () => {
  it('cambia cuando cambia el hash de la contraseña', () => {
    const base = { ...ANA, salt: 'sal', hash: 'a'.repeat(128) };
    expect(marcaDeCredencial(base)).not.toBe(marcaDeCredencial({ ...base, hash: 'b'.repeat(128) }));
  });

  it('no entrega el hash entero', () => {
    // La marca no viaja en el token —solo entra en el HMAC—, pero acortarla es
    // una segunda red por si algún día alguien la registra o la devuelve.
    const hash = 'a'.repeat(128);
    expect(marcaDeCredencial({ ...ANA, salt: 'sal', hash }).length).toBeLessThan(hash.length);
  });
});

describe('LocalIdentityProvider en memoria', () => {
  const abrir = (): LocalIdentityProvider => new LocalIdentityProvider('secreto-de-prueba', 3600);

  it('el código emitido sirve una vez y deja la sesión iniciada', async () => {
    const identidad = abrir();
    const ana = await identidad.register('ana@ejemplo.com', 'contraseña-larga', 'Ana');
    const codigo = await identidad.emitirCodigoRecuperacion(ana.id);

    const sesion = await identidad.restablecerConCodigo('ana@ejemplo.com', codigo, 'otra-muy-larga');
    expect(sesion?.user.id).toBe(ana.id);
    expect(await identidad.verify(sesion!.token)).not.toBeNull();
  });

  it('sin código emitido no hay recuperación posible', async () => {
    // Es el estado de las cuentas creadas antes de que esto existiera. Tiene que
    // fallar limpio y no reventar por leer un hash que no está.
    const identidad = abrir();
    await identidad.register('ana@ejemplo.com', 'contraseña-larga', 'Ana');

    const codigoInventado = generarCodigoRecuperacion();
    expect(
      await identidad.restablecerConCodigo('ana@ejemplo.com', codigoInventado, 'otra-muy-larga'),
    ).toBeNull();
  });

  it('no se puede emitir un código para un usuario que no existe', async () => {
    await expect(abrir().emitirCodigoRecuperacion('no-soy-nadie')).rejects.toThrow();
  });
});
