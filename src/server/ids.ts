import { randomBytes, randomUUID } from "node:crypto";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** Short, URL-safe, unambiguous id with an entity prefix (for example adj_k3v9x2m7). */
export function newId(prefix: string, length = 10): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}_${out}`;
}

export function newSessionId(): string {
  return randomUUID();
}
