/**
 * Generador de identificadores ULID.
 *
 * Se generan en el cliente porque un usuario sin conexión debe poder crear
 * elementos sin pedir permiso al servidor ([Arquitectura §2.4.1]). Frente a
 * UUIDv4, ULID es ordenable por tiempo, lo que hace legible el historial de
 * operaciones y da localidad a los índices.
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const ENCODING_LEN = ENCODING.length;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function randomBytes(length: number): Uint8Array {
  const buffer = new Uint8Array(length);
  globalThis.crypto.getRandomValues(buffer);
  return buffer;
}

function encodeTime(now: number): string {
  let time = now;
  let output = '';
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = time % ENCODING_LEN;
    output = ENCODING[mod]! + output;
    time = (time - mod) / ENCODING_LEN;
  }
  return output;
}

function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_LEN);
  let output = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    output += ENCODING[bytes[i]! % ENCODING_LEN]!;
  }
  return output;
}

export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}
