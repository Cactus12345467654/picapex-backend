# Picapex backend

Production uses the existing `DATABASE_URL` (PostgreSQL) and `API_KEY`.
Startup applies the additive, idempotent `warming.sql` and `mcp.sql` migrations.
Existing contacts are not changed or imported.

See [VISITS-API.md](VISITS-API.md) for the CRM API and duplicate handling.
See [MCP-CHATGPT.md](MCP-CHATGPT.md) for the ChatGPT MCP connection, the three
independent Render environment variables, authentication and read-only smoke checks.

MCP exposes only **Klienti sildīšanai**. It remains disabled until its own
credentials are configured; it never changes the existing CRM API key.
Generate credentials locally with `node scripts/generate-mcp-secrets.js`.
The resulting `mcp-credentials.secret.json` is ignored by Git and must remain local.

Run `npm ci` and `npm test`. Tests use an isolated in-memory PostgreSQL-compatible
database and localhost HTTP server; they never write to the production CRM.
