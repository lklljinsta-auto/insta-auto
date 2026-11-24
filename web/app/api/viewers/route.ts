import {env} from 'cloudflare:workers';
import {consoleAccess,isConsoleAdmin} from '../../../lib/console-access';
export const dynamic='force-dynamic';
const result=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(){
 const auth=await consoleAccess();
 if(!auth?.canEdit)return result({error:'관리자만 열람자를 관리할 수 있습니다.'},403);
 const list=await env.DB!.prepare('select email from viewers where owner=? order by email').bind(auth.owner).all();
 return result({viewers:list.results});
}
export async function POST(req:Request){
 const auth=await consoleAccess();
 if(!auth?.canEdit)return result({error:'관리자만 열람자를 관리할 수 있습니다.'},403);
 if(req.headers.get('origin')!==new URL(req.url).origin)return result({error:'요청 출처를 확인하세요.'},403);
 const body=await req.json() as {email?:string,action?:string};
 const email=String(body.email??'').trim().toLowerCase();
 if(email.length>254||!/^[-a-z0-9._+]+@gmail\.com$/.test(email))return result({error:'Gmail 주소 전체를 입력하세요.'},400);
 if(isConsoleAdmin(email))return result({error:'이미 관리자 권한이 있는 주소입니다.'},400);
 if(body.action==='add')await env.DB!.prepare('insert into viewers(email,owner,added) values(?,?,?) on conflict(email) do nothing').bind(email,auth.owner,new Date().toISOString()).run();
 else if(body.action==='remove')await env.DB!.prepare('delete from viewers where email=? and owner=?').bind(email,auth.owner).run();
 else return result({error:'요청을 확인하세요.'},400);
 return result({ok:true});
}
