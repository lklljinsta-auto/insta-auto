import path from 'node:path';
import { queueRender } from '../services/render-reel.js';
import { Router } from 'express';
import { query } from '../db.js';
import { queueImage } from '../services/image-jobs.js';
import { stageMedia } from './archive.js';
import { storageStatus, startConsent, finishConsent } from './authorization.js';

export function archiveRouter() {
  const routes = Router();
  routes.get('/archive/status',async(req,res)=>res.json(await storageStatus()));
  routes.post('/archive/connect',async(req,res)=>res.json({url:await startConsent(req.admin.id)}));
  routes.get('/archive/callback',async(req,res)=>{
    await finishConsent(req.admin.id,req.query.state,req.query.code);
    res.setHeader('Cache-Control','no-store');
    res.redirect(303,'/#settings');
  });
  routes.post('/content-versions/:id/assets',async(req,res)=>{
    const slot = String(req.query.slot || '');
    const output = await stageMedia({versionId:req.params.id,slot,title:String(req.query.title||''),
      ordinal:Number(req.query.ordinal||0),mime:req.headers['content-type']?.split(';')[0],stream:req});
    res.status(202).json({id:output.asset_id,filename:output.filename,state:output.state});
  });
  routes.post('/content-versions/:id/image',async(req,res)=>{
    const job=await queueImage(req.params.id);
    if(!job)return res.status(409).json({error:'현재 편집 중인 미승인 콘텐츠만 생성할 수 있습니다.'});
    res.status(202).json(job);
  });
  routes.post('/content-versions/:id/render',async(req,res)=>{
    res.status(202).json(await queueRender(req.params.id,req.body||{}));
  });
  routes.get('/archive/files/:assetId/download',async(req,res)=>{
    const {rows:[file]}=await query(`SELECT m.sha256,u.filename FROM media_assets m
      JOIN storage_uploads u ON u.asset_id=m.id WHERE m.id=$1 AND m.object_store='archive_spool'`,[req.params.assetId]);
    if(!file || !/^[a-f0-9]{64}$/.test(file.sha256))return res.sendStatus(404);
    res.set('Cache-Control','private, no-store');
    res.download(file.sha256,file.filename,{root:path.resolve(process.env.MEDIA_SPOOL_DIR||'.instaauto-media'),cacheControl:false});
  });
  routes.get('/archive/files',async(req,res)=>{
    const {rows} = await query(`SELECT u.asset_id,m.content_version_id,m.mime_type,u.filename,u.kind,u.state,u.last_error_code,
      CASE WHEN u.state='verified' THEN u.remote_file_id END AS drive_file_id,a.profile_handle
      FROM storage_uploads u JOIN media_assets m ON m.id=u.asset_id JOIN ig_accounts a ON a.id=u.account_id
      WHERE u.asset_id IS NOT NULL ORDER BY u.created_at DESC LIMIT 200`);
    res.json({files:rows});
  });
  return routes;
}
