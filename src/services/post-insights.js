import {Router} from 'express';
import {decryptSecret,query,withTransaction} from '../db.js';

const supported=new Set(['reach','saved','shares']);
export function insightSettingsRouter(){
  const r=Router();
  r.get('/accounts/:id/insights',async(req,res)=>{
    const {rows}=await query(`SELECT s.delay_minutes,s.metrics FROM ig_accounts a LEFT JOIN account_insight_settings s
      ON a.id=s.account_id WHERE a.id=$1`,[req.params.id]);
    if(!rows.length) return res.status(404).json({error:'account_not_found'});
    res.json(rows[0]);
  });
  r.put('/accounts/:id/insights',async(req,res)=>{
    const {delayMinutes,metrics,enabled}=req.body||{};
    if(typeof enabled!=='boolean' || (enabled && (!Number.isSafeInteger(delayMinutes) || delayMinutes<1 ||
        delayMinutes>2147483647 || !Array.isArray(metrics) || !metrics.length ||
        metrics.some(key=>!supported.has(key))))) return res.status(400).json({error:'invalid_insights_settings'});
    const saved=await withTransaction(async db=>{
      const account=await db.query('SELECT id FROM ig_accounts WHERE id=$1 FOR UPDATE',[req.params.id]);
      if(!account.rowCount) return false;
      if(enabled){
        await db.query(`INSERT INTO account_insight_settings VALUES($1,$2,$3) ON CONFLICT(account_id)
          DO UPDATE SET delay_minutes=EXCLUDED.delay_minutes,metrics=EXCLUDED.metrics`,[req.params.id,delayMinutes,[...new Set(metrics)]]);
      }else await db.query('DELETE FROM account_insight_settings WHERE account_id=$1',[req.params.id]);
      await db.query(`INSERT INTO audit_events(operator_id,account_id,event_type,details)
        VALUES($1,$2,'insight_settings_updated',$3)`,[req.admin.id,req.params.id,enabled?{enabled,delayMinutes,metrics}:{enabled}]);
      return true;
    });
    res.status(saved?200:404).json(saved?{saved:true}:{error:'account_not_found'});
  });
  return r;
}
export async function scheduleInsights(db,publish,attemptId){
  const {rows:[settings]}=await db.query('SELECT * FROM account_insight_settings WHERE account_id=$1',[publish.account_id]);
  if(!settings) return;
  const {rows:[job]}=await db.query(`INSERT INTO scheduled_jobs(account_id,content_id,content_version_id,kind,
    scheduled_at,account_timezone,idempotency_key) VALUES($1,$2,$3,'collect_metrics',clock_timestamp()+$4*interval '1 minute',$5,$6)
    ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING id`,
    [publish.account_id,publish.content_id,publish.content_version_id,settings.delay_minutes,publish.account_timezone,'insights:'+attemptId]);
  await db.query('INSERT INTO post_insight_jobs VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[job.id,attemptId,settings.metrics]);
}
async function fetchInsight(item,metric){
  const version=process.env.META_GRAPH_VERSION;
  if(process.env.META_INSIGHTS_ENABLED!=='true' || !/^v\d+\.\d+$/.test(version||'')) return {status:'api_unconnected'};
  const origin=item.login_mode==='instagram_login'?'https://graph.instagram.com':'https://graph.facebook.com';
  const url=new URL(version+'/'+item.actual_post_id+'/insights',origin);
  url.searchParams.set('metric',metric);
  const response=await fetch(url,{headers:{Authorization:'Bearer '+decryptSecret(item.encrypted_token)},redirect:'error',signal:AbortSignal.timeout(12000)});
  return {http:response.status,body:await response.json()};
}
function decode(result,metric){
  if(result.status==='api_unconnected') return {status:'api_unconnected'};
  const code=result.body?.error?.code;
  if(result.http===403 || (result.http===400 && [10,100,200].includes(code))) return {status:'unavailable',http:result.http,code};
  if(result.http!==200 || !Array.isArray(result.body?.data)) return {status:'collection_error',http:result.http};
  const field=result.body.data.find(row=>row?.name===metric && row.period==='lifetime');
  const value=field?.values?.length===1?field.values[0]?.value:field?.total_value?.value;
  if(!Number.isSafeInteger(value)||value<0) return {status:'not_collected'};
  return {status:'actual_value',value};
}
export async function collectPostInsights(job,read=fetchInsight){
  return withTransaction(async db=>{
    const {rows:[j]}=await db.query(`SELECT * FROM scheduled_jobs WHERE id=$1 AND kind='collect_metrics'
      AND status='running' AND locked_by=$2 AND attempts=$3 FOR UPDATE`,[job.id,job.locked_by,job.attempts]);
    if(!j) return;
    const finish=async(status,reason)=>db.query(`UPDATE scheduled_jobs SET status=$2,hold_reason=$3,
      finished_at=clock_timestamp(),locked_at=NULL,locked_by=NULL WHERE id=$1`,[j.id,status,reason]);
    const {rows:[control]}=await db.query('SELECT emergency_paused FROM system_controls WHERE singleton FOR SHARE');
    if(control?.emergency_paused!==false) return finish('held','emergency_pause');
    const {rows:[spec]}=await db.query(`SELECT s.metrics,p.actual_post_id FROM post_insight_jobs s
      JOIN publish_attempts p ON p.id=s.publish_attempt_id AND p.response_state='confirmed_published'
      JOIN scheduled_jobs source ON source.id=p.job_id AND source.account_id=$2 AND source.content_id=$3
      AND source.content_version_id=$4 AND source.status='succeeded' WHERE s.job_id=$1`,
      [j.id,j.account_id,j.content_id,j.content_version_id]);
    if(!spec || !/^\d+$/.test(spec.actual_post_id||'')) return finish('held','published_post_not_verified');
    const {rows:[item]}=await db.query(`SELECT a.automation_mode,m.login_mode,g.encrypted_token,g.granted_scopes
      FROM ig_accounts a JOIN account_oauth_connections x ON x.account_id=a.id
      JOIN grant_accounts ga ON ga.account_id=a.id AND ga.grant_id=x.grant_id AND ga.meta_account_id=a.meta_account_id
      JOIN oauth_grants g ON g.id=x.grant_id AND g.meta_app_id=x.meta_app_id
      JOIN meta_apps m ON m.id=x.meta_app_id WHERE a.id=$1 AND a.connection_status='connected' AND m.enabled
      AND g.status='active' AND (g.expires_at IS NULL OR g.expires_at>now()) FOR SHARE OF a,x,ga,g,m`,[j.account_id]);
    if(item?.automation_mode==='paused') return finish('held','account_paused');
    const scope=item?.login_mode==='instagram_login'?'instagram_business_manage_insights':'instagram_manage_insights';
    const authorized=item?.granted_scopes?.some(s=>s===scope || (s?.permission===scope && s.status==='granted'));
    const evidence={};
    for(const key of spec.metrics){
      let snapshot={status:item?'unavailable':'api_unconnected'};
      if(authorized && supported.has(key)){
        try{snapshot=decode(await read({...item,actual_post_id:spec.actual_post_id},key),key);}
        catch{snapshot={status:'collection_error'};}
      }
      evidence[key]=snapshot;
      await db.query(`INSERT INTO metric_snapshots(account_id,content_id,metric_key,metric_value,data_status,source,sample_count,raw_snapshot)
        VALUES($1,$2,$3,$4,$5,'meta_media_insights',$6,$7)`,
        [j.account_id,j.content_id,key,snapshot.value??null,snapshot.status,snapshot.status==='actual_value'?1:0,{postId:spec.actual_post_id,...snapshot}]);
    }
    if(Object.values(evidence).every(s=>s.status==='actual_value')) return finish('succeeded',null);
    await db.query(`INSERT INTO decisions(account_id,content_id,evidence,action,reason)
      VALUES($1,$2,$3,'blocked','incomplete_post_insights')`,[j.account_id,j.content_id,{jobId:j.id,postId:spec.actual_post_id,metrics:evidence}]);
    return finish('held','incomplete_post_insights');
  });
}
