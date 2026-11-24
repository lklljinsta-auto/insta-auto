import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { query, closePool } from '../src/db.js';
import { createApiRouter } from '../src/routes/api.js';
import { claimJobs, runOnce } from '../src/queue/engine.js';

let server, origin, accountId, operatorId;
const post = async (url,body) => {
  const response=await fetch(origin+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:response.status,data:await response.json()};
};
before(async()=>{
  assert.match(process.env.DATABASE_URL||'',/\/instaauto_test$/);
  assert.equal((await query('SELECT current_database() AS name')).rows[0].name,'instaauto_test');
  operatorId=(await query("INSERT INTO operators(email,password_hash) VALUES('policy@localhost','test-only') RETURNING id")).rows[0].id;
  accountId=(await query("INSERT INTO ig_accounts(profile_handle) VALUES('scheduled_test') RETURNING id")).rows[0].id;
  const app=express();
  app.use(express.json(),createApiRouter((req,res,next)=>{req.admin={id:operatorId};next();}));
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});
  origin='http://127.0.0.1:'+server.address().port;
});
after(async()=>{
  if(server) await new Promise(resolve=>server.close(resolve));
  if(accountId) await query('DELETE FROM ig_accounts WHERE id=$1',[accountId]);
  if(operatorId) await query('DELETE FROM operators WHERE id=$1',[operatorId]);
  await closePool();
});
test('parallel saves of equivalent nested policies create one version and one audit event',async()=>{
  const route='/accounts/'+accountId+'/policy';
  const results=await Promise.all([
    post(route,{policy:{days:[1,2],limits:{min:1,max:3}}}),
    post(route,{policy:{limits:{max:3,min:1},days:[1,2]}})
  ]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
  assert.equal(results[0].data.id,results[1].data.id);
  const audit=await query("SELECT count(*)::int AS n FROM audit_events WHERE account_id=$1 AND event_type='account_policy_version_created'",[accountId]);
  assert.equal(audit.rows[0].n,1);
  const changed=await post(route,{policy:{limits:{min:1,max:4},days:[1,2]}});
  assert.equal(changed.data.version,2);
});
test('invalid schedule leaves the draft unapproved',async()=>{
  const {data,status}=await post('/contents',{accountId,manual:true,finalFormat:'feed_image'});
  assert.equal(status,201);
  const res=await post('/contents/'+data.content.id+'/approve',{scheduledAt:'invalid'});
  assert.equal(res.status,409);
  const record=await query('SELECT status,approved_at FROM content_items JOIN content_versions ON content_id=content_items.id WHERE content_id=$1',[data.content.id]);
  assert.deepEqual(record.rows[0],{status:'manual',approved_at:null});
});
test('a future manual draft is queued once, runs only when due, and cannot be rearmed after an unknown result',async()=>{
  const when=new Date(Date.now()+90*86400000).toISOString();
  const {data,status}=await post('/contents',{accountId,manual:true,finalFormat:'feed_image',scheduledAt:when});
  assert.equal(status,201);
  const url='/contents/'+data.content.id+'/approve';
  assert.equal((await post(url,{scheduledAt:when})).status,409);
  await query("INSERT INTO media_assets(content_version_id,object_store,object_key,mime_type,size_bytes,sha256) VALUES($1,'archive_spool',$2,'image/jpeg',10,$3)",[data.version.id,data.version.id+'/test','a'.repeat(64)]);
  const approved=await Promise.all([post(url,{scheduledAt:when}),post(url,{scheduledAt:when})]);
  for(const result of approved){assert.equal(result.status,200);assert.equal(result.data.jobId,data.jobId);}
  const row=async()=> (await query('SELECT status,attempts,scheduled_at FROM scheduled_jobs WHERE id=$1',[data.jobId])).rows[0];
  assert.equal((await row()).status,'queued');
  assert.deepEqual(await claimJobs('early-worker',1),[]);
  assert.equal((await row()).attempts,0);
  assert.equal((await post(url,{scheduledAt:new Date().toISOString()})).status,409);
  assert.equal((await row()).scheduled_at.toISOString(),when);
  await query("UPDATE scheduled_jobs SET scheduled_at=now()-interval '1 second' WHERE id=$1",[data.jobId]);
  const [first,second]=await Promise.all([runOnce('worker-a',1),runOnce('worker-b',1)]);
  assert.equal(first.claimed+second.claimed,1);
  assert.equal((await row()).attempts,1);
  assert.equal((await row()).status,'held');
  const resume='/jobs/'+data.jobId+'/resume-reviewed';
  assert.equal((await post(resume,{})).status,409);
  await query('UPDATE ig_accounts SET publishing_enabled=true WHERE id=$1',[accountId]);
  assert.equal((await post(resume,{})).status,200);
  assert.equal((await row()).status,'queued');
  assert.equal((await post(resume,{})).status,409);
  await query("UPDATE scheduled_jobs SET status='unknown_result' WHERE id=$1",[data.jobId]);
  assert.equal((await post(url,{scheduledAt:when})).status,409);
  assert.equal((await row()).status,'unknown_result');
  assert.equal((await post(resume,{})).status,409);
});
test('concurrent approval and cancellation leave one cancelled reservation',async()=>{
  const scheduledAt=new Date(Date.now()+86400000).toISOString();
  const {data}=await post('/contents',{accountId,manual:true,finalFormat:'feed_image',scheduledAt});
  const {cancelJob}=await import('../src/queue/engine.js');
  const [approved,cancelled]=await Promise.all([
    post('/contents/'+data.content.id+'/approve',{scheduledAt}),
    cancelJob(data.jobId)
  ]);
  assert.ok([200,409].includes(approved.status));
  assert.equal(cancelled.status,'cancelled');
  const state=await query('SELECT j.status AS job,c.status AS content FROM scheduled_jobs j JOIN content_items c ON c.id=j.content_id WHERE j.id=$1',[data.jobId]);
  assert.deepEqual(state.rows[0],{job:'cancelled',content:'cancelled'});
});
