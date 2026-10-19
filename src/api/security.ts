import {createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt = promisify(scryptCb);

export function randomToken(bytes = 32): string { return randomBytes(bytes).toString('base64url'); }
export function tokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = await scrypt(password, salt, 64) as Buffer;
  return safeEqual(derived.toString('hex'), hash);
}
export function hmacSha256(secret: string, message: string | Buffer): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}
