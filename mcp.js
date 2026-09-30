const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const {createServer}=require('./mcp-tools');
const {configuration,mountAuth}=require('./mcp-auth');
module.exports=function mountMcp(app,pool,env=process.env) {
 const config=configuration(env);
 if(!config) return; // Disabled until all independent credentials are configured.
 const auth=mountAuth(app,pool,config);
 const port=Number(env.PORT||3000);
 async function api(path='',method='GET',body) {
  // Fixed loopback origin and fixed route: no caller-controlled URL or general CRM access.
  if(!/^(?:\/[1-9]\d*(?:\/(?:notes|interactions))?)?$/.test(path)) throw new Error('Neatļauts API ceļš.');
  const response=await fetch(`http://127.0.0.1:${port}/api/warming-restaurants${path}`,{method,headers:{'x-api-key':env.API_KEY,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  if(!response.ok) {const error=new Error(data.error||'CRM darbība neizdevās.');error.candidates=data.candidates;throw error;}
  return data;
 }
 app.post('/mcp',auth,async(req,res)=>{
  const server=createServer({api,selectionSecret:config.clientSecret});
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>{transport.close().catch(()=>{});server.close().catch(()=>{});});
  try {await server.connect(transport);await transport.handleRequest(req,res,req.body);}
  catch {if(!res.headersSent)res.status(500).json({jsonrpc:'2.0',error:{code:-32603,message:'MCP request failed'},id:null});}
 });
 app.all('/mcp',auth,(req,res)=>res.status(405).set('Allow','POST').end());
};
