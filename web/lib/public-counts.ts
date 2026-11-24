import {researchTarget, type Target} from './research-target';
import type {Fields, Result} from './research-fields';

const profileKeys=['followers_count','follows_count','media_count'];
const postKeys=['like_count','comments_count'];
export type PublicObservation={url:string,counts:Record<string,string>,profile?:Record<string,string>,source?:'archive',capturedAt:string|null};
export type PublicReport={observations:PublicObservation[],failed:number};
export function publicQueries(target:Target,result:Result){
 const links=new Set<string>();
 if(!target.username || [...profileKeys,'username','name','profile_picture_url'].some(k=>result.profile?.[k]==null||result.profile[k]===''))links.add(target.href);
 for(const row of result.media||[]){
  if(typeof row.permalink!=='string')continue;
  const post=researchTarget(row.permalink);
  if(!post||post.username)continue;
  if(postKeys.some(k=>row[k]==null)||((row.media_type==='VIDEO'||row.media_product_type==='REELS'||post.href.includes('/reel/'))&&row.view_count==null))links.add(post.href);
 }
 return [...links].slice(0,13);
}

const labels:Record<string,string>={
 followers:'followers_count',following:'follows_count',posts:'media_count',
 likes:'like_count',comments:'comments_count',views:'view_count',
 '팔로워':'followers_count','팔로잉':'follows_count','게시물':'media_count',
 '좋아요':'like_count','댓글':'comments_count','조회수':'view_count','조회':'view_count'
};
const amount=String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:[KMB천만억])?`;
const english=new RegExp('^('+amount+')\\s+(followers?|following|posts?|likes?|comments?|views?)\\b','i');
const korean=new RegExp('^(팔로워|팔로잉|게시물|좋아요|댓글|조회수|조회)\\s*('+amount+')(?:\\s*[명개회])?(?![\\d가-힣])','i');
function profileIdentity(target:Target,title:unknown){
 const match=typeof title==='string' && /^(.{0,160}?)\s*\(@([a-z0-9._]{1,30})\)(?:\s*[•|·–—-].*|\s*on Instagram.*|\s*)$/i.exec(title.trim());
 if(!match||match[2].toLowerCase()!==target.username)return;
 return match[1].trim()?{username:match[2],name:match[1].trim()}:{username:match[2]};
}
export function readPublicResult(target:Target,hit:{url?:unknown,title?:unknown,snippet?:unknown,crawled_at?:unknown,source?:{captured_at?:unknown}}):PublicObservation|null{
 if(typeof hit?.url!=='string'||!/^https:\/\//i.test(hit.url))return null;
 const found=researchTarget(hit.url);
 if(found?.href!==target.href)return null;
 // Instagram's search description starts with labelled counts. Never read numbers out of captions.
 const snippet=typeof hit.snippet==='string'?hit.snippet.slice(0,700).trim():'';
 if(/this account is private|비공개 계정/i.test(snippet))return null;
 const counts:Record<string,string>={};
 let rest=snippet;
 for(let i=0;i<4;i++){
  const en=english.exec(rest),ko=korean.exec(rest),m=en||ko;
  if(!m)break;
  const label=(en?m[2]:m[1]).toLowerCase();
  const key=labels[label]||labels[label+'s'];
  if(!key||!(target.username?profileKeys:[...postKeys,'view_count']).includes(key))break;
  counts[key]=(en?m[1]:m[2]).trim();
  const tail=rest.slice(m[0].length);
  if(!/^\s*[,·|•]\s*/.test(tail))break;
  rest=tail.replace(/^\s*[,·|•]\s*/,'');
 }
 const profile=target.username?profileIdentity(target,hit.title):undefined;
 if(!Object.keys(counts).length&&!profile)return null;
 const stamp=hit.source?.captured_at??hit.crawled_at;
 return {url:target.href,counts,...(profile?{profile:profile as Record<string,string>}:{}),capturedAt:typeof stamp==='string'&&Number.isFinite(Date.parse(stamp))?new Date(stamp).toISOString():null};
}
export function publicNumber(display:string):number|null{
 const m=/^(\d[\d,]*(?:\.\d+)?)\s*([kmb천만억]?)$/i.exec(display);
 if(!m)return null;
 const units:Record<string,number>={'':1,k:1e3,m:1e6,b:1e9,'천':1e3,'만':1e4,'억':1e8};
 const value=Number(m[1].replaceAll(',',''))*units[m[2].toLowerCase()];
 return Number.isSafeInteger(value)?value:null;
}
export function supplement(row:Fields|undefined,o:PublicObservation|undefined):Fields{
 const fields={...row};
 for(const [key,display] of Object.entries(o?.counts||{})){
  if(fields[key]==null)fields[key]=publicNumber(display);
 }
 return fields;
}
