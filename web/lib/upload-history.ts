import {researchTarget} from './research-target';

export type Upload={timestamp:string,permalink:string|null};
export type UploadHistory={first?:Upload,latest?:Upload,status:string};
type HistoryPage={rows:Record<string,unknown>[],total:number|null,after:string|null,more:boolean,status:string};
export function mediaPage(data:Record<string,unknown>|null|undefined):HistoryPage|null{
 const media=data?.media as {data?:Record<string,unknown>[],paging?:{cursors?:{after?:unknown},next?:unknown}}|undefined;
 if(!Array.isArray(media?.data))return null;
 const after=media.paging?.cursors?.after;
 return {rows:media.data.map(({id,permalink,timestamp})=>({id,permalink,timestamp})),total:typeof data?.media_count==='number'?data.media_count:null,
  after:typeof after==='string'&&validCursor(after)?after:null,more:Boolean(media.paging?.next||after),status:'조회 완료'};
}
export function validCursor(x:unknown):x is string{return typeof x==='string'&&/^[a-z0-9_+=/%.-]{1,4096}$/i.test(x);}
export function upload(row:Record<string,unknown>):Upload|undefined{
 if(typeof row.timestamp!=='string'||!Number.isFinite(Date.parse(row.timestamp)))return;
 const target=typeof row.permalink==='string'?researchTarget(row.permalink):null;
 return {timestamp:new Date(row.timestamp).toISOString(),permalink:target&&!target.username?target.href:null};
}
export async function scanUploads(read:(cursor:string|null)=>Promise<HistoryPage>,initialTotal:number|null):Promise<UploadHistory>{
 const visited=new Set<string>(),items=new Set<string>();
 let cursor:string|null=null,total=initialTotal,first:Upload|undefined,latest:Upload|undefined,undated=false;
 for(;;){
  let page:HistoryPage;
  try{page=await read(cursor);}catch{return {latest,status:'전체 이력 조회 중단'};}
  const previousSize=items.size;
  if(page.status!=='조회 완료')return {latest,status:page.status};
  total=page.total??total;
  for(const row of page.rows){
   const id=row.id||row.permalink;
   if(typeof id!=='string') {undated=true;continue;}
   items.add(id);
   const post=upload(row);
   if(!post){undated=true;continue;}
   if(!first||post.timestamp<first.timestamp)first=post;
   if(!latest||post.timestamp>latest.timestamp)latest=post;
  }
  if(total!==null&&items.size===total&&!undated)return {first,latest,status:total?'확인 완료':'공개 게시물 없음'};
  if(items.size===previousSize||!page.more||!page.rows.length||!page.after||visited.has(page.after))return {latest,status:'전체 이력 확인 불가'};
  visited.add(page.after);cursor=page.after;
 }
}
