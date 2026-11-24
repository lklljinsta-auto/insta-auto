import {env} from 'cloudflare:workers';
import {consoleAccess} from '../../../lib/console-access';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(){
 const u=await consoleAccess(); if(!u)return json({error:'등록된 Gmail로 로그인하세요.'},403);
 const db=env.DB!;const [a,d,f,t]=await db.batch([
  db.prepare('select id,handle,alias,guide,updated from accounts where owner=? order by handle').bind(u.owner),
  db.prepare('select * from drafts where owner=? order by updated desc').bind(u.owner),
  db.prepare('select id,draft,name,size,updated from files where owner=? order by updated desc').bind(u.owner),
  db.prepare('select id,href from research_targets where owner=? order by added desc').bind(u.owner)]);
 return json({accounts:a.results,drafts:d.results,files:f.results,targets:t.results});
}
export async function POST(req:Request){
 const u=await consoleAccess();if(!u?.canEdit)return json({error:'등록된 사용자만 변경할 수 있습니다.'},403);
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'요청 출처를 확인하세요.'},403);
 const b=await req.json() as Record<string,unknown>;const val=(k:string)=>String(b[k]??'').trim();
 const db=env.DB!,now=new Date().toISOString(),id=val('id')||crypto.randomUUID();
 if(b.type==='account'){
  const handle=val('handle').replace(/^@/,'').toLowerCase();
  if(!/^[a-z0-9._]{1,30}$/.test(handle))return json({error:'인스타그램 아이디를 확인하세요.'},400);
  const guide:Record<string,string>={};
  for(const key of ['topic','audience','voice','avoid','feed','reel','sources']){
   const value=val(key);if(value.length>6000)return json({error:'항목마다 6,000자 이내로 입력하세요.'},400);guide[key]=value;
  }
  for(const line of guide.sources.split(/\s+/).filter(Boolean)){if(!URL.canParse(line)||!['http:','https:'].includes(new URL(line).protocol))return json({error:'참고 링크는 한 줄에 하나씩 입력하세요.'},400);}
  try{
   const saved=await db.prepare('insert into accounts(id,owner,handle,alias,guide,updated) values(?,?,?,?,?,?) on conflict(id) do update set handle=excluded.handle,alias=excluded.alias,guide=excluded.guide,updated=excluded.updated where accounts.owner=excluded.owner').bind(id,u.owner,handle,val('alias').slice(0,100),JSON.stringify(guide),now).run();
   if(!saved.meta.changes)return json({error:'접근할 수 없는 계정입니다.'},403);
  }catch(e){if(String(e).includes('UNIQUE'))return json({error:'같은 아이디가 이미 있습니다.'},409);throw e;}
 }else if(b.type==='draft'){
  const a=await db.prepare('select id from accounts where id=? and owner=?').bind(val('account'),u.owner).first();
  if(!a||!['feed','reel'].includes(val('format'))||!val('title')||val('title').length>300||val('caption').length>20000)return json({error:'운영 계정·제목·형식을 확인하세요.'},400);
  const source=val('source');
  if(source && (!URL.canParse(source)||!['https:','http:'].includes(new URL(source).protocol)))return json({error:'원본 URL을 확인하세요.'},400);
  const scheduled=val('schedule')?new Date(val('schedule')):null;
  if(scheduled&&isNaN(+scheduled))return json({error:'날짜를 확인하세요.'},400);
  const saved=await db.prepare('insert into drafts(id,owner,account,title,caption,format,source,schedule,updated) values(?,?,?,?,?,?,?,?,?) on conflict(id) do update set title=excluded.title,caption=excluded.caption,format=excluded.format,source=excluded.source,schedule=excluded.schedule,updated=excluded.updated where drafts.owner=excluded.owner and drafts.account=excluded.account').bind(id,u.owner,val('account'),val('title'),val('caption'),val('format'),val('source').slice(0,6000),scheduled?.toISOString()??null,now).run();
  if(!saved.meta.changes)return json({error:'초안의 계정을 확인하세요.'},409);
 }else if(b.type==='research'){
  if(!Array.isArray(b.targets)||!b.targets.length||b.targets.length>100)return json({error:'분석 대상은 한 번에 1~100개를 입력하세요.'},400);
  const links=new Set<string>();
  for(const raw of b.targets){
   const url=URL.canParse(String(raw))?new URL(String(raw)):null;
   if(!url||url.origin!=='https://www.instagram.com'||!/^\/(?:[a-zA-Z0-9._]{1,30}|(?:p|reels?|tv)\/[a-zA-Z0-9_-]+)\/?$/.test(url.pathname))return json({error:'Instagram 주소를 확인하세요.'},400);
   links.add(url.origin+url.pathname.replace(/\/?$/,'/'));
  }
  await db.batch([...links].map(href=>db.prepare('insert into research_targets(id,owner,href,added) values(?,?,?,?) on conflict(owner,href) do nothing').bind(crypto.randomUUID(),u.owner,href,now)));
 }else if(b.type==='remove'){
  const key=val('kind'),target=val('id');
  const queries:Record<string,string>={
   account:'delete from accounts where id=? and owner=? and not exists(select 1 from drafts where account=accounts.id)',
   draft:'delete from drafts where id=? and owner=? and not exists(select 1 from files where draft=drafts.id)',
   research:'delete from research_targets where id=? and owner=?'
  };
  if(!Object.hasOwn(queries,key))return json({error:'삭제 대상을 확인하세요.'},400);
  const result=await db.prepare(queries[key]).bind(target,u.owner).run();
  if(!result.meta.changes)return json({error:'연결된 콘텐츠나 파일이 있거나 이미 삭제된 항목입니다.'},409);
 }else return json({error:'지원하지 않는 작업입니다.'},400);
 return json({id});
}
