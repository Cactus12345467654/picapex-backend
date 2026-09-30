// Output is an ignored local file, never stdout or source control.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const password=crypto.randomBytes(32).toString('base64url');
const salt=crypto.randomBytes(16).toString('hex');
const output=path.resolve(__dirname,'..','mcp-credentials.secret.json');
fs.writeFileSync(output,JSON.stringify({MCP_PUBLIC_URL:'https://picapex-backend.onrender.com',MCP_CLIENT_SECRET:crypto.randomBytes(32).toString('base64url'),MCP_LOGIN_SECRET_HASH:salt+':'+crypto.scryptSync(password,salt,64).toString('hex'),chatgpt_client_id:'picapex-chatgpt',mcp_login_password:password},null,2)+'\n',{flag:'wx',mode:0o600});
console.log('Credentials saved to '+output+'. Do not commit or share this file.');
