import { describe, expect, it } from 'vitest';
import type { FilaPanel, Rol } from '../services/api';
import { iniciales, resumirCuenta } from './menu-cuenta';

/**
 * El menú de cuenta, probado sin navegador.
 *
 * Lo que se comprueba es que no afirme nada que el sistema no sepa y que las
 * iniciales salgan bien también en los casos que rompen la versión ingenua:
 * nombre vacío, nombre con espacios de sobra, acentos y un correo que empieza
 * por un carácter fuera del plano básico.
 */

function fila(rol: Rol): FilaPanel {
  return {
    proyecto: {
      id: `p-${rol}-${String(Math.random())}`,
      name: 'Proyecto',
      description: '',
      ownerId: 'u1',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
      role: rol,
    },
    resumen: null,
  };
}

describe('el menú cuenta los roles que el sistema conoce de verdad', () => {
  it('separa los propios de las invitaciones', () => {
    const filas = [fila('owner'), fila('owner'), fila('editor'), fila('viewer'), fila('viewer')];
    expect(resumirCuenta(filas)).toEqual({ propios: 2, editor: 1, lector: 2 });
  });

  it('sin proyectos no cuenta nada', () => {
    expect(resumirCuenta([])).toEqual({ propios: 0, editor: 0, lector: 0 });
  });
});

describe('las iniciales se calculan aquí y no se piden a la red', () => {
  it('coge la primera letra de las dos primeras palabras', () => {
    expect(iniciales({ displayName: 'Alexander Rojas', email: 'a@x.com' })).toBe('AR');
  });

  /*
    Cuatro iniciales en un círculo de 32 píxeles no se leen. Se cortan en dos.
  */
  it('no pasa de dos letras aunque el nombre tenga cuatro palabras', () => {
    expect(iniciales({ displayName: 'María del Carmen Pérez', email: 'm@x.com' })).toBe('MD');
  });

  it('aguanta los espacios de más', () => {
    expect(iniciales({ displayName: '  ana   lucía  ', email: 'a@x.com' })).toBe('AL');
  });

  /*
    `displayName` puede venir vacío: el registro no lo exige. Entonces se tira
    del correo, y de la parte local, no del dominio: en una organización el
    dominio es el mismo para todos y la inicial saldría idéntica para todo el
    mundo.
  */
  it('sin nombre tira de la parte local del correo, no del dominio', () => {
    expect(iniciales({ displayName: '', email: 'ximena@empresa.com' })).toBe('X');
    expect(iniciales({ displayName: '   ', email: 'ximena@empresa.com' })).toBe('X');
  });

  /*
    Con `email[0]` un correo que empieza por un carácter fuera del plano básico
    devolvería media pareja subrogada, que se pinta como un rombo con
    interrogación. Se recorre por puntos de código.
  */
  it('no parte por la mitad un carácter fuera del plano básico', () => {
    const inicial = iniciales({ displayName: '', email: '𝒜lba@x.com' });
    expect([...inicial]).toHaveLength(1);
    expect(inicial).toBe('𝒜');
  });

  it('sin nombre y sin correo utilizable no se queda en blanco', () => {
    expect(iniciales({ displayName: '', email: '' })).toBe('?');
  });
});
