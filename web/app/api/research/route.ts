import {env} from 'cloudflare:workers';
import {consoleAccess} from '../../../lib/console-access';
import {researchTarget} from '../../../lib/research-target';
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(req:Request){
 if(!await consoleAccess())return json({error:'등록된 사용자로 로그인하세요.'},403);
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'요청 출처를 확인하세요.'},403);
 const body=await req.json().catch(()=>null);
 const target=typeof body?.input==='string'?researchTarget(body.input):null;
 if(!target)return json({error:'Instagram 주소 또는 아이디를 확인하세요.'},400);
 if(!target.username)return json({status:'공개 게시물 미리보기'});
 const token=env.META_DISCOVERY_ACCESS_TOKEN,id=env.META_DISCOVERY_IG_ID;
 if(!token||!id||!/^\d+$/.test(id))return json({status:'API 미연결'});
 const url=new URL('https://graph.facebook.com/v27.0/'+id);
 const base='username,name,biography,followers_count,follows_count,media_count';
 async function query(fields:string){
  url.searchParams.set('fields','business_discovery.username('+target!.username+'){'+fields+'}');
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
  const payload=await response.json() as {business_discovery?:Record<string,unknown>,error?:{code:number}};
  const code=payload.error?.code;
  let status='조회 불가';
  if(code===190)status='API 재연결 필요';
  else if(code===10||code===200||response.status===403)status='권한 없음';
  else if(response.status===429||[4,17,32,613].includes(code??0))status='호출 한도 도달';
  else if(response.status>=500)status='조회 오류';
  return {data:response.ok?payload.business_discovery:null,status,code};
 }
 try{
  let result=await query(base+',media.limit(12){permalink,caption,media_type,media_product_type,timestamp,like_count,comments_count,view_count}');
  if(!result.data&&result.code===100){
   result=await query(base+',media.limit(12){permalink,caption,media_type,timestamp,like_count,comments_count}');
  }
  let mediaStatus='미제공';
  if(!result.data&&[10,100,200].includes(result.code??0)){
   mediaStatus=result.status;result=await query(base);
  }
  if(!result.data)return json({status:result.status});
  const profile=result.data;
  const rows=(profile.media as {data?:Record<string,unknown>[]} | undefined)?.data;
  const clean=(obj:Record<string,unknown>,keys:string[])=>Object.fromEntries(keys.map(key=>[key,
   typeof obj[key]==='number'||typeof obj[key]==='string'?obj[key]:null]));
  return json({status:'조회 완료',checkedAt:new Date().toISOString(),profile:clean(profile,base.split(',')),
   media:Array.isArray(rows)?rows.slice(0,12).map(row=>clean(row,['permalink','caption','media_product_type','media_type','timestamp','like_count','comments_count','view_count'])):null,mediaStatus});
 }catch{return json({status:'조회 오류'});}
}
