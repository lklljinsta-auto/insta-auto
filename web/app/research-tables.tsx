'use client';
import {useState,type ReactNode} from 'react';
import {researchTarget,type Target} from '../lib/research-target';
import {supplement,type PublicObservation} from '../lib/public-counts';
import {profileFields,mediaFields,summarize,intervals,type Fields,type Result} from '../lib/research-fields';

const num=(v:number)=>v.toLocaleString('ko-KR',{maximumFractionDigits:1});
const date=(v:number)=>new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
function url(value:unknown){
 if(typeof value!=='string')return;
 try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password)return u.href;}catch{}
}
function Photo({src}:{src:string}){
 const [failed,fail]=useState('');
 return failed===src?'사진 확인 불가':<img className="research-photo" src={src} alt="Instagram 프로필 사진" loading="lazy" referrerPolicy="no-referrer" onError={()=>fail(src)}/>;
}
function cell(key:string,value:Fields[string]|undefined,status:string):ReactNode{
 if(value==null||value==='')return status;
 if(key==='profile_picture_url'){const src=url(value);return src?<Photo src={src}/>:status;}
 if(['permalink','website','media_url','thumbnail_url'].includes(key)){
  const href=url(value);return href?<a href={href} target="_blank" rel="noreferrer">{key==='website'?new URL(href).hostname:'열기 ↗'}</a>:status;
 }
 if(key==='timestamp'&&typeof value==='string'&&Number.isFinite(Date.parse(value)))return date(Date.parse(value));
 if(typeof value==='string'&&['caption','biography','alt_text'].includes(key)){
  const text=value.trim(),preview=text.replace(/\s+/g,' ');
  if(!preview)return status;
  if(preview.length<=44&&text===preview)return preview;
  return <details className="research-long-text"><summary>{preview.slice(0,44)}{preview.length>44?'…':''}</summary><div>{text}</div></details>;
 }
 if(typeof value==='boolean')return value?'예':'아니요';
 if(typeof value==='number')return num(value);
 return value;
}
type Row={id:string,label:ReactNode,values:ReactNode[],notice?:string,group?:string};
function Table({title,first,headers,rows}:{title:string,first:string,headers:string[],rows:Row[]}){
 return <section className="panel section-panel"><h2>{title}</h2><div className="research-scroll" tabIndex={0} aria-label={title}><table className="research-table"><thead><tr><th scope="col">{first}</th>{headers.map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={r.id} className={i>0&&r.group&&r.group!==rows[i-1].group?'research-account-break':undefined}><th scope="row">{r.label}</th>{r.notice?<td colSpan={headers.length}>{r.notice}</td>:r.values.map((v,i)=><td key={i}>{v}</td>)}</tr>)}</tbody></table></div></section>;
}
const kpis=['평균 조회수','조회수 중앙값','댓글 합계','평균 댓글','댓글 중앙값','좋아요 합계','평균 좋아요','좋아요 중앙값','평균 업로드 간격','최근 게시 시각','표본 시작 시각','피드 수','릴스 수','조회한 게시물 수'];
function analysis(rows:Fields[]|undefined|null,missing:string){
 if(!rows)return kpis.map(()=>missing);
 const views=summarize(rows,'view_count'),comments=summarize(rows,'comments_count'),likes=summarize(rows,'like_count'),period=intervals(rows);
 const metric=(v:number|null,n:number)=>v===null?'표본 없음':<>{num(v)}<small>유효 {n}건</small></>;
 const types=rows.filter(r=>typeof r.media_product_type==='string');
 const kind=(s:string)=>types.length?metric(types.filter(r=>r.media_product_type===s).length,types.length):'표본 없음';
 return [metric(views.mean,views.n),metric(views.median,views.n),metric(comments.sum,comments.n),metric(comments.mean,comments.n),metric(comments.median,comments.n),metric(likes.sum,likes.n),metric(likes.mean,likes.n),metric(likes.median,likes.n),
 period.hours===null?'표본 부족':<>{period.hours>=24?num(period.hours/24)+'일':num(period.hours)+'시간'}<small>간격 {period.count-1}개</small></>,
 period.last===undefined?'표본 없음':date(period.last),period.first===undefined?'표본 없음':date(period.first),kind('FEED'),kind('REELS'),rows.length];
}
export function ResearchTables({targets,results}:{targets:Target[],results:Record<string,Result>}){
 const profiles:Row[]=[],stats:Row[]=[],posts:Row[]=[];
 function observedCell(key:string,row:Fields|undefined,observation:PublicObservation|undefined,archive?:PublicObservation,inputUsername?:string){
  if(row?.[key]!=null&&row[key]!=='')return cell(key,row[key],'—');
  for(const source of [observation,archive]){
   const value=source?.profile?.[key]??source?.counts[key];
   if(!source||!value)continue;
   const rendered=cell(key,value,'—');
   return <>{rendered}<small>{source.source==='archive'?'공개 보관본':'공개 검색'} · {source.capturedAt?new Date(source.capturedAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}):'시점 미상'}</small></>;
  }
  if(key==='username'&&inputUsername)return <>{inputUsername}<small>입력한 아이디</small></>;
  return '—';
 }
 for(const t of targets){
  const r=results[t.href],status=r?.status||'조회 중';
  const observations=r?.publicReport?.observations||[];
  const evidence=new Map(observations.filter(o=>!o.source).map(o=>[o.url,o]));
  const archive=observations.find(o=>o.source==='archive'&&o.url===t.href);
  const profileObservation=evidence.get(t.href);
  const link=(href:string)=><a href={href} target="_blank" rel="noreferrer">{t.label}</a>;
  const label=link(t.href);
  const reason=r?.publicPending?'공개 수치 확인 중':r?.publicReport?.failed?'공개 검색 응답 없음':r?.publicReport?'공개 검색에서 확인된 수치 없음':'';
  const unavailable=[status,reason].filter(Boolean).join(' · ');
  if(t.username){
   const info=r?.profile||profileObservation||archive;
   profiles.push({id:t.href,label:<>{label}{!info&&<small className="profile-reason">{unavailable}</small>}</>,values:[...Object.keys(profileFields).map(k=>observedCell(k,r?.profile,profileObservation,archive,t.username!)),r?.checkedAt?date(Date.parse(r.checkedAt)):'—']});
   const enriched=r?.media?.map(row=>supplement(row,evidence.get(researchTarget(String(row.permalink))?.href||'')));
   const usesPublic=r?.media?.some(row=>{const hit=evidence.get(researchTarget(String(row.permalink))?.href||'');return Object.keys(hit?.counts||{}).some(k=>row[k]==null);});
   stats.push({id:t.href,label:<>{label}{usesPublic&&<small>공개 검색 수치 포함</small>}</>,values:analysis(enriched,'—'),notice:enriched?.length?undefined:(r?.profile?(r.mediaStatus==='미제공'?'확인된 게시물 없음':r.mediaStatus):unavailable)});
  }
  let media=r?.media;
  if(!t.username){
   const match=Object.values(results).flatMap(x=>x.media||[]).find(m=>typeof m.permalink==='string'&&researchTarget(m.permalink)?.href===t.href);
   if(match)media=[match];
   else if(profileObservation)media=[{permalink:t.href}];
  }
  if(!media?.length){
   posts.push({id:t.href,group:t.href,label,values:[],notice:r?.profile?'확인된 게시물 없음':unavailable});
  }else{
   for(const [i,item] of media.entries()){
    const href=typeof item.permalink==='string'?researchTarget(item.permalink)?.href:undefined;
    posts.push({id:t.href+i,group:t.href,label:href?link(href):label,values:Object.keys(mediaFields).map(k=>observedCell(k,item,href?evidence.get(href):undefined))});
   }
  }
 }
 return <><p className="research-legend">— 확인되지 않은 항목 · 공개 검색 및 보관본 값에는 출처와 수집 시점을 표시합니다.</p>{profiles.length>0&&<><Table title="계정 정보" first="조회 계정" headers={[...Object.values(profileFields),'수집 시각 (한국시간)']} rows={profiles}/>
 <Table title="게시물 반응과 업로드 주기 · 최근 최대 12건" first="조회 계정" headers={kpis} rows={stats}/></>}
 <Table title="게시물별 상세 정보" first="조회 대상" headers={Object.values(mediaFields)} rows={posts}/>
 {targets.some(t=>!t.username)&&<p>게시물 링크는 공개 검색 수치를 확인합니다. 작성자 아이디도 입력하면 최근 게시물의 API 수치를 함께 확인합니다.</p>}</>;
}
