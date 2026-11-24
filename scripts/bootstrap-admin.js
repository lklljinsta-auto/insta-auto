import { query, closePool } from '../src/db.js';
import { hashPassword } from '../src/security.js';
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password || password.length < 18) throw new Error('ADMIN_EMAIL and an ADMIN_PASSWORD of at least 18 characters are required');
const found = await query('SELECT id FROM operators WHERE email=$1', [email]);
if (!found.rowCount) {
  await query('INSERT INTO operators(email,password_hash) VALUES($1,$2)', [email, hashPassword(password)]);
  console.log(`Created local administrator ${email}`);
} else console.log(`Administrator ${email} already exists; unchanged`);
await closePool();
