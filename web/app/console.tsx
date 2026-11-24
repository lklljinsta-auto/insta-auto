'use client';
import Viewers from './viewers';
import {useState,useEffect,type FormEvent} from 'react';
type Row=Record<string,string>;
type Data={accounts:Row[],drafts:Row[],files:Row[]};
const tabs=['관제 홈','운영 계정','콘텐츠·예약','파일 보관'];
const guides={topic:'주제',audience:'대상 독자',voice:'말투',avoid:'금지 표현',sources:'계정 전용 참고 링크',feed:'피드 프롬프트',reel:'릴스 프롬프트'};
const local=(v:string)=>v?new Date(+new Date(v)+9*3600000).toISOString().slice(0,16):'';
export default function Console({canEdit}:{canEdit:boolean}){
 const menus=canEdit?[...tabs,'열람자 관리']:tabs;
 const [tab,T]=useState(0),[data,D]=useState<Data|null>(null),[msg,M]=useState(''),[busy,B]=useState(false),[edit,E]=useState<Row|null>(null),[account,A]=useState('');
 const load=async()=>{const r=await fetch('/api/console',{cache:'no-store'});if(!r.ok)throw Error('서버 기록을 불러오지 못했습니다. 새로고침해 주세요.');D(await r.json());};
 useEffect(()=>{load().catch(e=>M(e.message));},[]);
 const nav=(n:number)=>{T(n);E(null);M('');};
 const run=async(fn:()=>Promise<void>)=>{if(busy)return; B(true);M('');try{await fn();await load();M('저장했습니다.');}catch(x){M(x instanceof Error?x.message:'요청 실패');}finally{B(false);}};
 async function submit(ev:FormEvent<HTMLFormElement>){ev.preventDefault();const b=Object.fromEntries(new FormData(ev.currentTarget));
 await run(async()=>{const payload={...b,id:edit?.id,type:tab===1?'account':'draft',schedule:b.schedule?new Date(b.schedule+':00+09:00').toISOString():null};
 const r=await fetch('/api/console',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const j=await r.json();if(!r.ok)throw Error(j.error||'저장 실패');E(null);});}
 const [filesFor,F]=useState('');
 const upload=async(ev:FormEvent<HTMLFormElement>)=>{ev.preventDefault();const form=ev.currentTarget;const file=new FormData(form).get('file') as File;
 if(!file?.size||!filesFor){M('초안과 파일을 선택하세요.');return;}await run(async()=>{const r=await fetch('/api/files?'+new URLSearchParams({draft:filesFor,name:file.name}),{method:'POST',body:file});if(!r.ok)throw Error((await r.json()).error||'파일 업로드 실패');form.reset();});};
 const accounts=data?.accounts??[],drafts=data?.drafts??[],files=data?.files??[];
 const who=(id:string)=>{const a=accounts.find(x=>x.id===id);return a?(a.alias||'@'+a.handle):'';};
 const guide=edit?.guide?JSON.parse(edit.guide):{};
 return <div className="shell"><aside><div className="brand"><img src="/favicon.svg" alt=""/><strong>인스타오토</strong></div><nav>{menus.map((v,i)=><button key={v} aria-current={tab===i?'page':undefined} onClick={()=>nav(i)}>{v}</button>)}</nav></aside><main>
 <header><h1>{menus[tab]}</h1><span>{canEdit?'관리자':'열람 전용'}</span></header>
 {msg&&<p role="status" className="notice">{msg}</p>}
 {!data?<p>운영 기록을 불러오는 중입니다.</p>:<>
 {tab===4&&canEdit&&<Viewers/>}
 {tab===0&&<><div className="counts">{[['운영 계정',accounts.length,1],['저장한 콘텐츠',drafts.length,2],['보관 파일',files.length,3]].map(([title,count,n])=><button key={title} onClick={()=>nav(Number(n))}><span>{title}</span><strong>{count}</strong></button>)}</div><section><h2>게시 일정</h2>
 {drafts.filter(d=>d.schedule).sort((a,b)=>a.schedule.localeCompare(b.schedule)).map(d=><p key={d.id}>{local(d.schedule).replace('T',' ')} · {who(d.account)} · {d.title} · 게시 보류</p>)}
 {!drafts.some(d=>d.schedule)&&<p>저장된 일정이 없습니다.</p>}
 {canEdit&&<button onClick={()=>nav(accounts.length?2:1)}>{accounts.length?'콘텐츠 작성':'첫 운영 계정 등록'}</button>}</section><section><h2>연동 상태</h2><p>Meta 게시·성과 수집, AI 생성, Google Drive는 미연결입니다. 게시 예정 시각은 저장되며 실제 전송은 보류됩니다.</p></section></>}
 {tab===1&&<><section><div className="heading"><h2>운영 계정 {accounts.length}개</h2>{canEdit&&<button onClick={()=>E({})}>계정 추가</button>}</div>
 {accounts.map(a=><article key={a.id}><div><b>@{a.handle}</b> {a.alias}</div><button className="light" onClick={()=>E(a)}>{canEdit?'지침·설정 수정':'지침 보기'}</button></article>)}
 {!accounts.length&&<p>등록된 운영 계정이 없습니다.</p>}</section>
 {edit&&canEdit&&<section><h2>{edit.id?'계정 설정':'운영 계정 등록'}</h2><form key={edit.id||'new'} onSubmit={submit}><label>Instagram 아이디<input name="handle" defaultValue={edit.handle} required placeholder="@아이디"/></label><label>내부 표시 이름<input name="alias" defaultValue={edit.alias}/></label>{Object.entries(guides).map(([k,n])=><label key={k}>{n}<textarea name={k} defaultValue={guide[k]}/></label>)}<div><button disabled={busy}>저장</button> <button type="button" className="light" onClick={()=>E(null)}>닫기</button></div></form></section>}</>}
 {tab===2&&<><section><div className="heading"><h2>계정별 콘텐츠</h2>{canEdit&&<button onClick={()=>accounts.length?E({}):nav(1)}>{accounts.length?'새 초안':'계정 등록'}</button>}</div><label>계정 선택<select value={account} onChange={e=>A(e.target.value)}><option value="">전체 계정</option>{accounts.map(a=><option value={a.id} key={a.id}>{who(a.id)}</option>)}</select></label>
 {drafts.filter(d=>!account||d.account===account).map(d=><article key={d.id}><div><b>{d.title}</b><small>{who(d.account)} · {d.format==='feed'?'피드':'릴스'} · {d.schedule?local(d.schedule).replace('T',' ')+' 게시 보류':'초안'}</small></div><button className="light" onClick={()=>E(d)}>열기</button></article>)}{!drafts.filter(d=>!account||d.account===account).length&&<p>저장된 콘텐츠가 없습니다.</p>}</section>
 {edit&&canEdit&&<section><h2>콘텐츠 작성</h2><form key={edit.id||'new'} onSubmit={submit}><label>운영 계정<select name="account" defaultValue={edit.account||account||accounts[0]?.id}>{accounts.filter(a=>!edit.id||a.id===edit.account).map(a=><option key={a.id} value={a.id}>{who(a.id)}</option>)}</select></label><label>형식<select name="format" defaultValue={edit.format||'feed'}><option value="feed">피드</option><option value="reel">릴스</option></select></label><label>제목<input name="title" required defaultValue={edit.title} maxLength={300}/></label><label>원본·출처<textarea name="source" defaultValue={edit.source}/></label><label>캡션<textarea rows={5} name="caption" defaultValue={edit.caption}/></label><label>게시 예정 시각 (한국시간)<input type="datetime-local" name="schedule" defaultValue={local(edit.schedule)}/></label><div><button disabled={busy}>저장</button> <button type="button" className="light" onClick={()=>E(null)}>닫기</button></div></form></section>}</>}
 {edit&&!canEdit&&tab===1&&<section><h2>계정 지침</h2>{Object.entries(guides).map(([k,n])=><p key={k}><b>{n}</b><br/>{guide[k]||'입력 전'}</p>)}</section>}
 {edit&&!canEdit&&tab===2&&<section><h2>{edit.title}</h2><p>원본·출처<br/>{edit.source||'입력 전'}</p><p>캡션<br/>{edit.caption||'입력 전'}</p></section>}
 {tab===3&&<>{canEdit&&<section><h2>파일 보관</h2>{drafts.length?<form onSubmit={upload}><label>운영 계정 · 콘텐츠<select required value={filesFor} onChange={e=>F(e.target.value)}><option value="">콘텐츠 선택</option>{drafts.map(d=><option key={d.id} value={d.id}>{who(d.account)} · {d.title}</option>)}</select></label><label>올릴 파일 (최대 50MB)<input name="file" type="file" required/></label><button disabled={busy}>{busy?'저장 중…':'비공개 보관함에 저장'}</button></form>:<><p>파일을 연결할 콘텐츠를 먼저 등록하세요.</p><button onClick={()=>nav(accounts.length?2:1)}>{accounts.length?'콘텐츠 작성':'계정 등록'}</button></>}</section>}<section><h2>저장된 파일</h2>{files.map(f=><article key={f.id}><div><b>{f.name}</b><small>{who(drafts.find(d=>d.id===f.draft)?.account||'')}</small></div><a href={'/api/files?id='+f.id}>다운로드</a></article>)}{!files.length&&<p>보관 중인 파일이 없습니다.</p>}</section></>}
 </>}</main></div>;
}
