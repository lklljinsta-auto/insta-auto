import { isImageJob, processImageJob } from '../services/image-jobs.js';
import { collectPostInsights } from '../services/post-insights.js';
import { configuredPublisher, publishReviewedMedia } from '../services/meta-publish.js';
import { renderReel } from '../services/render-reel.js';
import crypto from 'node:crypto';
import { pool, query, withTransaction } from '../db.js';

export function makeIdempotencyKey(accountId, contentVersionId, kind='publish') {
  return crypto.createHash('sha256').update(`${kind}:${accountId}:${contentVersionId}`).digest('hex');
}
export function canQueueAdditionalPost(metrics, minimumSamples=1) {
  return Array.isArray(metrics) && metrics.length > 0 && metrics.every((m) => m.data_status === 'actual_value' && m.metric_value !== null) && metrics.reduce((n,m)=>n + Number(m.sample_count || 0), 0) >= minimumSamples;
}
export async function enqueueJob({accountId, contentId=null, contentVersionId=null, kind, scheduledAt, timezone='Asia/Seoul', idempotencyKey}) {
  const result = await query(`INSERT INTO scheduled_jobs(account_id,content_id,content_version_id,kind,scheduled_at,account_timezone,idempotency_key)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *`,
    [accountId,contentId,contentVersionId,kind,scheduledAt,timezone,idempotencyKey]);
  return result.rows[0];
}
export async function cancelJob(jobId) {
  return withTransaction(async (client) => {
    // Approval and cancellation both lock the content before changing its reservation.
    await client.query(`SELECT c.id FROM content_items c JOIN scheduled_jobs j ON j.content_id=c.id
      WHERE j.id=$1 FOR UPDATE OF c`,[jobId]);
    const job = await client.query(`UPDATE scheduled_jobs SET status='cancelled',finished_at=now(),locked_by=NULL,locked_at=NULL
      WHERE id=$1 AND status IN ('queued','held') RETURNING *`, [jobId]);
    if (!job.rowCount) return null;
    if (job.rows[0].content_id && job.rows[0].kind==='publish') await client.query(`UPDATE content_items SET status='cancelled',updated_at=now() WHERE id=$1 AND (status IN ('scheduled','held') OR ($2='publish' AND status IN ('manual','approved')))`, [job.rows[0].content_id,job.rows[0].kind]);
    return job.rows[0];
  });
}
export async function claimJobs(workerId, limit=2, renderOnly=false) {
  return withTransaction(async (client) => {
    const result = await client.query(`WITH picked AS (
      SELECT id FROM scheduled_jobs WHERE status='queued' AND available_at<=now() AND scheduled_at<=now() AND (kind='render_reel')=$3
      ORDER BY scheduled_at,created_at FOR UPDATE SKIP LOCKED LIMIT $2
    ) UPDATE scheduled_jobs j SET status='running',attempts=j.attempts+1,locked_by=$1,locked_at=now()
      FROM picked WHERE j.id=picked.id RETURNING j.*`, [workerId,limit,renderOnly]);
    return result.rows;
  });
}
async function hold(job, reason) {
  await withTransaction(async (client) => {
    const locked = await client.query('SELECT * FROM scheduled_jobs WHERE id=$1 FOR UPDATE', [job.id]);
    if (!locked.rowCount || locked.rows[0].status !== 'running' || locked.rows[0].locked_by !== job.locked_by) return;
    await client.query(`UPDATE scheduled_jobs SET status='held',hold_reason=$2,last_error_code=$2,locked_by=NULL,locked_at=NULL WHERE id=$1`, [job.id,reason]);
    if (job.content_id && !isImageJob(job)) await client.query(`UPDATE content_items SET status='held',updated_at=now() WHERE id=$1 AND status <> 'published'`,[job.content_id]);
    await client.query(`INSERT INTO audit_events(account_id,event_type,entity_type,entity_id,details)
      VALUES($1,'job_held','scheduled_job',$2,$3::jsonb)`, [job.account_id,job.id,JSON.stringify({reason,kind:job.kind})]);
  });
}
export async function processClaimedJob(job, publisher) {
  const controls = await query('SELECT emergency_paused FROM system_controls WHERE singleton=true');
  if (job.kind === 'collect_metrics') return collectPostInsights(job);
  if (controls.rows[0]?.emergency_paused) return hold(job,'emergency_pause');
  const accountResult = await query(`SELECT a.*,c.grant_id,c.meta_app_id,g.status AS grant_status,m.enabled AS app_enabled,m.login_mode
      FROM ig_accounts a LEFT JOIN account_oauth_connections c ON c.account_id=a.id
      LEFT JOIN oauth_grants g ON g.id=c.grant_id LEFT JOIN meta_apps m ON m.id=c.meta_app_id WHERE a.id=$1`, [job.account_id]);
  const account = accountResult.rows[0];
  if (!account) return hold(job,'account_missing');
  if (job.kind === 'backup') {
    // The Drive worker owns all remote writes. This job only tracks their outcome.
    const {rows:[files]}=await query(`SELECT count(*)::int AS total,
        count(*) FILTER(WHERE u.state='verified')::int AS verified
      FROM storage_uploads u JOIN media_assets a ON a.id=u.asset_id
      JOIN content_versions v ON v.id=a.content_version_id WHERE u.account_id=$1
        AND ($2::uuid IS NULL OR v.id=$2) AND ($3::uuid IS NULL OR v.content_id=$3)`,
      [job.account_id,job.content_version_id,job.content_id]);
    const status=files.total===0?'held':files.verified===files.total?'succeeded':'queued';
    const reason=files.total===0?'no_staged_files':status==='queued'?'drive_archive_pending':null;
    await query(`UPDATE scheduled_jobs SET status=$2,hold_reason=$3,locked_by=NULL,locked_at=NULL,
        available_at=now()+interval '1 minute',finished_at=CASE WHEN $2='succeeded' THEN now() END
      WHERE id=$1 AND status='running' AND locked_by=$4`,[job.id,status,reason,job.locked_by]);
    return;
  }
  if (account.automation_mode === 'paused') return hold(job,'account_paused');
  if (isImageJob(job)) {
    const reason=await processImageJob(job);
    if(reason)await hold(job,reason);
    return;
  }
  if (job.kind === 'render_reel') {
    await renderReel(job);
    await query("UPDATE scheduled_jobs SET status='succeeded',finished_at=now(),locked_by=NULL,locked_at=NULL WHERE id=$1 AND status='running' AND locked_by=$2",[job.id,job.locked_by]);
    return;
  }
  if (job.kind === 'publish') {
    if (!account.publishing_enabled) return hold(job,'publishing_disabled');
    if (account.automation_mode === 'review') {
      const approval = await query(`SELECT approved_at FROM content_versions WHERE id=$1`,[job.content_version_id]);
      if (!approval.rows[0]?.approved_at) return hold(job,'approval_required');
    }
    if (account.connection_status !== 'connected' || !account.grant_id || account.grant_status !== 'active') return hold(job,'meta_connection_missing');
    if (!account.app_enabled) return hold(job,'meta_app_disabled');
    const transport=publisher??configuredPublisher();
    if (transport) return publishReviewedMedia(job,transport);
    return hold(job,'meta_publish_adapter_not_enabled');
  }
  const reasons = {
    source_scan: 'source_connector_not_configured',
    generate_content: 'ai_provider_not_configured',
    decision: 'metrics_not_collected'
  };
  return hold(job, reasons[job.kind] || 'handler_not_configured');
}
async function execute(job) {
    try { await processClaimedJob(job); }
    catch (error) {
      if(job.kind==='publish'){
        const pending=await query(`UPDATE scheduled_jobs j SET status='unknown_result',
          hold_reason='publish_result_reconciliation_required',locked_at=NULL,locked_by=NULL
          WHERE j.id=$1 AND j.status='running' AND j.locked_by=$2 AND j.attempts=$3
          AND EXISTS(SELECT 1 FROM publish_attempts p WHERE p.job_id=j.id
            AND p.publish_request_sent_at IS NOT NULL AND p.response_state<>'confirmed_not_published')`,
          [job.id,job.locked_by,job.attempts]);
        if(pending.rowCount) return;
      }
      const controls = await query('SELECT emergency_paused FROM system_controls WHERE singleton=true').catch(()=>({rows:[{emergency_paused:true}]}));
      const status = controls.rows[0]?.emergency_paused ? 'held' : (job.attempts >= job.max_attempts ? 'failed' : 'queued');
      const delay = Math.min(900,2 ** Math.min(job.attempts,9));
      await query(`UPDATE scheduled_jobs SET status=$2,available_at=now()+($3||' seconds')::interval,
        last_error_code='worker_error',hold_reason=$4,locked_by=NULL,locked_at=NULL WHERE id=$1 AND status='running' AND locked_by=$5`,
      [job.id,status,delay,String(error?.code || 'worker_error').slice(0,160),job.locked_by]).catch(()=>{});
    }
}
export async function runRenderOnce(workerId) {
  const client=await pool.connect();
  try {
    const lock=await client.query("SELECT pg_try_advisory_lock(532049320) AS ok");
    if (!lock.rows[0].ok) return false;
    try {
      const [job]=await claimJobs(workerId,1,true);
      if (job) await execute(job);
      return Boolean(job);
    } finally { await client.query("SELECT pg_advisory_unlock(532049320)"); }
  } finally { client.release(); }
}
export async function runOnce(workerId=crypto.randomUUID(), concurrency=2) {
  const jobs = await claimJobs(workerId,concurrency);
  for (const job of jobs) await execute(job);
  const count = await query(`SELECT count(*)::int AS n FROM scheduled_jobs WHERE status='queued'`);
  await query(`INSERT INTO worker_heartbeats(worker_id,last_seen_at,state,queue_waiting,detail)
    VALUES($1,now(),'ready',$2,'{}'::jsonb) ON CONFLICT(worker_id) DO UPDATE SET last_seen_at=now(),state='ready',queue_waiting=EXCLUDED.queue_waiting`,[workerId,count.rows[0].n]);
  return {claimed:jobs.length,waiting:count.rows[0].n};
}
export async function recoverAbandonedJobs() {
  // Jobs interrupted before an external request can be retried. A sent publish with no response must be reconciled, never reposted.
  await query(`UPDATE scheduled_jobs j SET status='queued',locked_by=NULL,locked_at=NULL,available_at=now()
    WHERE j.status='running' AND j.locked_at < now()-interval '5 minutes'
    AND NOT EXISTS (SELECT 1 FROM publish_attempts p WHERE p.job_id=j.id AND (p.response_state IN ('response_lost','reconciling') OR (p.publish_request_sent_at IS NOT NULL AND p.response_state <> 'confirmed_not_published')))`);
  await query(`UPDATE scheduled_jobs j SET status='unknown_result',locked_by=NULL,locked_at=NULL,hold_reason='publish_result_reconciliation_required'
    WHERE j.status='running' AND j.locked_at < now()-interval '5 minutes'
    AND EXISTS (SELECT 1 FROM publish_attempts p WHERE p.job_id=j.id AND (p.response_state IN ('response_lost','reconciling') OR (p.publish_request_sent_at IS NOT NULL AND p.response_state <> 'confirmed_not_published')))`);
}
export async function markPublishResponseLost(jobId, attemptNo) {
  return withTransaction(async (client) => {
    const r = await client.query(`UPDATE publish_attempts SET response_state='response_lost' WHERE job_id=$1 AND attempt_no=$2 RETURNING id`,[jobId,attemptNo]);
    if (!r.rowCount) return false;
    await client.query(`UPDATE scheduled_jobs SET status='unknown_result',hold_reason='publish_result_reconciliation_required',locked_by=NULL,locked_at=NULL WHERE id=$1`,[jobId]);
    return true;
  });
}
