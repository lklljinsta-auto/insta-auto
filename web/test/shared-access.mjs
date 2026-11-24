import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const db=new DatabaseSync(':memory:');
for(const sql of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(path.join('drizzle',sql),'utf8'));
const prepare=(sql,args=[])=>({bind:(...v)=>prepare(sql,v),first:async()=>db.prepare(sql).get(...args),all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:db.prepare(sql).run(...args)})});
globalThis.testEnv={CONSOLE_OWNER_EMAIL:'admin@example.test',CONSOLE_SECOND_ADMIN_EMAIL:'second@gmail.com',CONSOLE_SHARED_WORKSPACE:'shared',DB:{prepare,batch:async xs=>Promise.all(xs.map(x=>x.all()))},BUCKET:{get:async k=>({body:k}),put:async()=>{}}};
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
const access=await routes('lib/console-access.ts');
for(const [userId,email,label] of [['one','admin@example.test','메인 관리자'],['two','second@gmail.com','서브 관리자']]){
 assert.deepEqual(await access.consoleAccess({userId,email}),{owner:'shared',canEdit:true,manageUsers:true,label});
}
const fileReq=new Request('https://site.test/api/files?id=f1');
user('admin-id','admin@example.test');
assert.equal((await c.POST(post({type:'account',id:'a1',handle:'local_test'}))).status,200);
assert.equal((await c.POST(post({type:'draft',id:'d1',account:'a1',title:'test draft',format:'feed'}))).status,200);
db.prepare('insert into files values(?,?,?,?,?,?,?)').run('f1','shared','d1','file.jpg',4,'today','stored-key');
user('second-id','Second@Gmail.com');
const prior=await (await c.GET()).json();
assert.equal(prior.accounts[0].id,'a1');assert.equal(prior.drafts[0].id,'d1');
assert.equal(await (await f.GET(fileReq)).text(),'stored-key');
assert.equal((await c.POST(post({type:'draft',id:'d1',account:'a1',format:'feed',title:'edited by second admin'}))).status,200);
assert.equal((await v.POST(post({action:'add',email:'second@gmail.com'}))).status,400);
user('admin-id','admin@example.test');
assert.equal((await (await c.GET()).json()).drafts[0].title,'edited by second admin');
user('guest-id','guest@gmail.com');
assert.equal((await c.GET()).status,403);assert.equal((await f.GET(fileReq)).status,403);
assert.equal((await v.POST(post({action:'add',email:'guest@gmail.com'}))).status,403);
user('admin-id','admin@example.test');
assert.equal((await v.POST(post({action:'add',email:' Guest@Gmail.com '}))).status,200);
user('guest-id','guest@gmail.com');
const records=async()=> (await c.GET()).json();
const upload=draft=>new Request('https://site.test/api/files?draft='+draft+'&name=image.jpg',{method:'POST',headers:{origin:'https://site.test','content-length':'4'},body:'test'});
const download=id=>new Request('https://site.test/api/files?id='+id);
assert.deepEqual(await records(),{accounts:[],drafts:[],files:[],targets:[]});
assert.equal((await f.GET(fileReq)).status,404);
for(let i=2;i<=6;i++){
 assert.equal((await c.POST(post({type:'account',id:'a'+i,handle:'account_'+i}))).status,200);
 assert.equal((await c.POST(post({type:'draft',id:'d'+i,account:'a'+i,format:'reel',title:'item '+i}))).status,200);
}
const ownFile=await (await f.POST(upload('d2'))).json();assert.ok(ownFile.id);
assert.equal((await c.POST(post({type:'research',targets:['https://www.instagram.com/test/']}))).status,200);
const first=await records();
assert.deepEqual(Object.values(first).map(rows=>rows.length),[5,5,1,1]);
assert.equal((await v.POST(post({action:'add',email:'another@gmail.com'}))).status,403);
user('second-id','second@gmail.com');
assert.equal((await v.POST(post({action:'add',email:'another@gmail.com'}))).status,200);
assert.equal((await c.POST(post({type:'account',id:'a2',handle:'edited_by_admin'}))).status,200);
assert.equal((await c.POST(post({type:'draft',account:'a2',format:'feed',title:'admin contribution'}))).status,200);
assert.equal((await f.POST(upload('d2'))).status,200);
user('another-id','another@gmail.com');
assert.deepEqual(await records(),{accounts:[],drafts:[],files:[],targets:[]});
assert.equal((await c.POST(post({type:'account',id:'other',handle:'another_account'}))).status,200);
assert.equal((await c.POST(post({type:'account',id:'a2',handle:'cannot_edit'}))).status,403);
assert.equal((await c.POST(post({type:'draft',id:'d2',account:'a2',format:'feed',title:'cannot_edit'}))).status,400);
assert.equal((await c.POST(post({type:'draft',id:'d2',account:'other',format:'feed',title:'cannot_move'}))).status,409);
for(const [kind,id] of [['account','a2'],['draft','d3'],['research',first.targets[0].id]]){
 assert.equal((await c.POST(post({type:'remove',kind,id}))).status,409);
}
assert.equal((await f.GET(download(ownFile.id))).status,404);
assert.equal((await f.POST(upload('d2'))).status,404);
assert.equal((await v.GET()).status,403);
user('guest-id','guest@gmail.com');
const after=await records();assert.equal(after.accounts.length,5);assert.ok(after.accounts.some(a=>a.handle==='edited_by_admin'));
assert.equal(after.drafts.length,6);assert.equal(after.files.length,2);
for(const [id,email] of [['admin-id','admin@example.test'],['second-id','second@gmail.com']]){
 user(id,email);assert.equal((await records()).accounts.length,7);
 assert.equal((await f.GET(download(ownFile.id))).status,200);
}
assert.equal((await v.POST(post({action:'remove',email:'guest@gmail.com'}))).status,200);
user('guest-id','guest@gmail.com');assert.equal((await c.GET()).status,403);assert.equal((await f.GET(download(ownFile.id))).status,403);
globalThis.testUser=null;assert.equal((await c.GET()).status,403);
console.log('PASS: two isolated operators, five accounts, legacy administrator access, shared administrator permissions, child ownership, file and mutation checks, revocation');
