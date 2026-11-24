import {consoleAccess} from '../lib/console-access';
import Console from './console';
import {requireChatGPTUser} from './chatgpt-auth';
export const dynamic='force-dynamic';
export default async function Page(){const user=await requireChatGPTUser('/');
 const access=await consoleAccess(user);
 if(!access)return <main className="access-denied"><h1>사용 권한이 필요합니다</h1><p>현재 로그인한 주소는 {user.email}입니다. 관리자에게 이 Gmail 주소를 등록해 달라고 요청하세요.</p><a href="/signout-with-chatgpt?return_to=%2F" target="_top">다른 계정으로 로그인</a></main>;
 return <Console manageUsers={access.manageUsers} loginId={user.email.trim().split('@')[0]}/>;}
