import { adapterFor } from '../providers/registry.js';
import { Readable } from 'node:stream';
import { stageMedia } from '../storage/archive.js';
import { query, withTransaction } from '../db.js';
const stages=new Set(['source_analysis','caption','image','video','audio','storage']);
const defaultModels={caption:process.env.OPENAI_TEXT_MODEL||'gpt-4.1-mini',image:process.env.OPENAI_IMAGE_MODEL};
export async function listProviderSettings(){const r=await query('SELECT stage,provider,model,secret_ref,options,updated_at FROM provider_settings ORDER BY stage');return r.rows.map(x=>({...x,configured:Boolean(x.secret_ref&&process.env[x.secret_ref])}));}
export async function setProviderSetting({stage,provider,model,secretRef,options={}}){if(!stages.has(stage))throw Object.assign(new Error('invalid_stage'),{status:400,publicCode:'invalid_provider_stage'});if(!/^[a-z][a-z0-9_-]{1,40}$/i.test(provider))throw Object.assign(new Error('invalid_provider'),{status:400,publicCode:'invalid_provider'});if(secretRef&&!/^[A-Z][A-Z0-9_]{0,127}$/.test(secretRef))throw Object.assign(new Error('invalid_secret_ref'),{status:400,publicCode:'invalid_secret_reference'});const r=await query(`INSERT INTO provider_settings(stage,provider,model,secret_ref,options) VALUES($1,$2,NULLIF($3,''),NULLIF($4,''),$5::jsonb) ON CONFLICT(stage) DO UPDATE SET provider=EXCLUDED.provider,model=EXCLUDED.model,secret_ref=EXCLUDED.secret_ref,options=EXCLUDED.options,updated_at=now() RETURNING stage,provider,model,secret_ref,options,updated_at`,[stage,provider,model||'',secretRef||'',JSON.stringify(options)]);return {...r.rows[0],configured:Boolean(secretRef&&process.env[secretRef])};}
async function stageConfig(stage){const r=await query('SELECT * FROM provider_settings WHERE stage=$1',[stage]);if(r.rowCount)return r.rows[0];if(stage==='image')return {stage,provider:'openai',model:defaultModels.image,secret_ref:'OPENAI_API_KEY'};if(stage==='caption')return {stage,provider:'openai',model:defaultModels.caption,secret_ref:'OPENAI_API_KEY'};return null;}
function aiError(code,status=409) {
  return Object.assign(new Error(code),{publicCode:code,status,code});
}
export async function generateImage({prompt,size='1024x1024',accountId,contentVersionId,title}) {
  if (!contentVersionId || !accountId || !prompt?.trim()) throw aiError('image_input_missing',400);
  const existing = await query("SELECT filename,state FROM storage_uploads WHERE idempotency_key=$1",[contentVersionId+'/ai-image']);
  if (existing.rowCount) return existing.rows[0];
  const config = await stageConfig('image');
  const perform = adapterFor(config?.provider,'image');
  const key = process.env[config.secret_ref];
  if (!key) throw aiError('image_provider_not_configured',503);
  const model = config.model || (config.provider === 'openai' ? defaultModels.image : null);
  if (!model) throw aiError('image_model_required');
  const amount = Number(config.options?.max_cost_per_image || (config.provider === 'openai' && process.env.OPENAI_IMAGE_MAX_COST));
  if (!Number.isFinite(amount) || amount<=0) throw aiError('generation_cost_limit_required');
  const reservation = 'image:' + contentVersionId;
  const budgetId = await withTransaction(async db=>{
    const {rows} = await db.query(`SELECT id FROM monthly_budgets
      WHERE month_start=date_trunc('month',now())::date AND provider=$2 AND model=$1
      FOR UPDATE`,[model,config.provider]);
    if (!rows[0]) throw aiError('generation_budget_not_configured');
    const held = await db.query(`INSERT INTO usage_events(reservation_key,account_id,provider,model,reserved_amount,status)
      VALUES($1,$2,$5,$3,$4,'reserved') ON CONFLICT(reservation_key) DO UPDATE
      SET status='reserved',reserved_amount=EXCLUDED.reserved_amount,model=EXCLUDED.model,provider=EXCLUDED.provider,settled_at=NULL
      WHERE usage_events.status='released' RETURNING id`,[reservation,accountId,model,amount,config.provider]);
    if (!held.rowCount) throw aiError('image_result_pending_reconciliation');
    const updated = await db.query(`UPDATE monthly_budgets SET reserved_amount=reserved_amount+$2
      WHERE id=$1 AND reserved_amount+actual_amount+$2<=limit_amount RETURNING id`,[rows[0].id,amount]);
    if (!updated.rowCount) throw aiError('budget_insufficient');
    return rows[0].id;
  });
  async function release() {
    await withTransaction(async db=>{
      const event=await db.query("UPDATE usage_events SET status='released',settled_at=now() WHERE reservation_key=$1 AND status='reserved' RETURNING id",[reservation]);
      if (event.rowCount) await db.query('UPDATE monthly_budgets SET reserved_amount=reserved_amount-$2 WHERE id=$1',[budgetId,amount]);
    });
  }
  if ((await query('SELECT emergency_paused FROM system_controls WHERE singleton')).rows[0]?.emergency_paused !== false) {
    await release();
    throw aiError('emergency_pause');
  }
  let result;
  try {
    result = await perform({key,model,prompt,size});
  } catch (e) {
    if (e.rejectedBeforeGeneration === true) await release();
    throw e;
  }
  const item=await stageMedia({versionId:contentVersionId,slot:'ai-image',title,mime:result.mime,
      stream:Readable.from([result.bytes])});
  // Image endpoints do not return a final billed currency amount. Keep the upper
  // bound reserved for billing reconciliation rather than presenting it as actual.
  await query('UPDATE content_versions SET generation_provider=$2,generation_model=$3,generated_at=now(),generated_cost_estimate=$4 WHERE id=$1',
    [contentVersionId,config.provider,model,amount]);
  return {filename:item.filename,state:item.state};
}
export async function generateText({prompt,stage='caption'}) {
  if (!['caption','source_analysis'].includes(stage)) throw aiError('text_stage_invalid',400);
  const config = await stageConfig(stage);
  const perform = adapterFor(config?.provider,'text');
  const key = process.env[config.secret_ref];
  const model = config.model || (config.provider === 'openai' ? defaultModels.caption : null);
  if (!key || !model) throw aiError('text_provider_not_configured',503);
  return {...await perform({key,model,prompt}),provider:config.provider,model};
}
