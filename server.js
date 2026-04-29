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
  const { status, notes, wa_sent, wa_replied, wa_not_exist, sms_sent, sms_replied, sms_not_exist, msg_sent, msg_replied, msg_not_exist, ig_sent, ig_replied, ig_not_exist, email_sent, email_replied, email_not_exist } = req.body;
  try {
    await pool.query(`
      UPDATE contacts SET
        status = COALESCE($1, status),
        notes = COALESCE($2, notes),
        wa_sent = COALESCE($3, wa_sent),
        wa_replied = COALESCE($4, wa_replied),
        wa_not_exist = COALESCE($5, wa_not_exist),
        sms_sent = COALESCE($6, sms_sent),
        sms_replied = COALESCE($7, sms_replied),
        sms_not_exist = COALESCE($8, sms_not_exist),
        msg_sent = COALESCE($9, msg_sent),
        msg_replied = COALESCE($10, msg_replied),
        msg_not_exist = COALESCE($11, msg_not_exist),
        ig_sent = COALESCE($12, ig_sent),
        ig_replied = COALESCE($13, ig_replied),
        ig_not_exist = COALESCE($14, ig_not_exist),
        email_sent = COALESCE($15, email_sent),
        email_replied = COALESCE($16, email_replied),
        email_not_exist = COALESCE($17, email_not_exist),
        last_message_at = NOW()
      WHERE id = $18
    `, [status, notes, wa_sent, wa_replied, wa_not_exist, sms_sent, sms_replied, sms_not_exist, msg_sent, msg_replied, msg_not_exist, ig_sent, ig_replied, ig_not_exist, email_sent, email_replied, email_not_exist, id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/contacts/:id', auth, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM contacts WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'ok', app: 'Picapex CRM' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
