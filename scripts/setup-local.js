import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const envFile = '.env.local';
try { await fs.access(envFile); console.error(`${envFile} already exists; refusing to overwrite it.`); process.exit(1); } catch {}
const password = crypto.randomBytes(18).toString('base64url');
const sessionSecret = crypto.randomBytes(32).toString('base64');
const encryptionKey = crypto.randomBytes(32).toString('base64');
const body = [
  'NODE_ENV=development',
  'DATABASE_URL=postgresql://instaauto_dev:local-dev-only@127.0.0.1:5432/instaauto_dev',
  'ADMIN_EMAIL=admin@localhost',
  `ADMIN_PASSWORD=${password}`,
  `SESSION_SECRET=${sessionSecret}`,
  `TOKEN_ENCRYPTION_KEY=${encryptionKey}`,
  'APP_ORIGIN=http://localhost:3000',
  'PORT=3000',
  'WORKER_POLL_MS=1000'
].join('\n') + '\n';
await fs.writeFile(envFile, body, { mode: 0o600, flag: 'wx' });
const result = spawnSync('node', ['--env-file=.env.local', 'scripts/bootstrap-admin.js'], { stdio: 'inherit' });
if (result.status !== 0) { await fs.unlink(envFile); process.exit(result.status || 1); }
console.log('\nDevelopment-only admin login (keep local; not production credentials):');
console.log(`Email: admin@localhost\nPassword: ${password}`);
console.log('The password and keys are stored only in ignored .env.local (mode 0600).');
