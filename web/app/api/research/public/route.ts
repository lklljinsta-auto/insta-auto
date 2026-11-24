import {archivedProfile} from '../../../../lib/public-profile';
import {consoleAccess} from '../../../../lib/console-access';
import {researchTarget} from '../../../../lib/research-target';
import {readPublicResult,type PublicObservation} from '../../../../lib/public-counts';

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(req:Request){
 if(!await consoleAccess()||req.headers.get('origin')!==new URL(req.url).origin)return json({error:'접근 권한 확인 필요'},403);
 const body=await req.json().catch(()=>null) as {links?:unknown}|null;
 const inputs=body?.links;
 if(!Array.isArray(inputs)||!inputs.length||inputs.length>13)return json({error:'주소를 확인하세요.'},400);
 const targets=inputs.map(input=>typeof input==='string'?researchTarget(input):null);
 if(targets.some(t=>!t))return json({error:'Instagram 주소를 확인하세요.'},400);
 const queue=[...new Map(targets.map(t=>[t!.href,t!])).values()];
 const observations:PublicObservation[]=[];
 let failed=0;
 const deadline=AbortSignal.timeout(7000);
 async function work(){
  while(queue.length&&!deadline.aborted){
   const target=queue.shift()!;
   const url=new URL('https://freeserp.ai/api.php');
   url.search=new URLSearchParams({index:'web',q:target.href,size:'5'}).toString();
   const archive=target.username?archivedProfile(target,deadline).then(value=>({value,failed:false}),()=>({value:null,failed:true})):null;
   let indexFailed=false;
   let indexed:PublicObservation|null=null;
   try{
    const terms=target.username?[target.href,target.username]:[target.href];
    for(const term of terms){
     url.searchParams.set('q',term);
     const response=await fetch(url,{cache:'no-store',redirect:'manual',signal:deadline});
     if(!response.ok)throw new Error('index unavailable');
     const data=await response.json() as {ok?:boolean,results?:Parameters<typeof readPublicResult>[1][]};
     if(data.ok===false||!Array.isArray(data.results))throw new Error('index unavailable');
     for(const hit of data.results){
      const observation=readPublicResult(target,hit);
      if(observation){indexed=observation;observations.push(indexed);break;}
     }
     if(indexed)break;
    }
   }catch{indexFailed=true;}
   if(archive){
    const snapshot=await archive;
    if(snapshot.value){observations.push(snapshot.value);indexFailed=false;}
    else if(snapshot.failed&&!indexed)indexFailed=true;
   }
   if(indexFailed)failed++;
  }
 }
 await Promise.all([work(),work(),work()]);
 return json({observations,failed:failed+queue.length});
}
