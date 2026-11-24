import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withTransaction,query } from '../db.js';
import { stageMedia } from '../storage/archive.js';

const exec=promisify(execFile);
const bad=()=>Object.assign(new Error('invalid_reel_inputs'),{status:400,publicCode:'invalid_reel_inputs'});
export async function queueRender(versionId,{picture,music,captions=null,seconds}) {
  captions=captions||null;
  if (!Number.isInteger(seconds) || seconds<1 || seconds>180 || !picture || !music) throw bad();
  return withTransaction(async db=>{
    const result=await db.query(`SELECT v.content_id,c.account_id FROM content_versions v
      JOIN content_items c ON c.id=v.content_id WHERE v.id=$1 AND c.final_format='reel_mp4'`,[versionId]);
    if (!result.rowCount) throw bad();
    const {rows}=await db.query(`SELECT id,mime_type FROM media_assets WHERE object_store='archive_spool'
      AND content_version_id=$1 AND id=ANY($2::uuid[])`,[versionId,[picture,music,captions].filter(Boolean)]);
    const types=new Map(rows.map(r=>[r.id,r.mime_type]));
    if (!/^(image|video)\//.test(types.get(picture) || '') || !types.get(music)?.startsWith('audio/') ||
        (captions && !['application/x-subrip','text/vtt'].includes(types.get(captions)))) throw bad();
    const key=createHash('sha256').update(JSON.stringify(['render-v1',versionId,picture,music,captions,seconds])).digest('hex');
    const {content_id,account_id}=result.rows[0];
    const {rows:[job]}=await db.query(`INSERT INTO scheduled_jobs(account_id,content_id,content_version_id,kind,scheduled_at,idempotency_key)
      VALUES($1,$2,$3,'render_reel',now(),$4) ON CONFLICT(idempotency_key) DO UPDATE
      SET idempotency_key=EXCLUDED.idempotency_key RETURNING id,status`,[account_id,content_id,versionId,key]);
    await db.query(`INSERT INTO reel_render_inputs VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[job.id,picture,music,captions,seconds]);
    return job;
  });
}
export async function renderReel(job) {
  const slot='render-'+job.id;
  const prior=await query('SELECT asset_id FROM storage_uploads WHERE idempotency_key=$1',[job.content_version_id+'/'+slot]);
  if (prior.rowCount) return;
  const {rows:[input]}=await query(`SELECT i.seconds,p.sha256 image_hash,p.mime_type visual_mime,m.sha256 music_hash,s.sha256 subs_hash,s.mime_type subs_mime
    FROM reel_render_inputs i JOIN media_assets p ON p.id=i.picture JOIN media_assets m ON m.id=i.music
    LEFT JOIN media_assets s ON s.id=i.captions WHERE job_id=$1`,[job.id]);
  if(!input)throw bad();
  const spool=path.resolve(process.env.MEDIA_SPOOL_DIR||'.instaauto-media');
  const temp=await mkdtemp(path.join(tmpdir(),'instaauto-render-'));
  try {
    const filters=['scale=720:1280:force_original_aspect_ratio=decrease','pad=720:1280:(ow-iw)/2:(oh-ih)/2','setsar=1'];
    if (input.subs_hash) {
      const sub=input.subs_mime==='text/vtt'?'captions.vtt':'captions.srt';
      await copyFile(path.join(spool,input.subs_hash),path.join(temp,sub));
      filters.push('subtitles='+sub);
    }
    const visualOptions=input.visual_mime.startsWith('image/') ? ['-loop','1','-framerate','24'] : ['-stream_loop','-1'];
    const args=['-nostdin','-hide_banner','-loglevel','error','-filter_threads','1','-protocol_whitelist','file',
      ...visualOptions,'-i',path.join(spool,input.image_hash),'-protocol_whitelist','file','-stream_loop','-1','-i',path.join(spool,input.music_hash),
      '-map','0:v:0','-map','1:a:0','-vf',filters.join(','),'-t',String(input.seconds),'-c:v','libx264','-threads','2',
      '-r','24','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-movflags','+faststart','reel.mp4'];
    await exec('ffmpeg',args,{cwd:temp,timeout:240000,maxBuffer:64*1024});
    await stageMedia({versionId:job.content_version_id,slot,mime:'video/mp4',stream:createReadStream(path.join(temp,'reel.mp4'))});
  } finally { await rm(temp,{recursive:true,force:true}); }
}
