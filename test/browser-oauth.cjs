const {createRequire}=require('node:module');
const req=createRequire(require('node:path').join(__dirname,'..','package.json'));
const express=req('express'),{PGlite}=req('@electric-sql/pglite'),crypto=require('node:crypto'),fs=require('node:fs');
const root=require('node:path').join(__dirname,'..');
const {mountAuth}=req('./mcp-auth');
(async()=>{
 const db=new PGlite();await db.exec(fs.readFileSync(root+'/mcp.sql','utf8'));
 const app=express();app.use(express.json());
 const base='http://127.0.0.1:3197',password='local-browser-test',secret=crypto.randomBytes(32).toString('hex'),salt=crypto.randomBytes(16).toString('hex');
 const verifier=crypto.randomBytes(32).toString('base64url');
 const callback='https://chatgpt.com/connector_platform_oauth_redirect';
 app.get('/start',(q,s)=>s.redirect('/oauth/authorize?'+new URLSearchParams({client_id:'picapex-chatgpt',redirect_uri:callback,response_type:'code',resource:base+'/mcp',scope:'warming:read warming:write',state:'local-browser-test',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'})));
 app.use((q,s,next)=>{
  if(q.method==='POST'&&q.path==='/oauth/authorize'){
   s.on('finish',async()=>{
    const nonce=q.body?.nonce;
    const row=nonce?(await db.query('SELECT kind FROM mcp_oauth_records WHERE key=$1',[crypto.createHash('sha256').update(nonce).digest('hex')])).rows[0]:null;
    console.log(JSON.stringify({status:s.statusCode,origin_is_null:q.headers.origin==='null',origin_matches:q.headers.origin===base,nonce_present:!!nonce,nonce_still_valid:row?.kind==='approval',test_password_correct:q.body?.password===password}));
   });
   s.redirect=async(status,url)=>{
    const code=new URL(url).searchParams.get('code');
    const response=await fetch(base+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:'picapex-chatgpt',client_secret:secret,grant_type:'authorization_code',resource:base+'/mcp',redirect_uri:callback,code,code_verifier:verifier})});
    const tokens=await response.json();
    s.status(200).type('html').send('<h1>OAuth browser test</h1><p>Authorization accepted. PKCE token exchange: '+(response.ok&&!!tokens.access_token?'PASS':'FAIL')+'</p>');
   };
  }next();
 });
 mountAuth(app,db,{base,resource:base+'/mcp',clientId:'picapex-chatgpt',clientSecret:secret,loginHash:salt+':'+crypto.scryptSync(password,salt,64).toString('hex'),epoch:'local-test'});
 app.listen(3197,'127.0.0.1',()=>console.log('Browser probe ready at http://127.0.0.1:3197/start'));
})().catch(()=>{console.error('Local probe startup failed');process.exitCode=1;});

