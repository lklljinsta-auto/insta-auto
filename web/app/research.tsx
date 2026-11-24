'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {researchTarget,type Target} from '../lib/research-target';

import {ResearchTables} from './research-tables';
import type {Result} from '../lib/research-fields';

export default function Research(){
 const [input,setInput]=useState(''),[targets,setTargets]=useState<Target[]>([]),[results,setResults]=useState<Record<string,Result>>({}),[notice,setNotice]=useState('');
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 function submit(e:FormEvent){
  e.preventDefault();
  const pieces=input.split(/[\s,]+/).filter(Boolean);
  const unique=new Map<string,Target>();let invalid=0;
  for(const piece of pieces){const target=researchTarget(piece);if(target)unique.set(target.href,target);else invalid++;}
  if(!unique.size){setNotice('조회할 Instagram 아이디나 링크를 확인하세요.');return;}
  const list=[...unique.values()];
  controller.current?.abort();
  const next=new AbortController();controller.current=next;
  setResults({});setTargets(list);setNotice(invalid?'잘못된 입력 '+invalid+'개를 제외했습니다.':'');
  let index=0;
  async function run(){
   while(!next.signal.aborted&&index<list.length){
    const target=list[index++];let result:Result;
    try{
     const r=await fetch('/api/research',{method:'POST',cache:'no-store',signal:next.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({input:target.href})});
     const data=await r.json();
     result=r.ok&&typeof data.status==='string'?data:{status:r.status===403?'사용 권한 확인 필요':'조회 오류'};
    }catch{result={status:'조회 오류'};}
    if(!next.signal.aborted)setResults(old=>({...old,[target.href]:result}));
   }
  }
  void Promise.all([run(),run()]);
 }
 return <section className="view-root"><div className="page-heading"><div><p className="eyebrow">인스타오토</p><h1>Instagram 계정 분석</h1><p className="page-description">아이디나 링크로 바로 조회합니다. 새로고침하면 입력과 결과가 사라집니다.</p></div></div>
 <section className="panel form-panel"><form onSubmit={submit} autoComplete="off"><label htmlFor="research-input">Instagram 아이디 · 프로필 · 게시물 · 릴스 링크</label>
 <textarea id="research-input" className="large-input" rows={4} placeholder="여러 대상을 줄바꿈이나 쉼표로 구분해 입력" required value={input} onChange={e=>setInput(e.target.value)}/>
 <div className="form-actions"><button className="btn btn-primary" type="submit">바로 조회</button></div>{notice&&<p role="status">{notice}</p>}</form></section>
 {targets.length>0&&<ResearchTables targets={targets} results={results}/>}</section>;
}
