import type { ClassDiagram } from '@app/shared';

/**
 * Capa anticorrupción hacia Architech Enterprise (decisión D8, §2.9).
 *
 * El contrato real no se conoce todavía (preguntas abiertas Q1–Q4: qué
 * autenticación usa, qué formato de diagrama acepta, si la publicación es
 * síncrona y cómo identifica los proyectos). Esta capa existe precisamente por
 * eso: concentra en un único fichero todo lo que habrá que reescribir cuando se
 * conozca, en lugar de repartir suposiciones por las rutas.
 *
 * Por el mismo motivo la implementación por defecto no habla con nada y lo dice.
 * Un cliente que fingiera funcionar —devolviendo un identificador falso, por
 * ejemplo— haría que la integración pareciese terminada y que el fallo
 * apareciese en producción y no aquí.
 */

export interface ArchitechProject {
  externalId: string;
  name: string;
  url?: string;
}

export interface ArchitechClient {
  readonly configured: boolean;
  /** Publica el diagrama en Architech. */
  publish(diagram: ClassDiagram, projectId: string): Promise<ArchitechProject>;
  /** Importa un diagrama existente de Architech al modelo canónico. */
  import(externalId: string): Promise<ClassDiagram>;
}

export class ArchitechNotConfiguredError extends Error {
  readonly status = 501;
  readonly code = 'ARCHITECH_NO_CONFIGURADO';

  constructor() {
    super(
      'La integración con Architech Enterprise no está configurada. ' +
        'Falta ARCHITECH_BASE_URL y ARCHITECH_API_KEY, y el contrato de su API ' +
        'sigue pendiente de confirmar (Q1–Q4).',
    );
  }
}

/** Implementación por defecto: rechaza toda operación explicando por qué. */
export class UnconfiguredArchitechClient implements ArchitechClient {
  readonly configured = false;

  async publish(): Promise<ArchitechProject> {
    throw new ArchitechNotConfiguredError();
  }

  async import(): Promise<ClassDiagram> {
    throw new ArchitechNotConfiguredError();
  }
}

export function createArchitechClient(config: {
  architechBaseUrl?: string;
  architechApiKey?: string;
}): ArchitechClient {
  if (!config.architechBaseUrl || !config.architechApiKey) {
    return new UnconfiguredArchitechClient();
  }
  // Cuando se conozca el contrato, la implementación real se construye aquí y
  // el resto del servicio no cambia: solo depende de `ArchitechClient`.
  return new UnconfiguredArchitechClient();
}
