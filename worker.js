import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { closePool, query } from './src/db.js';
import { recoverAbandonedJobs, runOnce, runRenderOnce } from './src/queue/engine.js';
import { runArchiveOnce } from './src/storage/archive.js';
import { connectedDrive } from './src/storage/authorization.js';

if (Number(process.env.DB_POOL_SIZE || 8) < 2) {
  throw new Error('DB_POOL_SIZE must be at least 2 for the independent render slot');
}
const workerId = 'instaauto-worker-' + process.pid + '-' + crypto.randomBytes(3).toString('hex');
const concurrency = Math.max(1,Math.min(4,Number(process.env.WORKER_CONCURRENCY||2)));
const pollMs = Math.max(250,Number(process.env.WORKER_POLL_MS||5000));
const stop = new AbortController();
let nextRecovery = 0;
async function tickQueue() {
  if (Date.now() >= nextRecovery) {
    await recoverAbandonedJobs();
    nextRecovery = Date.now() + 60000;
  }
  const result = await runOnce(workerId,concurrency);
  if (result.claimed) console.log(JSON.stringify({workerId,...result}));
  return false;
}
async function loop(tick, name) {
  while (!stop.signal.aborted) {
    let busy = false;
    try { busy = await tick(); }
    catch(e) { console.error(JSON.stringify({workerId,event:name+'_error',code:e.code||'unknown'})); }
    if (!busy) await delay(pollMs,undefined,{signal:stop.signal}).catch(()=>{});
  }
}
process.once('SIGINT',()=>stop.abort());
process.once('SIGTERM',()=>stop.abort());
await Promise.all([loop(tickQueue,'queue'),loop(()=>runRenderOnce(workerId),'render'),loop(async()=>runArchiveOnce(await connectedDrive()),'archive')]);
await query('DELETE FROM worker_heartbeats WHERE worker_id=$1',[workerId]).catch(()=>{});
await closePool();
