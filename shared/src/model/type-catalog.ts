/**
 * Catálogo de tipos soportados y su correspondencia con Java y PostgreSQL.
 *
 * Un tipo que no esté aquí y que no sea una clase del diagrama produce un error
 * bloqueante de validación (RF-GEN-11): generar código con un tipo desconocido
 * da un proyecto que no compila, y ese fallo es mucho más caro de diagnosticar
 * en Maven que aquí.
 */

export interface TypeMapping {
  /** Nombre canónico en el diagrama. */
  uml: string;
  javaType: string;
  /** Import necesario, si el tipo no está en `java.lang`. */
  javaImport?: string;
  postgresType: string;
  /** Anotaciones Bean Validation aplicables por defecto. */
  validation?: string[];
  /** Literal Java para el valor por defecto, si el atributo no define uno. */
  defaultLiteral?: string;
}

const MAPPINGS: TypeMapping[] = [
  { uml: 'String', javaType: 'String', postgresType: 'VARCHAR(255)' },
  { uml: 'Text', javaType: 'String', postgresType: 'TEXT' },
  { uml: 'UUID', javaType: 'UUID', javaImport: 'java.util.UUID', postgresType: 'UUID' },

  { uml: 'Integer', javaType: 'Integer', postgresType: 'INTEGER' },
  { uml: 'Int', javaType: 'Integer', postgresType: 'INTEGER' },
  { uml: 'Long', javaType: 'Long', postgresType: 'BIGINT' },
  { uml: 'Short', javaType: 'Short', postgresType: 'SMALLINT' },

  { uml: 'Double', javaType: 'Double', postgresType: 'DOUBLE PRECISION' },
  { uml: 'Float', javaType: 'Float', postgresType: 'REAL' },
  {
    uml: 'Decimal',
    javaType: 'BigDecimal',
    javaImport: 'java.math.BigDecimal',
    postgresType: 'NUMERIC(19,2)',
  },
  {
    uml: 'BigDecimal',
    javaType: 'BigDecimal',
    javaImport: 'java.math.BigDecimal',
    postgresType: 'NUMERIC(19,2)',
  },

  { uml: 'Boolean', javaType: 'Boolean', postgresType: 'BOOLEAN' },

  {
    uml: 'Date',
    javaType: 'LocalDate',
    javaImport: 'java.time.LocalDate',
    postgresType: 'DATE',
  },
  {
    uml: 'DateTime',
    javaType: 'LocalDateTime',
    javaImport: 'java.time.LocalDateTime',
    postgresType: 'TIMESTAMP',
  },
  {
    uml: 'Instant',
    javaType: 'Instant',
    javaImport: 'java.time.Instant',
    postgresType: 'TIMESTAMP WITH TIME ZONE',
  },
  {
    uml: 'Time',
    javaType: 'LocalTime',
    javaImport: 'java.time.LocalTime',
    postgresType: 'TIME',
  },

  { uml: 'Byte[]', javaType: 'byte[]', postgresType: 'BYTEA' },
];

const BY_NAME = new Map<string, TypeMapping>();
for (const mapping of MAPPINGS) {
  BY_NAME.set(mapping.uml.toLowerCase(), mapping);
}

/** Alias frecuentes que el asistente de IA o el OCR pueden producir. */
const ALIASES: Record<string, string> = {
  int: 'Integer',
  integer: 'Integer',
  number: 'Double',
  numeric: 'Decimal',
  decimal: 'Decimal',
  bigdecimal: 'Decimal',
  str: 'String',
  string: 'String',
  varchar: 'String',
  char: 'String',
  text: 'Text',
  bool: 'Boolean',
  boolean: 'Boolean',
  date: 'Date',
  datetime: 'DateTime',
  timestamp: 'DateTime',
  fecha: 'Date',
  cadena: 'String',
  entero: 'Integer',
  booleano: 'Boolean',
  real: 'Double',

  // Términos dictados en castellano. Sin ellos, «de tipo texto» no resuelve y
  // el atributo acaba con un tipo inventado («Texto») que el generador rechaza
  // mucho después, cuando ya nadie recuerda de dónde salió.
  texto: 'String',
  'texto largo': 'Text',
  numero: 'Double',
  número: 'Double',
  'numero entero': 'Integer',
  'número entero': 'Integer',
  'numero decimal': 'Decimal',
  'número decimal': 'Decimal',
  flotante: 'Double',
  moneda: 'Decimal',
  precio: 'Decimal',
  importe: 'Decimal',
  logico: 'Boolean',
  lógico: 'Boolean',
  'si o no': 'Boolean',
  'fecha y hora': 'DateTime',
  hora: 'Time',
  identificador: 'UUID',
  uuid: 'UUID',
  largo: 'Long',
};

export function resolveTypeName(name: string): string | undefined {
  const key = name.trim().toLowerCase();
  const canonical = ALIASES[key] ?? name.trim();
  return BY_NAME.has(canonical.toLowerCase()) ? canonical : undefined;
}

export function lookupType(name: string): TypeMapping | undefined {
  const canonical = resolveTypeName(name);
  return canonical ? BY_NAME.get(canonical.toLowerCase()) : undefined;
}

export function isPrimitiveType(name: string): boolean {
  return lookupType(name) !== undefined;
}

export function listSupportedTypes(): readonly string[] {
  return MAPPINGS.map((m) => m.uml);
}

/** Tipos admisibles como clave primaria generada. */
export const IDENTIFIER_TYPES = ['Long', 'Integer', 'UUID', 'String'] as const;

export function isValidIdentifierType(name: string): boolean {
  const canonical = resolveTypeName(name);
  return canonical !== undefined && (IDENTIFIER_TYPES as readonly string[]).includes(canonical);
}
