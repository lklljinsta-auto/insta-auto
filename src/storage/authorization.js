import crypto from 'node:crypto';
import { query, encryptSecret, decryptSecret } from '../db.js';
import { GoogleDrive, driveConfig } from './drive.js';

const scope = 'https://www.googleapis.com/auth/drive.file';
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const fail = (code,status) => Object.assign(new Error(code),{status, publicCode:code});
const redirect = () => process.env.GOOGLE_DRIVE_REDIRECT_URI;
export async function storageStatus() {
  const {rows} = await query(`SELECT EXISTS(SELECT 1 FROM drive_authorizations) AS consent,
    (SELECT count(*)::int FROM storage_uploads WHERE asset_id IS NOT NULL AND state<>'verified') AS waiting,
    (SELECT count(*)::int FROM storage_uploads WHERE asset_id IS NOT NULL AND state='verified') AS verified,
    (SELECT count(*)::int FROM drive_folder_work WHERE error_code IS NOT NULL) AS folder_errors,
    (SELECT root_id FROM drive_destination WHERE root_ready) AS root_id`);
  const configReady = Boolean(process.env.GOOGLE_DRIVE_CLIENT_ID && process.env.GOOGLE_DRIVE_CLIENT_SECRET);
  return {...rows[0], canConnect: Boolean(configReady && redirect() && process.env.TOKEN_ENCRYPTION_KEY),
    credentialConfigured: configReady && (rows[0].consent || Boolean(process.env.GOOGLE_DRIVE_REFRESH_TOKEN))};
}

export async function startConsent(adminId) {
  if (!(await storageStatus()).canConnect) throw fail('drive_oauth_setup_required',409);
  const state = crypto.randomBytes(32).toString('base64url');
  await query('DELETE FROM drive_consent_states WHERE expires_at<now()');
  await query("INSERT INTO drive_consent_states VALUES($1,$2,now()+interval '10 minutes')",[hash(state),adminId]);
  const params = new URLSearchParams({client_id:process.env.GOOGLE_DRIVE_CLIENT_ID,redirect_uri:redirect(),
    response_type:'code',scope,access_type:'offline',prompt:'consent',state});
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
}
export async function finishConsent(adminId,state,code) {
  const result = await query('DELETE FROM drive_consent_states WHERE state_hash=$1 AND operator_id=$2 AND expires_at>now() RETURNING operator_id',[hash(String(state||'')),adminId]);
  if (!result.rowCount || !code) throw fail('drive_consent_invalid',400);
  const response = await fetch('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(30000),
    body:new URLSearchParams({code,client_id:process.env.GOOGLE_DRIVE_CLIENT_ID,client_secret:process.env.GOOGLE_DRIVE_CLIENT_SECRET,
      redirect_uri:redirect(),grant_type:'authorization_code'})});
  if (!response.ok) throw fail('drive_consent_exchange_failed',409);
  const token = await response.json();
  if (!token.refresh_token || !String(token.scope||'').split(' ').includes(scope)) throw fail('drive_offline_permission_missing',409);
  await query(`INSERT INTO drive_authorizations(singleton,refresh_encrypted) VALUES(true,$1)
    ON CONFLICT(singleton) DO UPDATE SET refresh_encrypted=EXCLUDED.refresh_encrypted,updated_at=now()`,[encryptSecret(token.refresh_token)]);
}
let cached, cachedKey;
export async function connectedDrive() {
  if (!process.env.GOOGLE_DRIVE_CLIENT_ID || !process.env.GOOGLE_DRIVE_CLIENT_SECRET) return null;
  const {rows} = await query('SELECT refresh_encrypted FROM drive_authorizations');
  const refresh = rows[0] ? decryptSecret(rows[0].refresh_encrypted) : process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const config = driveConfig({...process.env,GOOGLE_DRIVE_REFRESH_TOKEN:refresh});
  if (!config) return null;
  const key = hash(JSON.stringify(config));
  if (key !== cachedKey) { cached = new GoogleDrive(config); cachedKey = key; }
  return cached;
}
