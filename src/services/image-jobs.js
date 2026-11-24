import { query } from '../db.js';
import { generateImage } from './ai-providers.js';

const jobKey = id => 'operator-image:'+id;
const correctable=['image_provider_not_configured','image_model_required','generation_budget_not_configured',
  'generation_cost_limit_required','budget_insufficient','image_adapter_unavailable','emergency_pause','account_paused'];

export async function queueImage(versionId) {
  const {rows:[job]}=await query(`INSERT INTO scheduled_jobs(account_id,content_id,content_version_id,kind,scheduled_at,idempotency_key)
    SELECT c.account_id,c.id,v.id,'generate_content',now(),$2 FROM content_versions v
    JOIN content_items c ON c.id=v.content_id AND c.active_version=v.version
    WHERE v.id=$1 AND v.approved_at IS NULL AND c.status NOT IN ('published','cancelled')
    ON CONFLICT(idempotency_key) DO UPDATE SET
      status=CASE WHEN scheduled_jobs.status='held' AND scheduled_jobs.hold_reason=ANY($3) THEN 'queued' ELSE scheduled_jobs.status END,
      hold_reason=CASE WHEN scheduled_jobs.status='held' AND scheduled_jobs.hold_reason=ANY($3) THEN NULL ELSE scheduled_jobs.hold_reason END
    RETURNING id,status,hold_reason`,[versionId,jobKey(versionId),correctable]);
  return job;
}
export function isImageJob(job) {
  return job.kind==='generate_content' && job.idempotency_key===jobKey(job.content_version_id);
}
export async function processImageJob(job) {
  const {rows:[v]}=await query(`SELECT v.title,v.caption,v.editorial_snapshot,c.final_format
    FROM content_versions v JOIN content_items c ON c.id=v.content_id AND c.active_version=v.version
    WHERE v.id=$1 AND c.id=$2 AND c.account_id=$3 AND v.approved_at IS NULL AND c.status NOT IN ('published','cancelled')`,
    [job.content_version_id,job.content_id,job.account_id]);
  if(!v)return 'content_version_unavailable';
  const e=v.editorial_snapshot?.editorial??{};
  const prompt=[v.caption||v.title,e.topic,e.audience,e.voice,e.avoid&&('금지 표현: '+e.avoid),
    v.final_format==='reel_mp4'?e.reel:e.feed].filter(Boolean).join('\n');
  try {
    await generateImage({contentVersionId:job.content_version_id,accountId:job.account_id,title:v.title,prompt});
  }catch(error){
    return error.publicCode||'image_result_requires_review';
  }
  await query(`UPDATE scheduled_jobs SET status='succeeded',finished_at=now(),hold_reason=NULL,last_error_code=NULL,
    locked_by=NULL,locked_at=NULL WHERE id=$1 AND status='running' AND locked_by=$2 AND attempts=$3`,
    [job.id,job.locked_by,job.attempts]);
  return null;
}
