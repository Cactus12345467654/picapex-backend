const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {rigaDate,resolveDate}=require('../mcp-tools');
const {configuration}=require('../mcp-auth');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');

test('Riga calendar dates, DST, invalid dates and disabled configuration',()=>{
 assert.equal(rigaDate(new Date('2026-09-30T21:30:00Z')),'2026-10-01');
 assert.equal(resolveDate('rīt',new Date('2026-09-30T21:30:00Z')),'2026-10-02');
 assert.equal(resolveDate('rīt',new Date('2026-03-28T22:30:00Z')),'2026-03-30');
 assert.equal(resolveDate('vakar',new Date('2026-10-25T22:30:00Z')),'2026-10-25');
 assert.equal(resolveDate('parīt',new Date('2026-12-30T22:30:00Z')),'2027-01-02');
 for(const value of ['2026-02-30','nākamnedēļ','01.10.2026','2026-99-99']) assert.throws(()=>resolveDate(value));
 assert.equal(configuration({}),null);
 assert.throws(()=>configuration({MCP_PUBLIC_URL:'http://example.com'}));
});

test('OAuth and SDK end-to-end, isolated in-memory PostgreSQL; no production requests',async t=>{
 const db=new PGlite();
 for(const filename of ['warming.sql','mcp.sql','mcp.sql']) await db.exec(fs.readFileSync(path.join(__dirname,'..',filename),'utf8'));
 const app=express();app.use(express.json());
 const legacyKey='local-crm-test-key';
 const legacyAuth=(req,res,next)=>req.headers['x-api-key']===legacyKey?next():res.status(401).json({error:'Unauthorized'});
 app.use('/api/warming-restaurants',require('../warming')(db,legacyAuth));
 app.get('/api/contacts',legacyAuth,(req,res)=>res.json([{id:'legacy-only'}]));
 const listener=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base=`http://127.0.0.1:${listener.address().port}`,resource=base+'/mcp';
 const password=crypto.randomBytes(32).toString('base64url'),salt=crypto.randomBytes(16).toString('hex');
 const env={NODE_ENV:'test',PORT:String(listener.address().port),API_KEY:legacyKey,MCP_PUBLIC_URL:base,MCP_CLIENT_SECRET:crypto.randomBytes(32).toString('base64url'),MCP_LOGIN_SECRET_HASH:salt+':'+crypto.scryptSync(password,salt,64).toString('hex')};
 require('../mcp')(app,db,env);
 t.after(async()=>{await new Promise(resolve=>listener.close(resolve));await db.close();});
 const clientId='picapex-chatgpt',redirect='https://chatgpt.com/connector_platform_oauth_redirect';
 async function form(route,body,headers={}) {return fetch(base+route,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(body)});}
 async function issueCode(overrides={}) {
  const verifier=crypto.randomBytes(32).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  const args={client_id:clientId,redirect_uri:redirect,response_type:'code',resource,scope:'warming:read warming:write',state:'state-123',code_challenge:challenge,code_challenge_method:'S256',...overrides};
  const response=await fetch(base+'/oauth/authorize?'+new URLSearchParams(args));
  if(response.status!==200) return {response,verifier};
  assert.equal(response.headers.get('referrer-policy'),'strict-origin','Native HTML form POST must retain Origin without leaking OAuth query parameters.');
  const html=await response.text();
  const nonce=/name="nonce" value="([^"]+)"/.exec(html)[1];
  return {response,verifier,nonce};
 }
 async function exchange(code,verifier,extra={}) {return form('/oauth/token',{client_id:clientId,client_secret:env.MCP_CLIENT_SECRET,grant_type:'authorization_code',resource,redirect_uri:redirect,code,code_verifier:verifier,...extra});}
 async function login() {
  const a=await issueCode();
  const approval=await form('/oauth/authorize',{nonce:a.nonce,password},{Origin:base});
  assert.equal(approval.status,303);
  const location=new URL(approval.headers.get('location'));
  assert.equal(location.searchParams.get('iss'),base);assert.equal(location.searchParams.get('state'),'state-123');
  return {code:location.searchParams.get('code'),verifier:a.verifier};
 }
 const unauth=await fetch(resource,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':legacyKey},body:'{}'});
 assert.equal(unauth.status,401);assert.match(unauth.headers.get('WWW-Authenticate'),/oauth-protected-resource\/mcp/);
 assert.equal((await (await fetch(base+'/.well-known/oauth-protected-resource/mcp')).json()).resource,resource);
 const meta=await (await fetch(base+'/.well-known/oauth-authorization-server')).json();
 assert.deepEqual(meta.code_challenge_methods_supported,['S256']);
 assert.equal((await issueCode({redirect_uri:'https://evil.example/steal'})).response.status,400);
 assert.equal((await issueCode({code_challenge_method:'plain'})).response.status,400);
 assert.equal((await issueCode({resource:base+'/api/contacts'})).response.status,400);
 assert.equal((await issueCode({scope:'contacts:write'})).response.status,400);
 assert.equal((await issueCode({scope:'warming:read'})).response.status,400);
 const originProbe=await issueCode();
 for(const origin of ['null','https://evil.example']) {
  const blocked=await form('/oauth/authorize',{nonce:originProbe.nonce,password},{Origin:origin});
  assert.equal(blocked.status,403);assert.equal((await blocked.json()).reason,'origin_mismatch');
 }
 // Origin rejection happens before consuming the form or verifying the password.
 assert.equal((await form('/oauth/authorize',{nonce:originProbe.nonce,password},{Origin:base})).status,303);
 const rejected=await issueCode();
 const wrongPassword=await form('/oauth/authorize',{nonce:rejected.nonce,password:legacyKey},{Origin:base});
 assert.equal(wrongPassword.status,403);assert.equal((await wrongPassword.json()).reason,'password_mismatch');
 const reused=await form('/oauth/authorize',{nonce:rejected.nonce,password},{Origin:base});
 assert.equal(reused.status,403);assert.equal((await reused.json()).reason,'authorization_form_invalid_or_expired');
 const expired=await issueCode();
 await db.query("UPDATE mcp_oauth_records SET expires_at=NOW()-interval '1 second' WHERE key=$1",[crypto.createHash('sha256').update(expired.nonce).digest('hex')]);
 const timedOut=await form('/oauth/authorize',{nonce:expired.nonce,password},{Origin:base});
 assert.equal(timedOut.status,403);assert.equal((await timedOut.json()).reason,'authorization_form_invalid_or_expired');
 const wrongPKCE=await login();assert.equal((await exchange(wrongPKCE.code,'A'.repeat(43))).status,400);
 const valid=await login();
 assert.equal((await exchange(valid.code,valid.verifier,{client_secret:'incorrect'})).status,401);
 const tokens=await (await exchange(valid.code,valid.verifier)).json();assert.ok(tokens.access_token);assert.ok(tokens.refresh_token);
 assert.equal((await exchange(valid.code,valid.verifier)).status,400);
 assert.equal((await fetch(base+'/api/contacts',{headers:{Authorization:'Bearer '+tokens.access_token}})).status,401);
 assert.equal((await fetch(base+'/api/warming-restaurants',{headers:{Authorization:'Bearer '+tokens.access_token}})).status,401);
 assert.equal((await fetch(base+'/api/contacts',{headers:{'x-api-key':legacyKey}})).status,200);
 assert.equal((await fetch(resource,{method:'POST',headers:{Authorization:'Bearer '+tokens.access_token,Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
 const client=new Client({name:'local-integration-test',version:'1.0.0'});
 await client.connect(new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:'Bearer '+tokens.access_token}}}));
 t.after(()=>client.close());
 const list=await client.listTools();assert.equal(list.tools.length,8);assert.ok(list.tools.every(x=>!x.name.includes('delete')&&!x.name.includes('contacts')));
 async function call(name,args={}) {const r=await client.callTool({name,arguments:args});return {error:r.isError===true,data:JSON.parse(r.content[0].text)};}
 assert.equal((await call('get_riga_date')).data.timezone,'Europe/Riga');
 assert.equal((await call('search_restaurants',{name:'Local Test'})).data.count,0);
 const created=await call('create_restaurant',{name:'Local Test',address:'Testa 1',city:'Rīga',phone:'123'});assert.equal(created.error,false);
 const id=created.data.restaurant.id,target={restaurant_id:id,selection_token:created.data.selection_token};
 const duplicate=await call('create_restaurant',{name:' local  TEST ',address:'testa 1',city:'RĪGA'});assert.equal(duplicate.data.restaurant.id,id);assert.equal(duplicate.data.restaurant.existing,true);
 const uncertain=await call('create_restaurant',{name:'Local Test'});assert.equal(uncertain.error,true);assert.equal(uncertain.data.requires_clarification,true);
 const found=await call('search_restaurants',{name:'Local Test',address:'Testa 1',city:'Rīga'});assert.equal(found.data.requires_clarification,false);assert.ok(found.data.candidates[0].selection_token);
 assert.equal((await call('update_restaurant',{...target,selection_token:'forged',changes:{phone:'bad'}})).error,true);
 assert.equal((await call('update_restaurant',{...target,changes:{email:'person@example.test',interest_status:'considering',last_contact_date:'2026-09-30',next_action:'Piezvanīt',next_action_date:'rīt'}})).error,false);
 const visit={...target,request_id:'visit-local-0001',kind:'visit',occurred_on:'2026-10-01',summary:'Local test visit',contact_role:'manager',interest_status:'interested'};
 assert.equal((await call('record_interaction',visit)).error,false);assert.equal((await call('record_interaction',visit)).data.existing,true);
 assert.equal((await call('record_interaction',{...visit,summary:'Changed'})).error,true);
 assert.equal((await call('record_interaction',{...visit,request_id:'visit-local-old',occurred_on:'2026-09-01',interest_status:'not_interested'})).error,false);
 const note={...target,body:'Local test note',request_id:'note-local-0001'};
 const noteResult=await call('add_note',note);assert.equal(noteResult.error,false);
 assert.equal((await call('add_note',note)).data.note.id,noteResult.data.note.id);
 assert.equal((await call('add_note',{...note,body:'Changed'})).error,true);
 const repeated=await Promise.all([1,2].map(()=>call('add_note',{...note,request_id:'note-concurrent-0001',body:'Concurrent note'})));
 assert.equal(repeated[0].data.note.id,repeated[1].data.note.id);
 const history=(await call('get_restaurant_history',target)).data.restaurant;
 assert.equal(history.phone,'123');assert.equal(history.notes.length,2);assert.equal(history.interactions.length,2);assert.equal(history.interest_status,'interested');assert.equal(history.last_contact_date,'2026-10-01');
 assert.equal((await call('update_restaurant',{...target,changes:{last_contact_date:'2026-09-15',next_action:'Sūtīt informāciju',next_action_date:'2026-10-05'}})).data.restaurant.last_contact_date,'2026-09-15');
 const second=await call('create_restaurant',{name:'Local Test',address:'Testa 2',city:'Rīga'});
 const ambiguous=(await call('search_restaurants',{name:'Local Test'})).data;assert.equal(ambiguous.requires_clarification,true);assert.equal(ambiguous.count,2);assert.ok(ambiguous.candidates.every(x=>!x.selection_token));
 assert.equal((await call('get_restaurant_history',{...target,restaurant_id:second.data.restaurant.id})).error,true);
 assert.equal((await call('select_restaurant',{restaurant_id:id,confirmed_name:'Local Test',confirmed_address:'Wrong',confirmed_city:'Rīga',user_confirmation:'Testa 1'})).error,true);
 const selected=await call('select_restaurant',{restaurant_id:id,confirmed_name:'Local Test',confirmed_address:'Testa 1',confirmed_city:'Rīga',user_confirmation:'Domāju Testa 1 Rīgā.'});assert.ok(selected.data.selection_token);
 await db.query("UPDATE warming_restaurants SET address='Renamed 1' WHERE id=$1",[id]);
 assert.equal((await call('update_restaurant',{...target,changes:{phone:'wrong'}})).error,true);
 const refreshed=await form('/oauth/token',{client_id:clientId,client_secret:env.MCP_CLIENT_SECRET,grant_type:'refresh_token',resource,refresh_token:tokens.refresh_token});assert.equal(refreshed.status,200);
 const renewed=await refreshed.json();assert.notEqual(renewed.access_token,tokens.access_token);
 assert.equal((await form('/oauth/token',{client_id:clientId,client_secret:env.MCP_CLIENT_SECRET,grant_type:'refresh_token',resource,refresh_token:tokens.refresh_token})).status,400);
 assert.equal((await fetch(resource,{headers:{Authorization:'Bearer '+renewed.access_token}})).status,401);
 const freshLogin=await login();const freshTokens=await (await exchange(freshLogin.code,freshLogin.verifier)).json();
 assert.equal((await form('/oauth/revoke',{client_id:clientId,client_secret:env.MCP_CLIENT_SECRET,token:freshTokens.refresh_token})).status,200);
 assert.equal((await fetch(resource,{headers:{Authorization:'Bearer '+freshTokens.access_token}})).status,401);
 const rows=(await db.query('SELECT key,payload FROM mcp_oauth_records')).rows;
 assert.ok(rows.every(r=>r.key!==tokens.access_token&&!JSON.stringify(r).includes(password)));
});
