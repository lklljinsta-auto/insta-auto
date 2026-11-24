'use client';
import {useState} from 'react';
import {copiedProfile} from '../lib/profile-clipboard';
import type {Fields} from '../lib/research-fields';

export function CopiedProfile({handle,onRead}:{handle:string,onRead:(value:Fields)=>void}){
 const [message,setMessage]=useState('');
 return <details className="research-copy"><summary>공개 프로필 붙여넣기</summary>
 <label>Instagram에서 아이디부터 게시물·팔로워·팔로잉까지 복사해 붙여넣으세요.
 <textarea rows={2} aria-label={handle+' 프로필 붙여넣기'} onPaste={event=>{
  event.preventDefault();
  const data=event.clipboardData;
  const fields=copiedProfile(data.getData('text/plain'),handle);
  if(!fields){setMessage('@'+handle+' 아이디와 공개 수치가 함께 필요합니다.');return;}
  const template=document.createElement('template');
  template.innerHTML=data.getData('text/html').slice(0,120000);
  for(const image of template.content.querySelectorAll('img[alt][src]')){
   const alt=(image.getAttribute('alt')||'').toLowerCase();
   if(!alt.includes('프로필 사진')&&!alt.includes('profile picture'))continue;
   if(!alt.split(/[^a-z0-9._]+/).includes(handle))continue;
   try{const u=new URL(image.getAttribute('src')||'');
    if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(u.hostname))fields.profile_picture_url=u.href;
   }catch{}
  }
  onRead(fields);setMessage('표에 반영했습니다.');
 }}/></label><small role="status">{message}</small></details>;
}
