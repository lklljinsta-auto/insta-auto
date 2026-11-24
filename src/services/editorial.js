import { Router } from 'express';
import { query, withTransaction } from '../db.js';

const fields = ['topic','audience','voice','avoid','feed','reel','references'];
const latest = 'SELECT version,policy FROM account_policies WHERE account_id=$1 ORDER BY version DESC LIMIT 1';
export function editorialRouter() {
  const r=Router();
  r.get('/accounts/:id/editorial',async(req,res)=>{
    const {rows}=await query(latest,[req.params.id]);
    res.json({version:rows[0]?.version??0,editorial:rows[0]?.policy.editorial??{}});
  });
  r.put('/accounts/:id/editorial',async(req,res)=>{
    const {editorial,version}=req.body??{};
    if(!editorial || !Number.isSafeInteger(version) ||
      fields.some(k=>typeof editorial[k]!=='string'||editorial[k].length>6000))
      return res.status(400).json({error:'계정 지침 항목을 확인하세요.'});
    const clean=Object.fromEntries(fields.map(k=>[k,editorial[k].trim()]));
    for(const link of clean.references.split(/\s+/).filter(Boolean)){
      if(!URL.canParse(link)|| !['http:','https:'].includes(new URL(link).protocol))
        return res.status(400).json({error:'참고 원본에는 http 또는 https 주소를 한 줄에 하나씩 입력하세요.'});
    }
    const result=await withTransaction(async db=>{
      const account=await db.query('SELECT id FROM ig_accounts WHERE id=$1 FOR UPDATE',[req.params.id]);
      if(!account.rowCount)return {status:404,error:'계정을 찾을 수 없습니다.'};
      const current=(await db.query(latest,[req.params.id])).rows[0];
      if((current?.version??0)!==version)return {status:409,error:'다른 창에서 지침을 변경했습니다. 다시 열어 주세요.'};
      if(fields.every(k=>(current?.policy.editorial?.[k]??'')===clean[k]))return {version};
      const next=version+1;
      await db.query('INSERT INTO account_policies(account_id,version,policy) VALUES($1,$2,$3)',
        [req.params.id,next,{...current?.policy,editorial:clean}]);
      await db.query("INSERT INTO audit_events(operator_id,account_id,event_type,details) VALUES($1,$2,'editorial_saved',$3)",[req.admin.id,req.params.id,{version:next}]);
      return {version:next};
    });
    res.status(result.status??200).json(result);
  });
  return r;
}
