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
  return {owner:env.CONSOLE_SHARED_WORKSPACE?.trim()||u.userId,canEdit:true,label};
 }
 const grant=await env.DB!.prepare('select owner from viewers where email=?').bind(email).first<{owner:string}>();
 return grant?{owner:grant.owner,canEdit:false,label:'열람 전용'}:null;
}
