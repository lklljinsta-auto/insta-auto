'use client';
import {useEffect,useState} from 'react';
export default function Viewers(){
 const [rows,setRows]=useState<{email:string}[]>([]),[email,setEmail]=useState(''),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
 async function read(){const r=await fetch('/api/viewers',{cache:'no-store'});if(!r.ok)throw Error('목록을 불러오지 못했습니다.');setRows((await r.json()).viewers);}
 useEffect(()=>{read().catch(e=>setMsg(e.message));},[]);
 async function change(action:string,address:string){
  if(busy)return;setBusy(true);
  try{const r=await fetch('/api/viewers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,email:address})});
   const data=await r.json();if(!r.ok)throw Error(data.error||'저장 실패');
   await read(); if(action==='add')setEmail('');setMsg(action==='add'?'추가했습니다. 이 사이트 주소를 전달하세요.':'열람 권한을 해제했습니다.');
  }catch(e){setMsg(e instanceof Error?e.message:'저장 실패');}finally{setBusy(false);}
 }
 return <section><h2>Gmail 열람자</h2><p>등록된 주소로 로그인한 사람은 운영 계정, 초안, 일정과 보관 파일을 볼 수 있습니다.</p><form onSubmit={e=>{e.preventDefault();change('add',email);}}><label>Gmail 주소<input required type="email" autoComplete="off" value={email} onChange={e=>setEmail(e.target.value)}/></label><button disabled={busy}>열람자 추가</button></form><p role="status">{msg}</p>{rows.map(r=><article key={r.email}><span>{r.email}</span><button className="light" disabled={busy} onClick={()=>change('remove',r.email)}>열람 해제</button></article>)}</section>;
}
