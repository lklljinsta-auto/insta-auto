export const profileFields={
 profile_picture_url:'프로필 사진',username:'사용자 이름',name:'표시 이름',followers_count:'팔로워',follows_count:'팔로잉',media_count:'전체 게시물',biography:'소개',website:'웹사이트',id:'계정 ID',alt_text:'사진 대체 텍스트'
};
export const mediaFields={
 timestamp:'게시 시각 (한국시간)',media_product_type:'게시 위치',media_type:'형식',view_count:'조회수',like_count:'좋아요',comments_count:'댓글',reposts_count:'리포스트',caption:'캡션',permalink:'게시물 주소',id:'미디어 ID',shortcode:'게시물 코드',username:'작성자',media_url:'미디어 주소',thumbnail_url:'썸네일 주소',media_audio_type:'오디오 유형',is_shared_to_feed:'피드 공유 여부',total_comments_count:'광고 포함 댓글',total_like_count:'광고 포함 좋아요',alt_text:'대체 텍스트'
};
export type Fields=Record<string,string|number|boolean|null>;
export type Result={status:string,profile?:Fields,media?:Fields[]|null,mediaStatus?:string,checkedAt?:string};
export function summarize(rows:Fields[],key:string){
 const values=rows.map(r=>r[key]).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v)).sort((a,b)=>a-b);
 const n=values.length,sum=values.reduce((a,b)=>a+b,0);
 return {n,sum:n?sum:null,mean:n?sum/n:null,median:n?(values[Math.floor((n-1)/2)]+values[Math.floor(n/2)])/2:null};
}
export function intervals(rows:Fields[]){
 const times=rows.map(r=>typeof r.timestamp==='string'?Date.parse(r.timestamp):NaN).filter(Number.isFinite).sort((a,b)=>a-b);
 return {count:times.length,first:times[0],last:times.at(-1),hours:times.length>1?(times[times.length-1]-times[0])/3600000/(times.length-1):null};
}
