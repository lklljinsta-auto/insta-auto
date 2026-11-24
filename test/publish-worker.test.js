import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {query,closePool,withTransaction} from '../src/db.js';
import {processClaimedJob} from '../src/queue/engine.js';

let appId;
before(async()=>{
  assert.match(process.env.DATABASE_URL||'',/\/instaauto_test$/);
  appId=(await query("INSERT INTO meta_apps(app_id,display_name,redirect_uri,enabled) VALUES($1,'test','https://example.invalid/cb',true) RETURNING id",[randomUUID()])).rows[0].id;
});
after(async()=>{await closePool();});
async function approvedJob(){
  return withTransaction(async db=>{
    const id=async(sql,args)=> (await db.query(sql+' RETURNING id',args)).rows[0].id;
    const account=await id("INSERT INTO ig_accounts(meta_account_id,connection_status,publishing_enabled) VALUES($1,'connected',true)",[String(Date.now())+String(process.hrtime.bigint())]);
    const remote=(await db.query('SELECT meta_account_id FROM ig_accounts WHERE id=$1',[account])).rows[0].meta_account_id;
    const grant=await id("INSERT INTO oauth_grants(meta_app_id,encrypted_token,token_key_version,token_type,granted_scopes) VALUES($1,'offline','test','test',$2::jsonb)",[appId,JSON.stringify(['instagram_content_publish'])]);
    await db.query('INSERT INTO grant_accounts(grant_id,account_id,meta_account_id) VALUES($1,$2,$3)',[grant,account,remote]);
    await db.query('INSERT INTO account_oauth_connections(account_id,grant_id,meta_app_id) VALUES($1,$2,$3)',[account,grant,appId]);
    const content=await id("INSERT INTO content_items(account_id,final_format,status) VALUES($1,'feed_image','scheduled')",[account]);
    const version=await id("INSERT INTO content_versions(content_id,version,content_hash,approved_at) VALUES($1,1,'test',now())",[content]);
    const asset=await id("INSERT INTO media_assets(content_version_id,object_store,object_key,mime_type,size_bytes,sha256) VALUES($1,'archive_spool',$2,'image/jpeg',10,$3)",[version,randomUUID(),'a'.repeat(64)]);
    await db.query('UPDATE content_versions SET publish_asset_id=$2 WHERE id=$1',[version,asset]);
    return (await db.query(`INSERT INTO scheduled_jobs(account_id,content_id,content_version_id,kind,status,scheduled_at,locked_by,locked_at,attempts,idempotency_key)
      VALUES($1,$2,$3,'publish','running',now(),'test-worker',now(),1,$4) RETURNING *`,[account,content,version,randomUUID()])).rows[0];
  });
}
const state=async job=>(await query('SELECT status FROM scheduled_jobs WHERE id=$1',[job.id])).rows[0].status;
function simulator(send) {
  return {url:async()=> 'https://example.invalid/local-test',graph:()=>({
    create:async()=>({id:'123'}),status:async()=>({status_code:'FINISHED'}),publish:send
  })};
}
test('two concurrent deliveries of one claim make at most one final publish',async()=>{
  const job=await approvedJob();let sends=0;
  const mock=simulator(async()=>{sends++;return {id:'456'};});
  await Promise.all([processClaimedJob(job,mock),processClaimedJob(job,mock)]);
  assert.equal(sends,1);
  assert.equal(await state(job),'succeeded');
});
test('confirmed publication records the remote post ID',async()=>{
  const job=await approvedJob();
  await processClaimedJob(job,simulator(async()=>({id:'789'})));
  assert.equal(await state(job),'succeeded');
  assert.equal((await query('SELECT actual_post_id FROM publish_attempts WHERE job_id=$1',[job.id])).rows[0].actual_post_id,'789');
});
test('lost response never resends a publish, including replay by old worker',async()=>{
  const job=await approvedJob();let sends=0;
  const mock=simulator(async()=>{sends++;throw Error('lost');});
  await processClaimedJob(job,mock);await processClaimedJob(job,mock);
  assert.equal(await state(job),'unknown_result');assert.equal(sends,1);
});
test('a stale worker attempt cannot acquire the final publishing lock',async()=>{
  const job=await approvedJob();let sends=0;
  await processClaimedJob({...job,attempts:0},simulator(async()=>{sends++;}));
  assert.equal(await state(job),'running');assert.equal(sends,0);
});
test('pause requested during preparation takes effect before final publish',async()=>{
  const job=await approvedJob();
  const {pool}=await import('../src/db.js');
  const control=await pool.connect();let pausing,sends=0;
  const {rows:[{pid}]}=await control.query('SELECT pg_backend_pid() AS pid');
  const mock=simulator(async()=>{sends++;return {id:'700'};});
  const api=mock.graph();
  api.status=async()=>{
    pausing=control.query('UPDATE system_controls SET emergency_paused=true WHERE singleton');
    for(let i=0;i<100;i++){
      if((await query('SELECT cardinality(pg_blocking_pids($1)) AS blockers',[pid])).rows[0].blockers) return {status_code:'FINISHED'};
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    throw Error('pause did not reach the worker lock');
  };
  try{
    await processClaimedJob(job,{url:mock.url,graph:()=>api});
    await pausing;
    assert.equal(sends,0);
    assert.equal(await state(job),'held');
  }finally{
    if(pausing) await pausing;
    await control.query('UPDATE system_controls SET emergency_paused=false WHERE singleton');
    control.release();
  }
});
async function metricsJob(metrics,scopes=['instagram_manage_insights']){
  const job=await approvedJob();
  await query('UPDATE oauth_grants SET granted_scopes=$2::jsonb WHERE id=(SELECT grant_id FROM account_oauth_connections WHERE account_id=$1)',
    [job.account_id,JSON.stringify(['instagram_content_publish',...scopes])]);
  await query('INSERT INTO account_insight_settings VALUES($1,120,$2)',[job.account_id,metrics]);
  await processClaimedJob(job,simulator(async()=>({id:'890'})));
  const {rows:[scheduled]}=await query("SELECT *,scheduled_at>now()+interval '119 minutes' AS waited FROM scheduled_jobs WHERE account_id=$1 AND kind='collect_metrics'",[job.account_id]);
  assert.equal(scheduled.waited,true);
  return (await query("UPDATE scheduled_jobs SET scheduled_at=now(),status='running',locked_by='insights-test',attempts=1 WHERE id=$1 RETURNING *",[scheduled.id])).rows[0];
}
const {collectPostInsights}=await import('../src/services/post-insights.js');
test('scheduled collection preserves measured zero, records one snapshot even on replay',async()=>{
  const job=await metricsJob(['reach']);
  let calls=0;
  const read=async(item,key)=>{assert.equal(item.actual_post_id,'890');calls++;return {http:200,body:{data:[{name:key,period:'lifetime',values:[{value:0}]}]}};};
  await Promise.all([collectPostInsights(job,read),collectPostInsights(job,read)]);
  assert.equal(calls,1);
  assert.equal(await state(job),'succeeded');
  const {rows}=await query('SELECT metric_value,data_status FROM metric_snapshots WHERE account_id=$1',[job.account_id]);
  assert.deepEqual(rows,[{metric_value:'0',data_status:'actual_value'}]);
});
test('empty, denied and failed readings record distinct reasons and block follow-up',async()=>{
  const job=await metricsJob(['reach','saved','shares']);
  await collectPostInsights(job,async(_,key)=>{
    if(key==='shares') throw Error('timeout');
    return key==='reach'?{http:200,body:{data:[]}}:{http:403,body:{}};
  });
  assert.equal(await state(job),'held');
  const {rows}=await query('SELECT metric_value,data_status FROM metric_snapshots WHERE account_id=$1 ORDER BY metric_key',[job.account_id]);
  assert.deepEqual(rows.map(x=>x.data_status),['not_collected','unavailable','collection_error']);
  assert.ok(rows.every(x=>x.metric_value===null));
  const d=await query('SELECT action FROM decisions WHERE account_id=$1',[job.account_id]);
  assert.deepEqual(d.rows,[{action:'blocked'}]);
  assert.equal((await query("SELECT 1 FROM scheduled_jobs WHERE account_id=$1 AND kind='publish'",[job.account_id])).rowCount,1);
});
test('missing insights scope prevents even a read request',async()=>{
  const job=await metricsJob(['saved'],[]);
  let calls=0;await collectPostInsights(job,async()=>{calls++;});
  assert.equal(calls,0);assert.equal(await state(job),'held');
});

test('five accounts keep sources, files and schedules separate when one is paused',async()=>{
  const {stageMedia}=await import('../src/storage/archive.js');
  const {Readable}=await import('node:stream');
  const jobs=[];
  for(let i=0;i<5;i++){
    const job=await approvedJob();
    const source='https://source.invalid/article/'+i;
    const {rows:[input]}=await query("INSERT INTO source_items(account_id,canonical_url,external_key) VALUES($1,$2,$2) RETURNING id",[job.account_id,source]);
    await query('UPDATE content_items SET source_item_id=$2 WHERE id=$1',[job.content_id,input.id]);
    const staged=await stageMedia({versionId:job.content_version_id,slot:'final',title:'원고 '+i,mime:'image/jpeg',
      stream:Readable.from([Buffer.from('isolated-worker-test-'+i)]),generatedAt:new Date('2026-11-23T15:05:00Z')});
    assert.equal(staged.filename,'2026-11-24_00-05-00_원고 '+i+'.jpg');
    await query('UPDATE content_versions SET publish_asset_id=$2,caption=$3 WHERE id=$1',[job.content_version_id,staged.asset_id,source]);
    await query("UPDATE scheduled_jobs SET scheduled_at=now()-make_interval(mins=>$2) WHERE id=$1",[job.id,i+1]);
    jobs.push({...job,source,asset:staged.asset_id});
  }
  await query("UPDATE ig_accounts SET automation_mode='paused' WHERE id=$1",[jobs[0].account_id]);
  const calls=new Map();
  const transport={url:async item=>{
    const expected=jobs.find(j=>j.account_id===item.account_id);
    assert.equal(item.id,expected.asset);assert.equal(item.caption,expected.source);
    return 'https://media.invalid/'+expected.asset;
  },graph:item=>({create:async()=>({id:'500'}),status:async()=>({status_code:'FINISHED'}),
    publish:async()=>{calls.set(item.account_id,(calls.get(item.account_id)||0)+1);return {id:item.meta_account_id};}})};
  for(const job of jobs) await processClaimedJob(job,transport);
  for(const [i,job] of jobs.entries()){
    assert.equal(await state(job),i===0?'held':'succeeded');
    assert.equal(calls.get(job.account_id)??0,i===0?0:1);
  }
});
