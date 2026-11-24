'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {researchTarget,type Target} from '../lib/research-target';

import {mergeUsage,type UsageReport} from '../lib/meta-usage';
import {ResearchTables} from './research-tables';
import type {Result} from '../lib/research-fields';

export default function Research(){
 const [input,setInput]=useState(''),[targets,setTargets]=useState<Target[]>([]),[results,setResults]=useState<Record<string,Result>>({}),[notice,setNotice]=useState('');
 const [usage,setUsage]=useState<UsageReport|null>(null);
 const [usageMessage,setUsageMessage]=useState('첫 조회 후 표시됩니다.');
 const sample=usage?.sample;
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
    if(next.signal.aborted) return;
    setResults(old=>({...old,[target.href]:result}));
    const report=result.usage;
    if(report) setUsage(previous=>mergeUsage(previous,report));
    else setUsageMessage(result.status==='API 미연결'?'API 미연결':result.status+' · 사용량 확인 전');
   }
  }
  void Promise.all([run(),run()]);
 }
 return <section className="view-root"><div className="page-heading"><div><p className="eyebrow">인스타오토</p><h1>Instagram 계정 분석</h1><p className="page-description">아이디나 링크로 바로 조회합니다. 새로고침하면 입력과 결과가 사라집니다.</p>
 <p className="page-description">공개 비즈니스·크리에이터 계정만 API로 조회할 수 있습니다. 개인·비공개·연령 제한 계정은 제외됩니다.</p></div></div>
 <section className="panel form-panel"><form onSubmit={submit} autoComplete="off"><label htmlFor="research-input">Instagram 아이디 · 프로필 · 게시물 · 릴스 링크</label>
 <textarea id="research-input" className="large-input" rows={4} placeholder="여러 대상을 줄바꿈이나 쉼표로 구분해 입력" required value={input} onChange={e=>setInput(e.target.value)}/>
 <div className="form-actions"><button className="btn btn-primary" type="submit">바로 조회</button></div>{notice&&<p role="status">{notice}</p>}</form></section>
 <section className="panel section-panel research-usage" aria-label="Meta 앱 사용량" aria-live="polite"><h2>Meta 앱 사용량</h2>
 {usage?.limited&&<p role="status"><strong>호출 한도 도달</strong></p>}
 {sample&&<><p><strong>최근 1시간 호출 잔여율 {sample.calls===null?'미제공':Math.max(0,100-sample.calls)+'%'}</strong></p>
 <p>호출 사용률 {sample.calls===null?'미제공':sample.calls+'%'} · CPU 사용률 {sample.cpu===null?'미제공':sample.cpu+'%'} · 처리 시간 사용률 {sample.time===null?'미제공':sample.time+'%'}</p>
 <p>마지막 사용량 수신 {new Date(sample.measuredAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})} (한국시간)</p></>}
 {usage&&!usage.latestHasUsage&&<p>이번 Meta 응답에는 사용량 정보가 없습니다.</p>}
 {!usage&&<p>{usageMessage}</p>}</section>
 {targets.length>0&&<ResearchTables targets={targets} results={results}/>}</section>;
}
