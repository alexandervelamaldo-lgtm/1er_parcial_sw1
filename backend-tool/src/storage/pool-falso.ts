import type { ClientePostgres, PoolPostgres, ResultadoConsulta } from './postgres.js';

/**
 * Un pool de PostgreSQL que no habla con PostgreSQL.
 *
 * Existe solo para las pruebas, y vive fuera de un fichero `.test.ts` porque lo
 * usan dos: la de los almacenes y la de la migración. No entra en el paquete de
 * producción —nada de `src/` lo importa— pero tampoco estorba ahí.
 *
 * Lo que permite comprobar sin servidor no es que el SQL sea correcto, sino que
 * el código que lo rodea se porta bien: que los valores viajan como parámetros y
 * no concatenados, que las conexiones se devuelven, y que el orden de las
 * sentencias es el que debe ser.
 */

export interface Llamada {
  texto: string;
  valores: unknown[];
}

class ClienteFalso implements ClientePostgres {
  constructor(private readonly pool: PoolFalso) {}

  async query<F = Record<string, unknown>>(
    texto: string,
    valores: unknown[] = [],
  ): Promise<ResultadoConsulta<F>> {
    return this.pool.query<F>(texto, valores);
  }

  release(): void {
    this.pool.prestadas -= 1;
  }
}

export class PoolFalso implements PoolPostgres {
  readonly llamadas: Llamada[] = [];
  /** Conexiones pedidas y aún no devueltas. Debe volver a cero siempre. */
  prestadas = 0;
  cerrado = false;

  constructor(
    private readonly responder: (texto: string, valores: unknown[]) => unknown[] = () => [],
  ) {}

  async query<F = Record<string, unknown>>(
    texto: string,
    valores: unknown[] = [],
  ): Promise<ResultadoConsulta<F>> {
    this.llamadas.push({ texto, valores });
    const rows = this.responder(texto, valores) as F[];
    return { rows, rowCount: rows.length };
  }

  async connect(): Promise<ClientePostgres> {
    this.prestadas += 1;
    return new ClienteFalso(this);
  }

  async end(): Promise<void> {
    this.cerrado = true;
  }

  /** Los verbos SQL en el orden en que se ejecutaron. */
  get verbos(): string[] {
    return this.llamadas.map((l) => l.texto.trim().split(/\s+/)[0]?.toLowerCase() ?? '');
  }

  /** Todo el texto enviado, para comprobar que un valor NO aparece ahí. */
  get textoCompleto(): string {
    return this.llamadas.map((l) => l.texto).join('\n');
  }

  get valoresEnviados(): unknown[] {
    return this.llamadas.flatMap((l) => l.valores);
  }
}
