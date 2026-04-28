const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const API_KEY = process.env.API_KEY || 'picapex2026';

function auth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/contacts', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM contacts ORDER BY id');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/contacts/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { status, notes, wa_sent, wa_replied, msg_sent, msg_replied, ig_sent, ig_replied, email_sent, email_replied } = req.body;
  try {
    await pool.query(`
      UPDATE contacts SET
        status = COALESCE($1, status),
        notes = COALESCE($2, notes),
        wa_sent = COALESCE($3, wa_sent),
        wa_replied = COALESCE($4, wa_replied),
        msg_sent = COALESCE($5, msg_sent),
        msg_replied = COALESCE($6, msg_replied),
        ig_sent = COALESCE($7, ig_sent),
        ig_replied = COALESCE($8, ig_replied),
        email_sent = COALESCE($9, email_sent),
        email_replied = COALESCE($10, email_replied),
        last_message_at = NOW()
      WHERE id = $11
    `, [status, notes, wa_sent, wa_replied, msg_sent, msg_replied, ig_sent, ig_replied, email_sent, email_replied, id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'ok', app: 'Picapex CRM' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
