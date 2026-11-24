import {env} from 'cloudflare:workers';
import {getChatGPTUser,type ChatGPTUser} from '../app/chatgpt-auth';
export async function consoleAccess(user?: ChatGPTUser){
 const u=user??await getChatGPTUser();
 if(!u)return null;
 const admin=env.CONSOLE_OWNER_EMAIL?.trim().toLowerCase();
 if(!admin)return null;
 const email=u.email.trim().toLowerCase();
 if(email===admin)return {owner:u.userId,canEdit:true};
 const grant=await env.DB!.prepare('select owner from viewers where email=?').bind(email).first<{owner:string}>();
 return grant?{owner:grant.owner,canEdit:false}:null;
}
