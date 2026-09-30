const crypto = require('node:crypto');
const { promisify } = require('node:util');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const scrypt=promisify(crypto.scrypt);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const random=()=>crypto.randomBytes(32).toString('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&crypto.timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
const scope='warming:read warming:write';
function configuration(env) {
 if(!env.MCP_PUBLIC_URL&&!env.MCP_LOGIN_SECRET_HASH&&!env.MCP_CLIENT_SECRET) return null;
 const url=new URL(env.MCP_PUBLIC_URL);
 if((url.protocol!=='https:'&&!(env.NODE_ENV==='test'&&url.hostname==='127.0.0.1'))||url.pathname!=='/'||url.search||url.hash||url.username||url.password) throw new Error('MCP_PUBLIC_URL must be the public HTTPS origin without a path.');
 if(!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(env.MCP_LOGIN_SECRET_HASH||'')) throw new Error('Invalid MCP_LOGIN_SECRET_HASH; use node scripts/generate-mcp-secrets.js.');
 if((env.MCP_CLIENT_SECRET||'').length<32||equal(env.MCP_CLIENT_SECRET,env.API_KEY||'')) throw new Error('MCP_CLIENT_SECRET must be a separate random secret of at least 32 characters.');
 return {base:url.origin,resource:url.origin+'/mcp',clientId:'picapex-chatgpt',clientSecret:env.MCP_CLIENT_SECRET,loginHash:env.MCP_LOGIN_SECRET_HASH,epoch:hash(env.MCP_LOGIN_SECRET_HASH+env.MCP_CLIENT_SECRET)};
}
function mountAuth(app,pool,config) {
 const {base,resource,clientId,clientSecret,loginHash,epoch}=config;
 const challenge=`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="${scope}"`;
 const run=fn=>async(req,res,next)=>{try{await fn(req,res,next);}catch{res.status(500).json({error:'server_error'});}};
 const error=(res,value='invalid_request',status=400)=>res.status(status).json({error:value});
 const put=(token,kind,payload,seconds)=>pool.query("INSERT INTO mcp_oauth_records(key,kind,payload,expires_at) VALUES($1,$2,$3,NOW()+($4 * interval '1 second'))",[hash(token),kind,JSON.stringify({...payload,epoch}),seconds]);
 async function consume(token,kind) {
  if(typeof token!=='string'||token.length>200) return null;
  const {rows}=await pool.query('DELETE FROM mcp_oauth_records WHERE key=$1 AND kind=$2 AND expires_at>NOW() RETURNING payload',[hash(token),kind]);
  return rows[0]?.payload.epoch===epoch?rows[0].payload:null;
 }
 const validRedirect=value=>typeof value==='string'&&/^https:\/\/chatgpt\.com\/(?:connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9_-]+)$/.test(value);
 app.get(['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'],(req,res)=>res.json({resource,authorization_servers:[base],scopes_supported:scope.split(' '),bearer_methods_supported:['header']}));
 app.get('/.well-known/oauth-authorization-server',(req,res)=>res.json({issuer:base,authorization_endpoint:base+'/oauth/authorize',token_endpoint:base+'/oauth/token',revocation_endpoint:base+'/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['client_secret_basic','client_secret_post'],scopes_supported:scope.split(' '),authorization_response_iss_parameter_supported:true}));
 const oauth=express.Router();
 oauth.use((req,res,next)=>{res.set({'Cache-Control':'no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});next();});
 // Shared process-wide cap is conservative behind proxies and does not trust forged forwarding headers.
 oauth.use(rateLimit({windowMs:60000,limit:60,keyGenerator:()=> 'oauth',standardHeaders:'draft-8',legacyHeaders:false}));
 oauth.use(express.urlencoded({extended:false,limit:'8kb'}));
 oauth.get('/authorize',run(async(req,res)=>{
  const q=req.query;
  if(q.client_id!==clientId||!validRedirect(q.redirect_uri)||q.response_type!=='code'||q.code_challenge_method!=='S256'||typeof q.code_challenge!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(q.code_challenge)||q.resource!==resource||typeof q.state!=='string'||q.state.length>2048) return error(res);
  if(q.scope!==undefined&&(typeof q.scope!=='string'||q.scope.split(' ').sort().join(' ')!==scope.split(' ').sort().join(' '))) return error(res,'invalid_scope');
  await pool.query('DELETE FROM mcp_oauth_records WHERE expires_at<NOW()');
  const nonce=random();
  await put(nonce,'approval',{redirect:q.redirect_uri,state:q.state,challenge:q.code_challenge,resource,clientId},600);
  res.type('html').send(`<!doctype html><html lang="lv"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Picapex CRM — ChatGPT</title><style>body{font:18px system-ui;max-width:560px;margin:60px auto;padding:24px}input,button{font:inherit;padding:12px;box-sizing:border-box;width:100%;margin:12px 0}button{background:#184c3a;color:white;border:0;border-radius:8px}</style><h1>Savienot Picapex CRM</h1><p>Atļaut ChatGPT meklēt un pievienot restorānus, papildināt kontaktinformāciju un saglabāt vizītes, piezīmes un nākamās darbības tikai sadaļā <strong>Klienti sildīšanai</strong>.</p><p>Piekļuve citām CRM sadaļām netiek piešķirta.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="nonce" value="${nonce}"><label>MCP pieslēguma parole<input type="password" name="password" autocomplete="current-password" required maxlength="200"></label><button>Atļaut piekļuvi</button></form><p>Izmanto atsevišķo MCP paroli.</p></html>`);
 }));
 oauth.post('/authorize',run(async(req,res)=>{
  if(req.headers.origin&&req.headers.origin!==base) return error(res,'access_denied',403);
  const approval=await consume(req.body.nonce,'approval');
  if(!approval||typeof req.body.password!=='string'||req.body.password.length>200) return error(res,'access_denied',403);
  const [salt,expected]=loginHash.split(':');
  const actual=await scrypt(req.body.password,salt,64);
  if(!crypto.timingSafeEqual(actual,Buffer.from(expected,'hex'))) return error(res,'access_denied',403);
  const code=random(); await put(code,'code',approval,120);
  const redirect=new URL(approval.redirect); redirect.searchParams.set('code',code); redirect.searchParams.set('state',approval.state); redirect.searchParams.set('iss',base);
  res.redirect(303,redirect.toString());
 }));
 function client(req) {
  let id=req.body.client_id,secret=req.body.client_secret;
  if(req.headers.authorization?.startsWith('Basic ')) {
   const value=Buffer.from(req.headers.authorization.slice(6),'base64').toString(); const split=value.indexOf(':');
   try {id=decodeURIComponent(value.slice(0,split));secret=decodeURIComponent(value.slice(split+1));}catch{return false;}
  }
  return id===clientId&&equal(secret,clientSecret);
 }
 oauth.post('/token',run(async(req,res)=>{
  if(!client(req)) return error(res,'invalid_client',401);
  if(req.body.resource!==resource) return error(res,'invalid_target');
  let grant;
  if(req.body.grant_type==='authorization_code') {
   const approval=await consume(req.body.code,'code');
   if(!approval||approval.redirect!==req.body.redirect_uri||approval.clientId!==clientId||approval.resource!==resource||typeof req.body.code_verifier!=='string'||! /^[A-Za-z0-9._~-]{43,128}$/.test(req.body.code_verifier)||!equal(crypto.createHash('sha256').update(req.body.code_verifier).digest('base64url'),approval.challenge)) return error(res,'invalid_grant');
   grant=random();
  } else if(req.body.grant_type==='refresh_token') {
   if(typeof req.body.refresh_token!=='string'||req.body.refresh_token.length>200) return error(res,'invalid_grant');
   const key=hash(req.body.refresh_token);
   const {rows}=await pool.query("UPDATE mcp_oauth_records SET kind='used_refresh' WHERE key=$1 AND kind='refresh' AND expires_at>NOW() RETURNING payload",[key]);
   const previous=rows[0]?.payload;
   if(!previous||previous.epoch!==epoch||previous.clientId!==clientId||previous.resource!==resource) {
    const used=(await pool.query("SELECT payload FROM mcp_oauth_records WHERE key=$1 AND kind='used_refresh'",[key])).rows[0]?.payload;
    if(used) await pool.query("DELETE FROM mcp_oauth_records WHERE payload->>'grant'=$1",[used.grant]);
    return error(res,'invalid_grant');
   }
   grant=previous.grant;
  } else return error(res,'unsupported_grant_type');
  const access=random(),refresh=random();
  const payload=JSON.stringify({grant,epoch,clientId,resource,scope});
  await pool.query("INSERT INTO mcp_oauth_records(key,kind,payload,expires_at) VALUES($1,'access',$3,NOW()+interval '1 hour'),($2,'refresh',$3,NOW()+interval '30 days')",[hash(access),hash(refresh),payload]);
  res.json({access_token:access,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope});
 }));
 oauth.post('/revoke',run(async(req,res)=>{
  if(!client(req)) return error(res,'invalid_client',401);
  if(typeof req.body.token!=='string'||req.body.token.length>200) return error(res);
  await pool.query("DELETE FROM mcp_oauth_records WHERE payload->>'grant'=(SELECT payload->>'grant' FROM mcp_oauth_records WHERE key=$1)",[hash(req.body.token)]);
  res.status(200).end();
 }));
 app.use('/oauth',oauth);
 return run(async(req,res,next)=>{
  if(req.headers.origin&&req.headers.origin!==base&&req.headers.origin!=='https://chatgpt.com') return res.status(403).json({error:'Forbidden origin'});
  const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization||'');
  const entry=match?(await pool.query("SELECT payload FROM mcp_oauth_records WHERE key=$1 AND kind='access' AND expires_at>NOW()",[hash(match[1])])).rows[0]?.payload:null;
  if(!entry||entry.epoch!==epoch||entry.resource!==resource||entry.scope!==scope) return res.status(401).set('WWW-Authenticate',challenge).json({error:'Unauthorized'});
  req.auth={token:match[1],clientId,scopes:scope.split(' ')};next();
 });
}
module.exports={configuration,mountAuth};
