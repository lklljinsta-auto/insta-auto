import {readPublicResult,type PublicObservation} from './public-counts';
import {researchTarget,type Target} from './research-target';

export function snapshotProfile(target:Target,tags:Map<string,string>,capturedAt:string):PublicObservation|null{
 if(!target.username||researchTarget(tags.get('og:url')||'')?.href!==target.href)return null;
 const result=readPublicResult(target,{url:target.href,title:tags.get('og:title'),snippet:tags.get('og:description'),crawled_at:capturedAt});
 if(!result)return null;
 const profile:Record<string,string>={...result.profile,username:target.username};
 const image=tags.get('og:image');
 if(image&&result.profile?.username){
  try{
   const src=new URL(image);
   if(src.protocol==='https:'&&!src.username&&!src.password&&!src.port&&/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(src.hostname))profile.profile_picture_url=src.href;
  }catch{}
 }
 return {...result,profile,source:'archive'};
}

export async function archivedProfile(target:Target,signal:AbortSignal){
 const options:RequestInit={signal,redirect:'manual',cache:'no-store'};
 const lookup=new URL('https://archive.org/wayback/available');
 lookup.searchParams.set('url',target.href);
 const index=await fetch(lookup,options);
 if(!index.ok)throw new Error('archive unavailable');
 const data=await index.json() as {archived_snapshots?:{closest?:{available:boolean,status:string,timestamp:string}}};
 const hit=data.archived_snapshots?.closest;
 if(!hit?.available||hit.status!=='200'||!/^\d{14}$/.test(hit.timestamp))return null;
 const t=hit.timestamp;
 const stamp=t.slice(0,4)+'-'+t.slice(4,6)+'-'+t.slice(6,8)+'T'+t.slice(8,10)+':'+t.slice(10,12)+':'+t.slice(12,14)+'Z';
 const age=Date.now()-Date.parse(stamp);
 if(!Number.isFinite(age)||age<0||age>90*86400000)return null;
 const res=await fetch('https://web.archive.org/web/'+t+'id_/'+target.href,options);
 if(!res.ok||!res.headers.get('content-type')?.includes('text/html'))return null;
 const tags=new Map<string,string>();
 let headDone=false;
 const html=new HTMLRewriter().on('head meta[property]',{element(el){
  const prop=el.getAttribute('property'),value=el.getAttribute('content');
  if(prop&&['og:url','og:title','og:image','og:description'].includes(prop)&&value&&!tags.has(prop))tags.set(prop,value.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'"));
 }}).on('head',{element(el){el.onEndTag(()=>{headDone=true;});}}).transform(res);
 const body=html.body?.getReader();
 if(!body)return null;
 try{
  let bytes=0;
  while(!headDone&&bytes<262144){
   const chunk=await body.read();
   if(chunk.done)break;
   bytes+=chunk.value.byteLength;
  }
 }finally{await body.cancel();}
 return snapshotProfile(target,tags,stamp);
}
