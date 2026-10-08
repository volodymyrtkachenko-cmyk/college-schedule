const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/api.ts'),'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const response = (body,status=200) => ({ok:status<400,status,json:async()=>body});
function setup(fetch) {
 const ctx={exports:{},process:{env:{}},Headers,console,fetch};vm.runInNewContext(code,ctx);return ctx.exports.api;
}
test('notes save carries the calendar anchor, original revision and bearer authentication',async()=>{
 let sent;
 const api=setup(async(url,options)=>{
  if(url.endsWith('/login')) return response({access_token:'fake-test-token',user:{id:1,username:'test'},token_type:'bearer'});
  sent={url,options};return response({id:3,note:'Text',revision:8});
 });
 await api.auth.login('test','fake');
 const result=await api.notes.save(4,'2026-10-05',2,9,'Text',7);
 assert.ok(sent.url.endsWith('/api/lesson-notes/4/2026-10-05/2'));
 assert.equal(sent.options.method,'PUT');
 assert.deepEqual(JSON.parse(sent.options.body),{subject_id:9,note:'Text',expected_revision:7});
 assert.equal(sent.options.headers.get('Authorization'),'Bearer fake-test-token');
 assert.equal(result.revision,8);
});
test('revision conflict is surfaced; the client never retries with a fresh revision',async()=>{
 let writes=0;
 const api=setup(async(url)=>{
  if(url.endsWith('/refresh'))return response({access_token:'fake',user:{id:1},token_type:'bearer'});
  writes++;return response({detail:{code:'note_revision_changed',msg:'Conflict'}},409);
 });
 await assert.rejects(api.notes.save(1,'2026-10-05',1,1,'Draft',2));
 assert.equal(writes,1);
});
test('archive carries a revision and does not submit blank text',async()=>{
 let sent;
 const api=setup(async(url,options)=>{
  if(url.endsWith('/refresh'))return response({access_token:'fake',user:{id:1},token_type:'bearer'});
  sent={url,options};return response(null,204);
 });
 await api.notes.remove(1,'2026-10-05',1,8,6);
 assert.ok(sent.url.endsWith('/1/2026-10-05/1?subject_id=8&expected_revision=6'));
 assert.equal(sent.options.method,'DELETE');assert.equal(sent.options.body,undefined);
});
