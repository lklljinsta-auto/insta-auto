import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const output=await build({entryPoints:['app/research-tables.tsx'],platform:'node',bundle:true,jsx:'automatic',format:'cjs',external:['react','react/*'],write:false});
const module={exports:{}};new Function('module','exports','require',output.outputFiles[0].text)(module,module.exports,require);
const t={href:'https://www.instagram.com/sample/',username:'sample',label:'@sample'};
const render=result=>renderToStaticMarkup(React.createElement(module.exports.ResearchTables,{targets:[t],results:{[t.href]:result}}));
const empty=render({status:'API 미연결'});
assert.match(empty,/<thead>/);assert.match(empty,/평균 업로드 간격/);assert.match(empty,/프로필 사진/);
assert.match(empty,/<td colSpan="[0-9]+">API 미연결<\/td>/);assert.doesNotMatch(empty,/<iframe|<img/);
const data=render({status:'조회 완료',profile:{profile_picture_url:'https://example.org/photo.jpg'},media:[
 {view_count:0,comments_count:8,timestamp:'2026-11-01T10:00:00Z'},
 {view_count:20,comments_count:0,timestamp:'2026-11-03T10:00:00Z'},
 {view_count:null,comments_count:4,timestamp:'2026-11-05T10:00:00Z'}]});
for(const value of ['10<small>유효 2건','12<small>유효 3건','4<small>유효 3건','2일<small>간격 2개','src="https://example.org/photo.jpg"'])assert.ok(data.includes(value),value);
console.log('PASS field headers above values, no embed, real photo URL, missing vs zero and sample interval');
const long=render({status:'조회 완료',profile:{},media:[{caption:'긴 캡션\n'.repeat(800),permalink:'https://www.instagram.com/p/Exact/'}]});
assert.match(long,/<details class="research-long-text"><summary>[^\n<]{1,50}<\/summary>/);
const indexed=render({status:'조회 불가',publicReport:{failed:0,observations:[{url:t.href,counts:{followers_count:'1.2만'},capturedAt:null}]}});
assert.match(indexed,/1.2만<small>공개 검색/);
const second={href:'https://www.instagram.com/another/',username:'another',label:'@another'};
const grouped=renderToStaticMarkup(React.createElement(module.exports.ResearchTables,{targets:[t,second],results:{
 [t.href]:{status:'조회 완료',profile:{followers_count:0},media:[{like_count:1},{like_count:2}],publicReport:{failed:0,observations:[{url:t.href,source:'archive',counts:{followers_count:'999',follows_count:'17'},profile:{name:'Sample Archive'},capturedAt:'2026-11-20'}]}},
 [second.href]:{status:'조회 불가'}
}}));
assert.equal(grouped.match(/class="research-account-break"/g)?.length,1);
assert.ok(grouped.includes('Sample Archive')&&grouped.includes('17<small>공개 보관본')&&!grouped.includes('999'));
assert.match(grouped,/another<small>입력한 아이디/);
assert.equal((grouped.match(/<th scope="col">조회 (계정|대상)<\/th>/g)||[]).length,3);
