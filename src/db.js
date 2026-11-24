import pg from 'pg';
import crypto from 'node:crypto';
const { Pool } = pg;
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_SIZE || 8), idleTimeoutMillis: 30000 });
export const query = (text, values) => pool.query(text, values);
export const withTransaction = async (fn) => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
};
const key = () => {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is required before storing provider credentials');
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return bytes;
};
export function encryptSecret(value) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${body.toString('base64')}`;
}
export function decryptSecret(value) {
  const [version, iv, tag, body] = String(value).split('.');
  if (version !== 'v1') throw new Error('Unsupported encrypted secret version');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
}
export async function closePool() { await pool.end(); }
