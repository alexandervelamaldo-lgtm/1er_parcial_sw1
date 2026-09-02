import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

/**
 * El secreto de sesión firma los tokens. Si cambia entre dos arranques, todos
 * los tokens emitidos antes dejan de valer —y el síntoma que ve el usuario no
 * es «vuelve a entrar» sino «Sin conexión», porque el navegador no le deja al
 * cliente WebSocket leer el 401 del apretón de manos rechazado—. De ahí que
 * merezca una prueba propia: es una línea de configuración cuyo fallo aparece
 * disfrazado de problema de red.
 */

const temporales: string[] = [];

function dirTemporal(): string {
  const dir = mkdtempSync(join(tmpdir(), 'config-'));
  temporales.push(dir);
  return dir;
}

afterEach(() => {
  while (temporales.length > 0) {
    const dir = temporales.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadConfig', () => {
  it('usa el secreto del entorno cuando está definido', () => {
    const config = loadConfig({ SESSION_SECRET: 'secreto-del-entorno', DATA_DIR: dirTemporal() });
    expect(config.sessionSecret).toBe('secreto-del-entorno');
    expect(config.sessionSecretIsGenerated).toBe(false);
  });

  it('mantiene el mismo secreto entre arranques cuando lo genera él', () => {
    const dataDir = dirTemporal();
    const primero = loadConfig({ DATA_DIR: dataDir });
    const segundo = loadConfig({ DATA_DIR: dataDir });

    expect(primero.sessionSecretIsGenerated).toBe(true);
    expect(primero.sessionSecret).toHaveLength(64);
    expect(segundo.sessionSecret).toBe(primero.sessionSecret);
  });

  it('guarda el secreto generado junto a los datos', () => {
    const dataDir = dirTemporal();
    const config = loadConfig({ DATA_DIR: dataDir });
    expect(readFileSync(join(dataDir, 'secreto-de-sesion'), 'utf8').trim()).toBe(
      config.sessionSecret,
    );
  });

  it('da secretos distintos a instalaciones distintas', () => {
    const uno = loadConfig({ DATA_DIR: dirTemporal() });
    const otro = loadConfig({ DATA_DIR: dirTemporal() });
    expect(uno.sessionSecret).not.toBe(otro.sessionSecret);
  });

  it('sigue avisando de que el secreto no viene del entorno', () => {
    // Persistirlo quita la molestia en desarrollo pero no lo hace correcto en
    // producción: con varias instancias, cada fichero rechaza los tokens de las
    // demás. El aviso de arranque depende de esta bandera.
    expect(loadConfig({ DATA_DIR: dirTemporal() }).sessionSecretIsGenerated).toBe(true);
  });
});
