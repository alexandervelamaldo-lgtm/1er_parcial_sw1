import { describe, expect, it } from 'vitest';
import type { FicheroGenerado } from '../services/api';
import { capaDe, nombreDe, porCapas, porCarpetas, prefijoComun, tamaño } from './generacion';

/**
 * La previsualización del proyecto generado, probada sin navegador.
 *
 * Las rutas de los casos no son inventadas: son las que el generador escribe de
 * verdad, sacadas de `generator/src/render`. Si allí cambia una carpeta, aquí
 * hay que enterarse, y una prueba con rutas de mentira no se enteraría.
 */

function f(ruta: string, bytes = 100): FicheroGenerado {
  return { ruta, bytes, contenido: '' };
}

const RAIZ = 'src/main/java/com/ejemplo/tienda';

describe('cada fichero cae en la capa que le toca', () => {
  it('reconoce las cuatro capas y el DTO tal y como los escribe el generador', () => {
    expect(capaDe(`${RAIZ}/domain/Cliente.java`)).toBe('dominio');
    expect(capaDe(`${RAIZ}/repository/ClienteRepository.java`)).toBe('repositorio');
    expect(capaDe(`${RAIZ}/service/ClienteService.java`)).toBe('servicio');
    expect(capaDe(`${RAIZ}/service/impl/ClienteServiceImpl.java`)).toBe('servicio');
    expect(capaDe(`${RAIZ}/controller/ClienteController.java`)).toBe('controlador');
    expect(capaDe(`${RAIZ}/dto/ClienteRequest.java`)).toBe('dto');
    expect(capaDe(`${RAIZ}/dto/mapper/ClienteMapper.java`)).toBe('dto');
  });

  it('lo que no es de ninguna capa no se cuela en una', () => {
    expect(capaDe('pom.xml')).toBe('configuracion');
    expect(capaDe(`${RAIZ}/Application.java`)).toBe('configuracion');
    expect(capaDe('src/main/resources/db/migration/V1__esquema_inicial.sql')).toBe('configuracion');
    expect(capaDe(`${RAIZ}/exception/RecursoNoEncontrado.java`)).toBe('infraestructura');
    expect(capaDe(`${RAIZ}/infraestructura/FiltroIdempotencia.java`)).toBe('infraestructura');
  });

  /*
    El caso que obliga a mirar segmentos y no a hacer `includes` sobre la ruta.
    El paquete base lo escribe el usuario al crear el proyecto; si escribe
    `com.tienda.service`, todos sus ficheros contienen `/service/` y un
    `includes` diría que las cuarenta clases son de servicio.
  */
  it('un paquete base llamado «service» no convierte el proyecto entero en servicios', () => {
    const raiz = 'src/main/java/com/tienda/service';
    expect(capaDe(`${raiz}/domain/Cliente.java`)).toBe('dominio');
    expect(capaDe(`${raiz}/controller/ClienteController.java`)).toBe('controlador');
    expect(capaDe(`${raiz}/repository/ClienteRepository.java`)).toBe('repositorio');
  });

  /*
    Y el que obliga a recorrer desde el final: con `com.tienda.dto` de paquete
    base, buscando desde el principio el primer segmento reconocido sería `dto`
    y todo saldría como DTO.
  */
  it('gana la carpeta que contiene el fichero, no la primera que suene', () => {
    expect(capaDe('src/main/java/com/tienda/dto/domain/Cliente.java')).toBe('dominio');
  });
});

describe('el reparto por capas contesta si están las cuatro', () => {
  it('cuenta ficheros y bytes, y respeta el orden del flujo de una petición', () => {
    const recuentos = porCapas([
      f(`${RAIZ}/controller/ClienteController.java`, 800),
      f(`${RAIZ}/domain/Cliente.java`, 500),
      f(`${RAIZ}/domain/Pedido.java`, 300),
      f(`${RAIZ}/service/ClienteService.java`, 200),
    ]);
    expect(recuentos.map((r) => r.capa)).toEqual(['dominio', 'servicio', 'controlador']);
    expect(recuentos[0]).toEqual({ capa: 'dominio', ficheros: 2, bytes: 800 });
  });

  /*
    Una fila «Repositorio: 0» ocupa una línea para no informar de nada.
  */
  it('no enseña las capas vacías', () => {
    expect(porCapas([f('pom.xml')]).map((r) => r.capa)).toEqual(['configuracion']);
  });

  it('sin ficheros no devuelve filas', () => {
    expect(porCapas([])).toEqual([]);
  });
});

describe('el prefijo común se recorta por carpetas enteras', () => {
  it('quita lo que todas las rutas repiten', () => {
    expect(prefijoComun([`${RAIZ}/domain/Cliente.java`, `${RAIZ}/domain/Pedido.java`])).toBe(
      `${RAIZ}/domain/`,
    );
  });

  /*
    El caso que rompe recortar por caracteres. `com/a` y `com/ab` comparten la
    cadena «com/a», y cortar ahí dejaría la segunda ruta empezando por «b», que
    no es ninguna carpeta.
  */
  it('no parte un nombre de carpeta por la mitad', () => {
    expect(prefijoComun(['src/com/a/X.java', 'src/com/ab/Y.java'])).toBe('src/com/');
  });

  it('sin nada en común no recorta', () => {
    expect(prefijoComun(['pom.xml', 'src/main/java/App.java'])).toBe('');
  });

  /*
    Con un solo fichero no hay nada que comparar, y recortarle su propia carpeta
    dejaría la ruta reducida al nombre, perdiendo dónde va a parar.
  */
  it('con una sola ruta no recorta nada', () => {
    expect(prefijoComun([`${RAIZ}/domain/Cliente.java`])).toBe('');
  });

  it('no se come el nombre del fichero cuando dos rutas son iguales salvo el nombre', () => {
    const prefijo = prefijoComun([`${RAIZ}/domain/A.java`, `${RAIZ}/domain/B.java`]);
    expect(prefijo.endsWith('/')).toBe(true);
    expect(prefijo).toBe(`${RAIZ}/domain/`);
  });
});

describe('los ficheros se agrupan por carpeta y en orden estable', () => {
  it('ordena carpetas y ficheros alfabéticamente, no como lleguen', () => {
    const carpetas = porCarpetas([
      f(`${RAIZ}/service/ZService.java`),
      f(`${RAIZ}/domain/Pedido.java`),
      f(`${RAIZ}/domain/Cliente.java`),
      f(`${RAIZ}/service/AService.java`),
    ]);
    expect(carpetas.map((c) => c.carpeta)).toEqual(['domain', 'service']);
    expect(carpetas[0]?.ficheros.map((x) => nombreDe(x.ruta))).toEqual([
      'Cliente.java',
      'Pedido.java',
    ]);
    expect(carpetas[1]?.ficheros.map((x) => nombreDe(x.ruta))).toEqual([
      'AService.java',
      'ZService.java',
    ]);
  });

  it('un fichero en la raíz cae en el grupo sin nombre y no se pierde', () => {
    const carpetas = porCarpetas([f('pom.xml'), f(`${RAIZ}/domain/Cliente.java`)]);
    const total = carpetas.reduce((suma, c) => suma + c.ficheros.length, 0);
    expect(total).toBe(2);
    expect(carpetas.some((c) => c.ficheros.some((x) => x.ruta === 'pom.xml'))).toBe(true);
  });

  it('sin ficheros no hay carpetas', () => {
    expect(porCarpetas([])).toEqual([]);
  });
});

describe('el tamaño se escribe como lo escribe el sistema', () => {
  it('usa kB de mil, que es contra lo que se va a comparar el ZIP descargado', () => {
    expect(tamaño(0)).toBe('0 B');
    expect(tamaño(999)).toBe('999 B');
    expect(tamaño(1000)).toBe('1,0 kB');
    expect(tamaño(1400)).toBe('1,4 kB');
    expect(tamaño(1_500_000)).toBe('1,5 MB');
  });
});
