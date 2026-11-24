import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, closePool, withTransaction } from '../src/db.js';
import { hashPassword } from '../src/security.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'.dev-login.txt');
const password=crypto.randomBytes(36).toString('base64url');
try{
 const email=process.env.ADMIN_EMAIL;
 if(!email||password.length<18)throw new Error('local_admin_configuration_invalid');
 const result=await withTransaction(async(client)=>{
  const updated=await client.query('UPDATE operators SET password_hash=$2 WHERE lower(email)=lower($1) RETURNING id',[email,hashPassword(password)]);
  if(!updated.rowCount)throw new Error('local_admin_not_found');
  await client.query('DELETE FROM admin_sessions WHERE operator_id=$1',[updated.rows[0].id]);
  return updated;
 });
 await fs.writeFile(out,`${email}\n${password}\n`,{mode:0o600});
 await fs.chmod(out,0o600);
 console.log('Local administrator password rotated; all administrator sessions revoked.');
 console.log(`Retrieve locally with: cat ${out}`);
}finally{await closePool();}
