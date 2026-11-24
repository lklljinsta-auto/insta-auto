export type Target = {href:string, username:string|null, label:string};

export function researchTarget(input:string):Target|null {
 const value=input.trim();
 if(!value||value.length>2048)return null;
 let path=value.replace(/^@/,'');
 if(/^(?:https?:\/\/|(?:www\.)?instagram\.com\/)/i.test(value)){
  let url:URL;
  try{url=new URL(/^https?:/i.test(value)?value:'https://'+value);}catch{return null;}
  if(!['instagram.com','www.instagram.com','m.instagram.com'].includes(url.hostname)||url.username||url.password||url.port)return null;
  path=url.pathname.replace(/^\/|\/$/g,'');
  const post=/^(p|reel|reels|tv)\/([A-Za-z0-9_-]+)$/.exec(path);
  if(post){
   const kind=post[1]==='reels'?'reel':post[1];
   return {href:'https://www.instagram.com/'+kind+'/'+post[2]+'/',username:null,label:(kind==='reel'?'릴스':'게시물')+' · '+post[2]};
  }
 }
 const username=path.toLowerCase();
 if(!/^[a-z0-9._]{1,30}$/.test(username)||['.','..','accounts','reels','reel','p','tv','stories','explore','direct','about','share'].includes(username))return null;
 return {href:'https://www.instagram.com/'+username+'/',username,label:'@'+username};
}
