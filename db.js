const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
async function migrate() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'warming.sql'), 'utf8'));
  await pool.query(fs.readFileSync(path.join(__dirname, 'mcp.sql'), 'utf8'));
}
module.exports = { pool, migrate };
