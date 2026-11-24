import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const db=new DatabaseSync(':memory:');
for(const sql of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(path.join('drizzle',sql),'utf8'));
const prepare=(sql,args=[])=>({bind:(...v)=>prepare(sql,v),first:async()=>db.prepare(sql).get(...args),all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:db.prepare(sql).run(...args)})});
globalThis.testEnv={CONSOLE_OWNER_EMAIL:'admin@example.test',DB:{prepare,batch:async xs=>Promise.all(xs.map(x=>x.all()))},BUCKET:{get:async k=>({body:k})}};
async function routes(entry){
 const out=await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'test-runtime',setup(b){
  b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'mock'}));
  b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='env'?'export const env=globalThis.testEnv;':'export const getChatGPTUser=async()=>globalThis.testUser;'}));
 }}]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
const [c,v,f]=await Promise.all(['console','viewers','files'].map(x=>routes('app/api/'+x+'/route.ts')));
function user(id,email){globalThis.testUser={userId:id,email};}
function post(body){return new Request('https://site.test/api',{method:'POST',headers:{origin:'https://site.test'},body:JSON.stringify(body)});}
const fileReq=new Request('https://site.test/api/files?id=f1');
user('admin-id','admin@example.test');
assert.equal((await c.POST(post({type:'account',id:'a1',handle:'local_test'}))).status,200);
assert.equal((await c.POST(post({type:'draft',id:'d1',account:'a1',title:'test draft',format:'feed'}))).status,200);
db.prepare('insert into files values(?,?,?,?,?,?,?)').run('f1','admin-id','d1','file.jpg',4,'today','stored-key');
user('guest-id','guest@gmail.com');
assert.equal((await c.GET()).status,403);assert.equal((await f.GET(fileReq)).status,403);
assert.equal((await v.POST(post({action:'add',email:'guest@gmail.com'}))).status,403);
user('admin-id','admin@example.test');
assert.equal((await v.POST(post({action:'add',email:' Guest@Gmail.com '}))).status,200);
user('guest-id','guest@gmail.com');
const shared=await (await c.GET()).json();assert.equal(shared.accounts[0].id,'a1');assert.equal(shared.drafts[0].id,'d1');assert.equal(shared.files[0].id,'f1');
assert.equal(await (await f.GET(fileReq)).text(),'stored-key');
assert.equal((await c.POST(post({type:'account',handle:'x'}))).status,403);
assert.equal((await f.POST(post({}))).status,403);assert.equal((await v.GET()).status,403);
user('admin-id','admin@example.test');
assert.equal((await v.POST(post({action:'remove',email:'guest@gmail.com'}))).status,200);
user('guest-id','guest@gmail.com');assert.equal((await c.GET()).status,403);assert.equal((await f.GET(fileReq)).status,403);
globalThis.testUser=null;assert.equal((await c.GET()).status,403);
console.log('PASS shared view, owner edits, unlisted access, download and revocation');
