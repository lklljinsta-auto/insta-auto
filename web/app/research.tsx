'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {researchTarget,type Target} from '../lib/research-target';

type Fields=Record<string,string|number|null>;
type Result={status:string,profile?:Fields,media?:Fields[]|null,mediaStatus?:string,checkedAt?:string};
const metrics=[['like_count','좋아요'],['comments_count','댓글'],['view_count','조회수']] as const;
const show=(v:unknown)=>typeof v==='number'?v.toLocaleString('ko-KR'):typeof v==='string'&&v?v:'미제공';
const time=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'미제공';
function summary(rows:Fields[],key:string){
 const values=rows.map(r=>r[key]).filter((v):v is number=>typeof v==='number').sort((a,b)=>a-b);
 if(!values.length)return '미제공';
 const mid=Math.floor(values.length/2),median=values.length%2?values[mid]:(values[mid-1]+values[mid])/2;
 const mean=values.reduce((a,b)=>a+b,0)/values.length;
 return '평균 '+mean.toLocaleString('ko-KR',{maximumFractionDigits:1})+' · 중앙값 '+show(median)+' · '+values.length+'건';
}

function ResultCard({target,result}:{target:Target,result?:Result}){
 const rows=result?.media;
 return <article className="panel section-panel"><div className="panel-heading"><h2>{target.label}</h2><span className="state-chip">{result?.status||'조회 중'}</span></div>
 {result?.profile&&<><p>Meta Business Discovery · {time(result.checkedAt)} (한국시간)</p>
 <dl className="research-fields">{Object.entries({name:'이름',biography:'소개',followers_count:'팔로워',follows_count:'팔로잉',media_count:'게시물'}).map(([k,n])=><div key={k}><dt>{n}</dt><dd>{show(result.profile?.[k])}</dd></div>)}</dl>
 {Array.isArray(rows)&&rows.length>0?<><h3>최근 게시물 · 조회 표본 {rows.length}건</h3>
 {metrics.map(([key,label])=><p key={key}>{label} · {summary(rows,key)}</p>)}
 {rows.map((row,i)=>{
  const link=typeof row.permalink==='string'?researchTarget(row.permalink):null;
  return <details key={i}><summary>{time(row.timestamp)} · {show(row.media_product_type??row.media_type)}</summary>
  <p>{show(row.caption)}</p><p>{metrics.map(([key,label])=>label+' '+show(row[key])).join(' · ')}</p>
  {link&&<a href={link.href} target="_blank" rel="noreferrer">게시물 열기</a>}</details>;
 })}</>:<p>최근 게시물 · {Array.isArray(rows)?'반환된 게시물 0건':result.mediaStatus}</p>}</>}
 {target.username&&result&&!result.profile&&<p>팔로워·게시물·반응 지표 · {result.status}</p>}
 <h3>Instagram 공개 미리보기</h3><iframe title={target.label+' 공개 미리보기'} src={target.href+'embed/'} loading="lazy" referrerPolicy="no-referrer" className="research-embed"/>
 <p>공개 미리보기는 계정의 퍼가기 설정에 따라 제한될 수 있습니다. <a href={target.href} target="_blank" rel="noreferrer">Instagram에서 열기 ↗</a></p></article>;
}

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
 {targets.map(t=><ResultCard key={t.href} target={t} result={results[t.href]}/>)}</section>;
}
