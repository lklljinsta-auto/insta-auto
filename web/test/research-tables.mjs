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
assert.match(empty,/<td>API 미연결<\/td>/);assert.doesNotMatch(empty,/<iframe|<img/);
const data=render({status:'조회 완료',profile:{profile_picture_url:'https://example.org/photo.jpg'},media:[
 {view_count:0,comments_count:8,timestamp:'2026-11-01T10:00:00Z'},
 {view_count:20,comments_count:0,timestamp:'2026-11-03T10:00:00Z'},
 {view_count:null,comments_count:4,timestamp:'2026-11-05T10:00:00Z'}]});
for(const value of ['10<small>유효 2건','12<small>유효 3건','4<small>유효 3건','2일<small>간격 2개','src="https://example.org/photo.jpg"'])assert.ok(data.includes(value),value);
console.log('PASS field headers above values, no embed, real photo URL, missing vs zero and sample interval');
