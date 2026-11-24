import { scheduleInsights } from './post-insights.js';
import { decryptSecret, withTransaction } from '../db.js';
import { deliveryStore, preparePublishUrl } from '../storage/publish-media.js';

function graphClient({login_mode,encrypted_token},version) {
  const origin=login_mode==='instagram_login'?'https://graph.instagram.com':'https://graph.facebook.com';
  async function request(path,params) {
    const response=await fetch(origin+'/'+version+'/'+path,{
      method:params?'POST':'GET',redirect:'error',
      headers:{Authorization:'Bearer '+decryptSecret(encrypted_token)},
      body:params?new URLSearchParams(params):undefined,signal:AbortSignal.timeout(20000)
    });
    if(!response.ok) throw new Error('Meta request failed');
    return response.json();
  }
  return {
    create:(account,url,item)=>request(account+'/media',item.final_format==='reel_mp4'
      ? {media_type:'REELS',video_url:url,caption:item.caption}:{image_url:url,caption:item.caption}),
    status:id=>request(id+'?fields=status_code'),
    publish:(account,id)=>request(account+'/media_publish',{creation_id:id})
  };
}
export function configuredPublisher() {
  if(process.env.META_PUBLISH_ENABLED!=='true' || !/^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION||'')) return null;
  const store=deliveryStore();
  return store && {url:asset=>preparePublishUrl(store,asset),graph:item=>graphClient(item,process.env.META_GRAPH_VERSION)};
}
const validId=id=>typeof id==='string' && /^\d+$/.test(id);

async function check(db,job) {
  // A pause already committed wins. A pause during the bounded final call waits for its outcome.
  const {rows:[control]}=await db.query('SELECT emergency_paused FROM system_controls WHERE singleton FOR SHARE');
  const locked=(await db.query(`SELECT * FROM scheduled_jobs WHERE id=$1 AND status='running'
    AND kind='publish' AND locked_by=$2 AND attempts=$3 AND scheduled_at<=now() FOR UPDATE`,[job.id,job.locked_by,job.attempts])).rows[0];
  if(!locked) return {};
  const block=async reason=>{
    await db.query(`UPDATE scheduled_jobs SET status='held',hold_reason=$2,locked_at=NULL,locked_by=NULL WHERE id=$1`,[job.id,reason]);
    await db.query(`UPDATE content_items SET status='held' WHERE id=$1 AND status='scheduled'`,[locked.content_id]);
    return {};
  };
  if(control?.emergency_paused!==false) return block('emergency_pause');
  const {rows:[item]}=await db.query(`SELECT a.id account_id,a.meta_account_id,a.automation_mode,
      g.encrypted_token,g.granted_scopes,m.login_mode,c.final_format,v.caption,
      asset.id,asset.sha256,asset.size_bytes,asset.mime_type,v.id content_version_id
    FROM ig_accounts a JOIN account_oauth_connections x ON x.account_id=a.id
    JOIN oauth_grants g ON g.id=x.grant_id AND g.meta_app_id=x.meta_app_id
    JOIN grant_accounts ga ON ga.grant_id=g.id AND ga.account_id=a.id AND ga.meta_account_id=a.meta_account_id
    JOIN meta_apps m ON m.id=x.meta_app_id JOIN content_items c ON c.id=$2 AND c.account_id=a.id
    JOIN content_versions v ON v.id=$3 AND v.content_id=c.id AND v.version=c.active_version
    JOIN media_assets asset ON asset.id=v.publish_asset_id AND asset.content_version_id=v.id
    WHERE a.id=$1 AND a.connection_status='connected' AND a.publishing_enabled AND a.automation_mode='review'
      AND m.enabled AND g.status='active' AND (g.expires_at IS NULL OR g.expires_at>now())
      AND c.status='scheduled' AND v.approved_at IS NOT NULL AND asset.object_store='archive_spool'
      AND ((c.final_format='feed_image' AND asset.mime_type='image/jpeg') OR
           (c.final_format='reel_mp4' AND asset.mime_type='video/mp4')) FOR SHARE OF a,g,ga,m,c,v,asset,x`,
    [locked.account_id,locked.content_id,locked.content_version_id]);
  if(!item || !validId(item.meta_account_id)) return block('approved_media_or_account_unavailable');
  const scope=item.login_mode==='instagram_login'?'instagram_business_content_publish':'instagram_content_publish';
  if(!item.granted_scopes.some(s=>s===scope || (s.permission===scope && s.status==='granted'))) return block('publishing_scope_missing');
  const {rows:[attempt]}=await db.query(`SELECT * FROM publish_attempts WHERE job_id=$1 ORDER BY attempt_no DESC LIMIT 1 FOR UPDATE`,[job.id]);
  return {item,attempt,block};
}
async function uncertain(db,job) {
  await db.query("UPDATE publish_attempts SET response_state='reconciling' WHERE job_id=$1 AND publish_request_sent_at IS NOT NULL AND actual_post_id IS NULL",[job.id]);
  await db.query(`UPDATE scheduled_jobs SET status='unknown_result',hold_reason='publish_result_reconciliation_required',
    locked_by=NULL,locked_at=NULL WHERE id=$1`,[job.id]);
}

export async function publishReviewedMedia(job,transport) {
  // Commit the send intent before making a request that could publish a post.
  const ready=await withTransaction(async db=>{
    const {item,attempt,block}=await check(db,job);
    if(!item) return false;
    // A concurrent invocation can see the committed intent while its owner is still sending.
    // Recovery handles an abandoned owner after the lease expires.
    if(attempt?.publish_request_sent_at) return false;
    const api=transport.graph(item);
    let container=attempt?.meta_container_id;
    if(!container){
      const result=await api.create(item.meta_account_id,await transport.url(item),item);
      if(!validId(result.id)) throw new Error('Invalid container');
      container=result.id;
      await db.query(`INSERT INTO publish_attempts(job_id,attempt_no,idempotency_key,meta_container_id)
        VALUES($1,1,$2,$3)`,[job.id,job.idempotency_key+':container',container]);
    }
    const {status_code:state}=await api.status(container);
    await db.query('UPDATE publish_attempts SET container_status=$2 WHERE job_id=$1',[job.id,state]);
    if(state==='IN_PROGRESS' && job.attempts<10){
      await db.query(`UPDATE scheduled_jobs SET status='queued',available_at=now()+interval '1 minute',
        locked_at=NULL,locked_by=NULL WHERE id=$1`,[job.id]);
      return false;
    }
    if(state!=='FINISHED'){await block('meta_container_not_ready');return false;}
    await db.query(`UPDATE publish_attempts SET publish_request_sent_at=clock_timestamp(),response_state='reconciling'
      WHERE job_id=$1 AND meta_container_id=$2`,[job.id,container]);
    return true;
  });
  if(!ready) return;
  await withTransaction(async db=>{
    const {item,attempt}=await check(db,job);
    if(!item) return;
    if(!attempt?.publish_request_sent_at || attempt.response_state!=='reconciling') return;
    let post;
    try { post=await transport.graph(item).publish(item.meta_account_id,attempt.meta_container_id); }
    catch { await uncertain(db,job);return; }
    if(!validId(post?.id)){await uncertain(db,job);return;}
    await db.query(`UPDATE publish_attempts SET actual_post_id=$2,response_state='confirmed_published' WHERE id=$1`,[attempt.id,post.id]);
    await db.query("UPDATE content_items SET status='published',updated_at=now() WHERE id=$1",[job.content_id]);
    await db.query("UPDATE scheduled_jobs SET status='succeeded',finished_at=now(),locked_at=NULL,locked_by=NULL WHERE id=$1",[job.id]);
    await scheduleInsights(db,job,attempt.id);
  });
}
