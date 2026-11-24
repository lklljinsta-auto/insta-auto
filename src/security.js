import crypto from 'node:crypto';
import { query } from './db.js';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const timingSafe = (a, b) => { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); };
export const hashSessionToken = sha256;
export async function requireAdmin(req, res, next) {
  try {
    const token = req.cookies?.ia_session;
    if (!token) return res.status(401).json({ error: 'authentication_required' });
    const result = await query(`SELECT s.id AS session_id,s.csrf_token,s.expires_at,o.id AS operator_id,o.email,o.role
      FROM admin_sessions s JOIN operators o ON o.id=s.operator_id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND o.disabled_at IS NULL`, [sha256(token)]);
    if (!result.rowCount) return res.status(401).json({ error: 'session_expired' });
    req.admin = { id: result.rows[0].operator_id, email: result.rows[0].email, role: result.rows[0].role };
    req.session = { id: result.rows[0].session_id, csrf: result.rows[0].csrf_token };
    await query('UPDATE admin_sessions SET last_seen_at=now() WHERE id=$1', [req.session.id]);
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const expected = `${req.protocol}://${req.get('host')}`;
      if (!origin || new URL(origin).host !== new URL(expected).host) return res.status(403).json({ error: 'origin_check_failed' });
      if (!timingSafe(String(req.get('x-csrf-token') || ''), req.session.csrf)) return res.status(403).json({ error: 'csrf_check_failed' });
    }
    next();
  } catch (error) { next(error); }
}
export function passwordMatches(password, stored) {
  const [scheme, salt, digest] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const computed = crypto.scryptSync(password, salt, 64).toString('hex');
  return timingSafe(computed, digest);
}
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
export async function audit(operatorId, eventType, entityType=null, entityId=null, details={}, accountId=null) {
  await query(`INSERT INTO audit_events(operator_id,account_id,event_type,entity_type,entity_id,details)
    VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [operatorId,accountId,eventType,entityType,entityId,JSON.stringify(details)]);
}
