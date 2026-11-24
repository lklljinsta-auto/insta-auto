import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
export const dynamic='force-dynamic';
const err=(msg:string,status:number)=>Response.json({error:msg},{status});
export async function GET(req:Request){
 const u=await getChatGPTUser();if(!u)return err('로그인이 필요합니다.',401);
 const f=await env.DB!.prepare('select objectKey,name from files where id=? and owner=?').bind(new URL(req.url).searchParams.get('id'),u.userId).first<{objectKey:string,name:string}>();
 if(!f)return err('파일을 찾을 수 없습니다.',404);
 const obj=await env.BUCKET!.get(f.objectKey);if(!obj)return err('파일이 없습니다.',404);
 return new Response(obj.body,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(f.name)}});
}
export async function POST(req:Request){
 const u=await getChatGPTUser();if(!u)return err('로그인이 필요합니다.',401);
 const url=new URL(req.url);if(req.headers.get('origin')!==url.origin)return err('요청 출처를 확인하세요.',403);
 const draft=url.searchParams.get('draft'),size=Number(req.headers.get('content-length'));
 if(!req.body||!Number.isSafeInteger(size)||size<1||size>50*1024*1024)return err('50MB 이하 파일을 선택하세요.',413);
 const d=await env.DB!.prepare('select id,title,account from drafts where id=? and owner=?').bind(draft,u.userId).first<{id:string,title:string,account:string}>();
 if(!d)return err('초안을 찾을 수 없습니다.',404);
 const id=crypto.randomUUID(),now=new Date(),date=new Date(+now+9*3600000).toISOString().slice(0,19).replace('T','_').replaceAll(':','-');
 const ext=(url.searchParams.get('name')||'').match(/\.([A-Za-z0-9]{1,8})$/)?.[1]||'bin';
 const name=date+'_'+(d.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g,' ').slice(0,120).trim()||'콘텐츠')+'.'+ext;
 const key=u.userId+'/'+d.account+'/'+d.id+'/'+id;
 await env.BUCKET!.put(key,req.body);
 try{await env.DB!.prepare('insert into files(id,owner,draft,name,size,updated,objectKey) values(?,?,?,?,?,?,?)').bind(id,u.userId,d.id,name,size,now.toISOString(),key).run();}
 catch(e){await env.BUCKET!.delete(key);throw e;}
 return Response.json({id,name});
}
