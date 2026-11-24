import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { query,withTransaction,closePool } from '../src/db.js';
import { stageMedia,runArchiveOnce,fileNameAt } from '../src/storage/archive.js';
import { GoogleDrive } from '../src/storage/drive.js';
import { generateImage } from '../src/services/ai-providers.js';

// Transport simulator only used within this isolated integration suite.
function simulatedDrive() {
  const objects=new Map([['root',{id:'real-root',mimeType:'application/vnd.google-apps.folder'}]]);
  const uploads=new Map();
  let lost=false;
  const request=async(input,options={})=>{
    const u=new URL(input);
    if(u.hostname==='oauth2.googleapis.com') return Response.json({access_token:'simulated',expires_in:3600});
    if(u.pathname.endsWith('/generateIds'))return Response.json({ids:[randomUUID()]});
    if(u.pathname.startsWith('/chunk/')){
      const id=u.pathname.slice(7), session=uploads.get(id);
      assert.equal(Number(options.headers['Content-Length']),options.body.length);
      session.blocks.push(options.body);
      const total=Number(options.headers['Content-Range'].split('/')[1]);
      const bytes=Buffer.concat(session.blocks);
      if(bytes.length<total)return new Response(null,{status:308,headers:{Range:'bytes=0-'+(bytes.length-1)}});
      assert.equal(bytes.length,total);
      const data={...session.meta,size:String(total),sha256Checksum:createHash('sha256').update(bytes).digest('hex')};
      objects.set(id,data);
      if(lost){lost=false;throw new Error('simulated_lost_ack');}
      return Response.json(data);
    }
    if(options.method==='POST'){
      const data=JSON.parse(options.body);
      if(objects.has(data.id))return new Response(null,{status:409});
      if(u.pathname.startsWith('/upload/')){
        uploads.set(data.id,{meta:data,blocks:[]});
        return new Response(null,{status:200,headers:{location:'https://www.googleapis.com/chunk/'+data.id}});
      }
      objects.set(data.id,data);return Response.json(data);
    }
    const data=objects.get(decodeURIComponent(u.pathname.split('/').pop()));
    return data?Response.json(data):new Response(null,{status:404});
  };
  const drive=new GoogleDrive({clientId:'test',clientSecret:'test',refreshToken:'test'},request);
  return {drive,objects,loseNextAck(){lost=true;}};
}
const created=[];
let spool;
test.before(async()=>{
  assert.equal((await query('SELECT current_database() db')).rows[0].db,'instaauto_test');
  spool=await mkdtemp(path.join(tmpdir(),'instaauto-archive-test-'));
  process.env.MEDIA_SPOOL_DIR=spool;
});
test.after(async()=>{
  if(spool){
    for(const id of created)await query('DELETE FROM ig_accounts WHERE id=$1',[id]);
    await query('DELETE FROM drive_destination WHERE singleton AND root_id=$1',[claimedRoot || '']);
    await rm(spool,{recursive:true,force:true});
  }
  await closePool();
});
let claimedRoot;
async function account(name,format) {
  const a=(await query('INSERT INTO ig_accounts(profile_handle) VALUES($1) RETURNING id',[name+randomUUID().slice(0,8)])).rows[0];
  created.push(a.id);
  a.version=await withTransaction(async db=>{
    const c=(await db.query('INSERT INTO content_items(account_id,final_format) VALUES($1,$2) RETURNING id',[a.id,format])).rows[0];
    return (await db.query("INSERT INTO content_versions(content_id,version,content_hash,title) VALUES($1,1,'test','서울 야경') RETURNING id",[c.id])).rows[0].id;
  });
  return a;
}
test('Drive protocol: folders by ID, KST titles, version slots, concurrent retries, lost acknowledgement, checksums and pause',async()=>{
  const {drive,objects,loseNextAck}=simulatedDrive();
  const a=await account('media_a','reel_mp4'),b=await account('media_b','feed_image');
  const date='2026-11-23T15:05:06Z';
  assert.equal(fileNameAt(date,'서울/야경','mp4'),'2026-11-24_00-05-06_서울 야경.mp4');
  const clip=Buffer.alloc(8*1024*1024+12,17);
  const payload=(slot,bytes=clip)=>({versionId:a.version,slot,mime:'video/mp4',generatedAt:date,stream:Readable.from([bytes])});
  const [record,duplicate]=await Promise.all([stageMedia(payload('clip')),stageMedia(payload('clip'))]);
  assert.equal(record.id,duplicate.id);
  await assert.rejects(stageMedia(payload('clip',Buffer.from('different'))),/media_slot_already_used/);
  const second=await stageMedia(payload('another',Buffer.from('another')));
  assert.equal(second.filename,'2026-11-24_00-05-06_서울 야경_01.mp4');
  await stageMedia({versionId:b.version,slot:'cover',mime:'image/png',stream:Readable.from([Buffer.from('cover')])});
  for(let i=0;i<6;i++)await runArchiveOnce(drive);
  claimedRoot=(await query('SELECT root_id FROM drive_destination')).rows[0].root_id;
  const folders=(await query("SELECT * FROM account_media_folders WHERE account_id=ANY($1)",[[a.id,b.id]])).rows;
  assert.equal(folders.length,6);
  assert.equal(new Set(folders.map(f=>f.remote_folder_id)).size,6);
  const target=folders.find(f=>f.account_id===a.id&&f.kind==='reels');
  const stored=(await query('SELECT * FROM storage_uploads WHERE id=$1',[record.id])).rows[0];
  assert.equal(stored.state,'verified');assert.deepEqual(objects.get(stored.remote_file_id).parents,[target.remote_folder_id]);
  await query("UPDATE ig_accounts SET profile_handle=$2 WHERE id=$1",[a.id,'renamed'+randomUUID().slice(0,8)]);
  await query('UPDATE drive_folder_work SET ready=false WHERE account_id=$1',[a.id]);
  const ack=await stageMedia(payload('lost',Buffer.from('ack')));
  loseNextAck();await runArchiveOnce(drive);
  const first=(await query('SELECT * FROM storage_uploads WHERE id=$1',[ack.id])).rows[0];
  assert.equal(first.state,'retryable_error');assert.ok(objects.has(first.remote_file_id));
  await query('UPDATE storage_uploads SET retry_at=now() WHERE id=$1',[ack.id]);
  await query('UPDATE system_controls SET emergency_paused=true');
  try {assert.equal(await runArchiveOnce(drive),false);} finally {await query('UPDATE system_controls SET emergency_paused=false');}
  await Promise.all([runArchiveOnce(drive),runArchiveOnce(drive)]);
  const recovered=(await query('SELECT * FROM storage_uploads WHERE id=$1',[ack.id])).rows[0];
  assert.equal(recovered.state,'verified');assert.equal(recovered.remote_file_id,first.remote_file_id);
  assert.equal((await query('SELECT count(*)::int n FROM backup_records WHERE asset_id=$1',[ack.asset_id])).rows[0].n,1);
  assert.equal([...objects.values()].filter(o=>o.appProperties?.instaauto===a.id+':account').length,1);
});
test('image generation archives returned bytes once; configured non-OpenAI provider never sends its credential to OpenAI',async()=>{
  const a=await account('generated','feed_image');
  const model='archive-test-'+randomUUID();
  const old=globalThis.fetch;
  let calls=0;
  const key='ARCHIVE_TEST_IMAGE_KEY';process.env[key]='isolated-test-value';
  await query(`INSERT INTO provider_settings(stage,provider,model,secret_ref,options) VALUES('image','openai',$1,$2,'{"max_cost_per_image":1}')`,[model,key]);
  await query("INSERT INTO monthly_budgets(month_start,provider,model,limit_amount) VALUES(date_trunc('month',now())::date,'openai',$1,5)",[model]);
  try {
    globalThis.fetch=async(url)=>{assert.equal(url,'https://api.openai.com/v1/images/generations');calls++;return Response.json({data:[{b64_json:Buffer.from('test-image').toString('base64')}]});};
    const args={prompt:'test',accountId:a.id,contentVersionId:a.version,title:'시험'};
    await Promise.allSettled([generateImage(args),generateImage(args)]);await generateImage(args);
    assert.equal(calls,1);
    const row=(await query("SELECT state FROM storage_uploads WHERE account_id=$1",[a.id])).rows[0];
    assert.equal(row.state,'pending');
    await query("UPDATE provider_settings SET provider='different' WHERE stage='image'");
    const b=await account('alternate','feed_image');
    await assert.rejects(generateImage({...args,accountId:b.id,contentVersionId:b.version}),/image_adapter_unavailable/);
    assert.equal(calls,1);
  } finally {
    globalThis.fetch=old;delete process.env[key];
    await query("DELETE FROM provider_settings WHERE stage='image' AND model=$1",[model]);
    await query('DELETE FROM usage_events WHERE model=$1',[model]);await query('DELETE FROM monthly_budgets WHERE model=$1',[model]);
  }
});

test('worker composes a playable H.264 and AAC reel from staged assets, burns captions and reuses the same render job',async()=>{
  const {execFile}=await import('node:child_process');
  const {promisify}=await import('node:util');
  const {writeFile,readFile}=await import('node:fs/promises');
  const {queueRender}=await import('../src/services/render-reel.js');
  const {runRenderOnce}=await import('../src/queue/engine.js');
  const exec=promisify(execFile);
  const work=await mkdtemp(path.join(tmpdir(),'archive-render-inputs-'));
  try {
    const accountA=await account('render','reel_mp4');
    const accountB=await account('other','reel_mp4');
    const fixture=async(version,slot,name,mime)=>stageMedia({versionId:version,slot,mime,stream:Readable.from([await readFile(path.join(work,name))])});
    await exec('ffmpeg',['-loglevel','error','-f','lavfi','-i','color=c=black:s=320x480','-frames:v','1','-threads','1','scene.png'],{cwd:work});
    await exec('ffmpeg',['-loglevel','error','-f','lavfi','-i','sine=frequency=400:duration=1','tone.wav'],{cwd:work});
    await writeFile(path.join(work,'captions.srt'),'1\n00:00:00,000 --> 00:00:01,000\n서울 야경\n');
    const image=await fixture(accountA.version,'image','scene.png','image/png');
    const audio=await fixture(accountA.version,'music','tone.wav','audio/wav');
    const subtitle=await fixture(accountA.version,'captions','captions.srt','application/x-subrip');
    const inputs={picture:image.asset_id,music:audio.asset_id,captions:subtitle.asset_id,seconds:1};
    await assert.rejects(queueRender(accountB.version,inputs),/invalid_reel_inputs/);
    const job=await queueRender(accountA.version,inputs);
    assert.equal((await queueRender(accountA.version,inputs)).id,job.id);
    assert.equal(await runRenderOnce('qa-render-worker'),true);
    const out=await query('SELECT filename,content_sha256 FROM storage_uploads WHERE idempotency_key=$1',[accountA.version+'/render-'+job.id]);
    assert.equal(out.rowCount,1);
    const media=path.join(spool,out.rows[0].content_sha256);
    const probe=await exec('ffprobe',['-v','error','-show_streams','-show_format','-of','json',media]);
    const parsed=JSON.parse(probe.stdout);
    assert.deepEqual(parsed.streams.map(x=>x.codec_name),['h264','aac']);
    assert.deepEqual([parsed.streams[0].width,parsed.streams[0].height],[720,1280]);
    assert.equal(Number(parsed.format.duration),1);
    await exec('ffmpeg',['-loglevel','error','-i',media,'-f','null','-']);
    const {stdout:frame}=await exec('ffmpeg',['-loglevel','error','-ss','0.5','-i',media,'-frames:v','1','-pix_fmt','gray','-f','rawvideo','-'],{encoding:'buffer',maxBuffer:2*1024*1024});
    assert.ok(frame.some(v=>v>150),'bright subtitles visible on the otherwise black frame');
    await exec('ffmpeg',['-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x240:d=0.5','-threads','1','clip.mp4'],{cwd:work});
    const clip=await fixture(accountA.version,'clip','clip.mp4','video/mp4');
    const clipJob=await queueRender(accountA.version,{...inputs,picture:clip.asset_id,captions:null});
    await runRenderOnce('qa-render-worker');
    const clipOutput=await query('SELECT content_sha256 FROM storage_uploads WHERE idempotency_key=$1',[accountA.version+'/render-'+clipJob.id]);
    await exec('ffmpeg',['-loglevel','error','-i',path.join(spool,clipOutput.rows[0].content_sha256),'-f','null','-']);
  } finally { await rm(work,{recursive:true,force:true}); }
});
test('a background image job uses the saved account guidelines; repeated clicks produce one file',async()=>{
  const {queueImage}=await import('../src/services/image-jobs.js');
  const {claimJobs,processClaimedJob}=await import('../src/queue/engine.js');
  const {registerProvider}=await import('../src/providers/registry.js');
  const a=await account('image-worker','feed_image');
  let calls=0;
  registerProvider('offline-image',{image:async({prompt})=>{
    assert.match(prompt,/이 계정 전용/);calls++;
    return {bytes:Buffer.from('test-bytes'),mime:'image/jpeg'};
  }});
  const key='IMAGE_WORKER_ISOLATED_TEST';process.env[key]='offline';
  await query("UPDATE content_versions SET caption='본문',editorial_snapshot=$2 WHERE id=$1",[a.version,{editorial:{feed:'이 계정 전용'}}]);
  await query("INSERT INTO provider_settings(stage,provider,model,secret_ref,options) VALUES('image','offline-image','local-model',$1,$2)",[key,{max_cost_per_image:1}]);
  await query("INSERT INTO monthly_budgets(month_start,provider,model,limit_amount) VALUES(date_trunc('month',now())::date,'offline-image','local-model',5)");
  try{
    const first=await queueImage(a.version);const again=await queueImage(a.version);
    assert.equal(again.id,first.id);
    const [job]=await claimJobs('image-test',1); assert.equal(job.id,first.id);
    await processClaimedJob(job);
    assert.equal((await queueImage(a.version)).status,'succeeded');
    assert.equal(calls,1);
    assert.equal((await query("SELECT count(*)::int n FROM storage_uploads WHERE account_id=$1",[a.id])).rows[0].n,1);
  }finally{
    delete process.env[key];
    await query("DELETE FROM provider_settings WHERE provider='offline-image'");
  }
});
