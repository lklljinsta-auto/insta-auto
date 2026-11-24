import {env} from 'cloudflare:workers';
import {getChatGPTUser,type ChatGPTUser} from '../app/chatgpt-auth';

export function isConsoleAdmin(email:string){
 const address=email.trim().toLowerCase();
 const configured=[env.CONSOLE_OWNER_EMAIL,env.CONSOLE_SECOND_ADMIN_EMAIL];
 return Boolean(address) && configured.some(value=>value?.trim().toLowerCase()===address);
}

export async function consoleAccess(user?:ChatGPTUser){
 const u=user??await getChatGPTUser();
 if(!u||!env.CONSOLE_OWNER_EMAIL?.trim())return null;
 const email=u.email.trim().toLowerCase();
 if(isConsoleAdmin(email)){
  const label=email===env.CONSOLE_OWNER_EMAIL.trim().toLowerCase()?'메인 관리자':'서브 관리자';
  return {owner:env.CONSOLE_SHARED_WORKSPACE?.trim()||u.userId,canEdit:true,manageUsers:true,label};
 }
 const grant=await env.DB!.prepare('select owner from viewers where email=?').bind(email).first<{owner:string}>();
 return grant?{owner:grant.owner,memberId:u.userId,canEdit:true,manageUsers:false,label:'사용자'}:null;
}

// Existing unassigned records use the bare workspace key and are administrator-only.
export function recordAccess(access:NonNullable<Awaited<ReturnType<typeof consoleAccess>>>){
 const prefix='member/'+encodeURIComponent(access.owner)+'/';
 if(access.manageUsers){
  return {owner:access.owner,where:'(owner = ? OR substr(owner, 1, length(?)) = ?)',args:[access.owner,prefix,prefix]};
 }
 if(!access.memberId)throw new Error('Missing authenticated member ID');
 const owner=prefix+encodeURIComponent(access.memberId);
 return {owner,where:'owner = ?',args:[owner]};
}
