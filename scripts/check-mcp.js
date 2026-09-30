// Read-only verification. Never calls a CRM mutation or creates a restaurant/note/visit.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
async function main() {
 const credentials=JSON.parse(fs.readFileSync(path.join(__dirname,'..','mcp-credentials.secret.json'),'utf8'));
 const base=credentials.MCP_PUBLIC_URL,resource=base+'/mcp';
 assert.equal(base,'https://picapex-backend.onrender.com');
 const metadata=await fetch(base+'/.well-known/oauth-protected-resource/mcp');
 assert.equal(metadata.status,200,'MCP is not yet enabled/deployed; configure all three Render variables.');
 assert.equal((await metadata.json()).resource,resource);
 const unauthorized=await fetch(resource,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 assert.equal(unauthorized.status,401);
 const verifier=crypto.randomBytes(32).toString('base64url'),state=crypto.randomBytes(16).toString('hex');
 const redirect='https://chatgpt.com/connector_platform_oauth_redirect';
 const form=(route,body)=>fetch(base+route,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
 const params={client_id:credentials.chatgpt_client_id,redirect_uri:redirect,response_type:'code',resource,state,scope:'warming:read warming:write',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'};
 const page=await fetch(base+'/oauth/authorize?'+new URLSearchParams(params));
 assert.equal(page.status,200);
 const nonce=/name="nonce" value="([^"]+)"/.exec(await page.text())?.[1];assert.ok(nonce);
 const approval=await form('/oauth/authorize',{nonce,password:credentials.mcp_login_password});assert.equal(approval.status,303);
 const callback=new URL(approval.headers.get('location'));assert.equal(callback.searchParams.get('state'),state);
 const tokenResponse=await form('/oauth/token',{client_id:credentials.chatgpt_client_id,client_secret:credentials.MCP_CLIENT_SECRET,grant_type:'authorization_code',resource,redirect_uri:redirect,code:callback.searchParams.get('code'),code_verifier:verifier});
 assert.equal(tokenResponse.status,200);const tokens=await tokenResponse.json();
 const client=new Client({name:'picapex-readonly-check',version:'1.0.0'});
 try {
  await client.connect(new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:'Bearer '+tokens.access_token}}}));
  const {tools}=await client.listTools();assert.equal(tools.length,8);
  const date=await client.callTool({name:'get_riga_date',arguments:{}});assert.ok(!date.isError);
  assert.equal((await fetch(base+'/api/contacts',{headers:{Authorization:'Bearer '+tokens.access_token}})).status,401);
  console.log('PASS: OAuth, MCP initialization, 8 tools, Riga date, legacy API isolation. No CRM records created or changed.');
 } finally {
  await client.close();
  const revoked=await form('/oauth/revoke',{client_id:credentials.chatgpt_client_id,client_secret:credentials.MCP_CLIENT_SECRET,token:tokens.refresh_token});
  assert.equal(revoked.status,200);
 }
}
main().catch(()=>{console.error('MCP check failed. Verify deployment, all three Render variables and local credential file; no secrets are printed.');process.exitCode=1;});
