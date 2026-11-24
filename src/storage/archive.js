import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, link, unlink } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pool, query, withTransaction } from '../db.js';

const extensions = new Map(Object.entries({
  'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp', 'video/mp4':'mp4', 'video/webm':'webm',
  'audio/mpeg':'mp3', 'audio/mp4':'m4a', 'audio/wav':'wav', 'audio/x-wav':'wav',
  'text/vtt':'vtt', 'application/x-subrip':'srt', 'text/plain':'txt'
}));
const koreanTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit',
  hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
});
const spoolRoot = () => path.resolve(process.env.MEDIA_SPOOL_DIR || '.instaauto-media');
const error = (code, status=409) => Object.assign(new Error(code), {code, publicCode:code, status});
function cleanTitle(title) {
  const normalized = String(title).normalize('NFC').replace(/[\\/:*?"<>|\p{Cc}]/gu,' ').replace(/\s+/g,' ').trim();
  let result = '', bytes = 0;
  for (const ch of normalized) {
    bytes += Buffer.byteLength(ch);
    if (bytes > 200) break;
    result += ch;
  }
  return result.trimEnd() || '제목 없음';
}
export function fileNameAt(date, title, extension, suffix=0) {
  const stamp = koreanTime.format(new Date(date)).replace(' ','_').replaceAll(':','-');
  return stamp + '_' + cleanTitle(title) + (suffix ? '_' + String(suffix).padStart(2,'0') : '') + '.' + extension;
}

// Used by generation workers and by authenticated manual attachments. The stable slot
// belongs to one immutable content version. A changed output needs a new slot/version.
export async function stageMedia({versionId, slot, title, mime, stream, ordinal=0, generatedAt=new Date()}) {
  const extension = extensions.get(mime);
  if (!extension || !/^[a-zA-Z0-9_-]{1,100}$/.test(slot) || !Number.isInteger(ordinal) || ordinal < 0 || ordinal > 9999)
    throw error('invalid_media_metadata',400);
  const version = (await query(`SELECT c.account_id, c.final_format, v.title, v.caption
    FROM content_versions v JOIN content_items c ON c.id=v.content_id WHERE v.id=$1`,[versionId])).rows[0];
  if (!version) throw error('content_version_not_found',404);
  const root = spoolRoot();
  await mkdir(root,{recursive:true,mode:0o700});
  const temp = path.join(root,'.part-' + randomUUID());
  const digest = createHash('sha256');
  let size = 0;
  const meter = new Transform({transform(chunk,encoding,done) {
    size += chunk.length;
    if (size > 1024**3) return done(error('media_exceeds_1_gib',413));
    digest.update(chunk); done(null,chunk);
  }});
  try {
    await pipeline(stream,meter,createWriteStream(temp,{flags:'wx',mode:0o600,flush:true}));
    if (!size) throw error('empty_media',400);
    const sha = digest.digest('hex');
    const kind = version.final_format === 'reel_mp4' ? 'reels' : 'feed';
    // A repeat browser upload can have a different lastModified time.
    const objectKey = versionId + '/' + (slot === 'manual' ? 'manual-' + sha : slot);
    return await withTransaction(async client => {
      await client.query('SELECT id FROM ig_accounts WHERE id=$1 FOR UPDATE',[version.account_id]);
      const prior = (await client.query(`SELECT u.*,m.mime_type FROM storage_uploads u JOIN media_assets m ON m.id=u.asset_id
        WHERE u.idempotency_key=$1`,[objectKey])).rows[0];
      if (prior && (prior.content_sha256 !== sha || prior.mime_type !== mime)) throw error('media_slot_already_used');
      try { await link(temp,path.join(root,sha)); } catch(e) { if(e.code!=='EEXIST') throw e; }
      if (prior) return prior;
      const label = title?.trim() || version.title || version.caption.split('\n')[0] || '제목 없음';
      let suffix = ordinal, filename;
      do {
        filename = fileNameAt(generatedAt,label,extension,suffix++);
      } while ((await client.query(`SELECT 1 FROM storage_uploads WHERE account_id=$1 AND kind=$2
          AND provider='google-drive' AND filename=$3`,[version.account_id,kind,filename])).rowCount);
      const asset = (await client.query(`INSERT INTO media_assets
        (content_version_id,object_store,object_key,mime_type,size_bytes,sha256,created_at)
        VALUES($1,'archive_spool',$2,$3,$4,$5,$6) RETURNING id`,[versionId,objectKey,mime,size,sha,generatedAt])).rows[0];
      return (await client.query(`INSERT INTO storage_uploads
        (idempotency_key,asset_id,account_id,kind,content_sha256,filename,provider,state)
        VALUES($1,$2,$3,$4,$5,$6,'google-drive','pending') RETURNING *`,
        [objectKey,asset.id,version.account_id,kind,sha,filename])).rows[0];
    });
  } finally { await unlink(temp).catch(e=>{if(e.code!=='ENOENT') throw e;}); }
}

async function checkPause(db) {
  const {rows} = await db.query('SELECT emergency_paused FROM system_controls WHERE singleton=true');
  if (rows[0]?.emergency_paused !== false) throw error('emergency_pause');
}
async function ensureFolder(db, drive, account, kind, parent, name) {
  const args = [account.id,kind];
  const select = `SELECT remote_folder_id FROM account_media_folders
    WHERE account_id=$1 AND kind=$2 AND provider='google-drive'`;
  let row = (await db.query(select,args)).rows[0];
  if (!row) {
    const id = await drive.allocateId();
    await db.query(`INSERT INTO account_media_folders(account_id,kind,provider,remote_folder_id,folder_path)
      VALUES($1,$2,'google-drive',$3,$4) ON CONFLICT (account_id,kind,provider) DO NOTHING`,[...args,id,name]);
    row = (await db.query(select,args)).rows[0];
  }
  await checkPause(db);
  await drive.ensureFolder(row.remote_folder_id,parent,name,account.id + ':' + kind);
  return row.remote_folder_id;
}
async function prepareAccount(db,drive,accountId,archiveRoot) {
  const account = (await db.query('SELECT id,profile_handle FROM ig_accounts WHERE id=$1',[accountId])).rows[0];
  const root = await ensureFolder(db,drive,account,'account',archiveRoot,
    account.profile_handle ? '@' + account.profile_handle : account.id);
  await ensureFolder(db,drive,account,'feed',root,'피드');
  await ensureFolder(db,drive,account,'reels',root,'릴스');
  await db.query('UPDATE drive_folder_work SET ready=true,error_code=NULL WHERE account_id=$1',[accountId]);
}

async function transferFile(db, drive, task) {
  let remoteId = task.remote_file_id;
  if (!remoteId) {
    remoteId = await drive.allocateId();
    await db.query('UPDATE storage_uploads SET remote_file_id=$2 WHERE id=$1',[task.id,remoteId]);
  }
  const folder = (await db.query(`SELECT remote_folder_id FROM account_media_folders
    WHERE account_id=$1 AND kind=$2 AND provider='google-drive'`,[task.account_id,task.kind])).rows[0];
  const file = {assetId:task.asset_id, name:task.filename, mime:task.mime_type, size:Number(task.size_bytes),
    sha256:task.content_sha256, path:path.join(spoolRoot(),task.content_sha256)};
  await drive.ensureFile(remoteId,folder.remote_folder_id,file,()=>checkPause(db));
  await db.query('BEGIN');
  try {
    await db.query(`UPDATE storage_uploads SET state='verified',last_error_code=NULL,updated_at=now() WHERE id=$1`,[task.id]);
    await db.query(`UPDATE media_assets SET drive_file_id=$2,is_unique_copy=false,state='backup_verified' WHERE id=$1`,[task.asset_id,remoteId]);
    await db.query(`INSERT INTO backup_records(account_id,asset_id,drive_file_id,status,verified_at)
      VALUES($1,$2,$3,'verified',now())`,[task.account_id,task.asset_id,remoteId]);
    await db.query('COMMIT');
  } catch(e) { await db.query('ROLLBACK'); throw e; }
}

// The session lock survives transaction commits. If the process dies it is released;
// an already-created remote object is recovered using its previously committed Drive ID.
async function handleOne(db, drive, folders, archiveRoot) {
  const sql = folders ? `SELECT account_id AS id FROM drive_folder_work WHERE NOT ready AND retry_at<=now() ORDER BY retry_at,account_id LIMIT 12`
    : `SELECT u.id FROM storage_uploads u JOIN drive_folder_work w ON w.account_id=u.account_id
       WHERE w.ready AND u.asset_id IS NOT NULL AND u.state <> 'verified' AND u.retry_at<=now() ORDER BY u.retry_at,u.id LIMIT 12`;
  for (const {id} of (await db.query(sql)).rows) {
    const lock = (folders ? 'drive-dir:' : 'drive-file:') + id;
    const got = await db.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok',[lock]);
    if (!got.rows[0].ok) continue;
    try {
      await checkPause(db);
      if (folders) {
        const due = await db.query('UPDATE drive_folder_work SET attempts=attempts+1 WHERE account_id=$1 AND NOT ready AND retry_at<=now() RETURNING account_id',[id]);
        if (!due.rowCount) continue;
        await prepareAccount(db,drive,id,archiveRoot);
      } else {
        const due = await db.query(`UPDATE storage_uploads u SET attempts=attempts+1,updated_at=now()
          FROM media_assets m WHERE u.id=$1 AND u.asset_id=m.id AND u.state<>'verified' AND u.retry_at<=now()
          RETURNING u.*,m.size_bytes,m.mime_type`,[id]);
        if (!due.rowCount) continue;
        await transferFile(db,drive,due.rows[0]);
      }
      return true;
    } catch(e) {
      const reason = /^[a-zA-Z0-9_]{1,80}$/.test(e.code || '') ? e.code : 'drive_transfer_error';
      if (folders) await db.query(`UPDATE drive_folder_work SET error_code=$2,
        retry_at=now()+make_interval(secs=>least(900,5*(1<<least(attempts,7)))) WHERE account_id=$1`,[id,reason]);
      else await db.query(`UPDATE storage_uploads SET state='retryable_error',last_error_code=$2,updated_at=now(),
        retry_at=now()+make_interval(secs=>least(900,5*(1<<least(attempts,7)))) WHERE id=$1`,[id,reason]);
      return true;
    } finally { await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lock]); }
  }
  return false;
}
export async function runArchiveOnce(drive) {
  if (!drive) return false;
  const db = await pool.connect();
  try {
    const paused = (await db.query('SELECT emergency_paused FROM system_controls WHERE singleton=true')).rows[0];
    if (!paused || paused.emergency_paused) return false;
    let dest = (await db.query('SELECT * FROM drive_destination WHERE singleton=true')).rows[0];
    const mode = drive.rootId ? 'existing' : 'automatic';
    if (!dest) {
      const id = drive.rootId || await drive.allocateId();
      await db.query('INSERT INTO drive_destination(singleton,root_id,root_mode) VALUES(true,$1,$2) ON CONFLICT DO NOTHING',[id,mode]);
      dest = (await db.query('SELECT * FROM drive_destination WHERE singleton=true')).rows[0];
    }
    if (dest.root_mode !== mode || (drive.rootId && dest.root_id !== drive.rootId)) throw error('drive_root_changed');
    if (!dest.root_ready) {
      await checkPause(db);
      if (mode === 'automatic') {
        const parent = await drive.stat('root');
        if (!parent?.id) throw error('drive_root_unavailable');
        await drive.ensureFolder(dest.root_id,parent.id,'인스타오토','archive-root');
      } else {
        const root = await drive.stat(dest.root_id);
        if (!root || root.trashed || root.mimeType !== 'application/vnd.google-apps.folder') throw error('drive_root_unavailable');
      }
      await db.query('UPDATE drive_destination SET root_ready=true WHERE singleton=true');
    }
    const folders = await handleOne(db,drive,true,dest.root_id);
    const files = await handleOne(db,drive,false,dest.root_id);
    return folders || files;
  } finally { db.release(); }
}
