import type {Fields} from './research-fields';

const quantity=String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*[KMB천만억]?`;
export function copiedProfile(text:string,handle:string):Fields|null{
 const lines=text.slice(0,4000).split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 const start=lines.findIndex(line=>line.replace(/^@/,'').toLowerCase()===handle);
 if(start<0)return null;
 const header=lines.slice(start,start+15).join('\n');
 const fields:Fields={username:handle};
 const metrics=[['media_count','게시물','posts?'],['followers_count','팔로워','followers?'],['follows_count','팔로잉','following']];
 for(const [key,ko,en] of metrics){
  const a=new RegExp('(?:^|[\\s·|,])'+ko+'\\s*('+quantity+')(?:개|명)?(?=$|[\\s·|,])','i').exec(header);
  const b=new RegExp('(?:^|[\\s·|,])('+quantity+')\\s+(?:'+en+')\\b','i').exec(header);
  const value=(a||b)?.[1]?.trim();
  if(value)fields[key]=value;
 }
 if(Object.keys(fields).length<2)return null;
 const candidate=lines[start+1];
 if(candidate&&candidate.length<=80&&!/[\d]|게시물|팔로워|팔로잉|프로필|팔로우|메시지|스레드|Instagram|follow|post|message|options/i.test(candidate))fields.name=candidate;
 return fields;
}
