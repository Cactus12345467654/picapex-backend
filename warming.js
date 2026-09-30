const express = require('express');
const fields = ['name','address','city','contact_person','phone','email','other_contact','last_contact_date','contact_role','interest_status','next_action','next_action_date'];
const roles = ['','owner','manager','salesperson','other'];
const interests = ['','unknown','interested','considering','not_interested'];
const norm = value => String(value || '').trim().replace(/\s+/g,' ').toLocaleLowerCase('lv');
function fail(message, status=400, candidates) { const e=new Error(message); e.status=status; e.candidates=candidates; throw e; }
function date(value) {
 if (value === null || value === '') return null;
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value) fail('Nederīgs datums; norādi YYYY-MM-DD.');
 return value;
}
function validate(body, creating=false, allowed=fields) {
 if (!body || typeof body!=='object' || Array.isArray(body)) fail('Nederīgi dati.');
 if (Object.keys(body).some(key=>!allowed.includes(key))) fail('Neatļauts lauks.');
 const result={};
 for (const [key,value] of Object.entries(body)) {
  if (key.endsWith('_date') || key==='occurred_on') { result[key]=date(value); continue; }
  if (typeof value!=='string' || value.length > (['other_contact','summary'].includes(key)?10000:500)) fail('Nederīgs lauks: '+key);
  result[key]=value.trim();
 }
 if ('contact_role' in result && !roles.includes(result.contact_role)) fail('Nederīga kontaktpersonas loma.');
 if ('interest_status' in result && !interests.includes(result.interest_status)) fail('Nederīgs intereses statuss.');
 if ('kind' in result && !['visit','call','email','message','other'].includes(result.kind)) fail('Nederīgs saziņas veids.');
 if ((creating || 'name' in result) && !result.name) fail('Norādi restorāna nosaukumu.');
 if (!Object.keys(result).length) fail('Nav izmaiņu.');
 return result;
}
module.exports = function(pool, auth) {
 const router=express.Router();
 router.use(auth);
 // PGlite serializes transactions; PostgreSQL uses one checked-out connection.
 async function transaction(fn) {
  if (typeof pool.transaction==='function') return pool.transaction(fn);
  const client=await pool.connect();
  try { await client.query('BEGIN'); const value=await fn(client); await client.query('COMMIT'); return value; }
  catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
 }
 const run=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){
  if(!e.status) console.error(e);
  res.status(e.status||500).json({error:e.status?e.message:'Neizdevās saglabāt vai ielādēt datus.', ...(e.candidates?{candidates:e.candidates}:{})});
 }};
 const select = `SELECT r.*, r.last_contact_date::text AS last_contact_date, r.next_action_date::text AS next_action_date,
 COALESCE((SELECT json_agg(n ORDER BY n.created_at,n.id) FROM (SELECT id,body,created_at FROM warming_notes WHERE restaurant_id=r.id) n),'[]'::json) AS notes,
 COALESCE((SELECT json_agg(v ORDER BY v.occurred_on NULLS LAST,v.created_at,v.id) FROM (SELECT *, occurred_on::text AS event_date FROM warming_interactions WHERE restaurant_id=r.id) v),'[]'::json) AS interactions
 FROM warming_restaurants r`;
 async function one(db,id) { return (await db.query(select+' WHERE r.id=$1',[id])).rows[0]; }
 async function identity(db,data,exclude) {
  const rows=(await db.query('SELECT id,name,address,city FROM warming_restaurants')).rows.filter(r=>r.id!==exclude && norm(r.name)===norm(data.name));
  const exact=rows.filter(r=>norm(r.address)===norm(data.address) && norm(r.city)===norm(data.city));
  const uncertain=rows.filter(r=>(!norm(r.address)||!norm(data.address)||norm(r.address)===norm(data.address)) && (!norm(r.city)||!norm(data.city)||norm(r.city)===norm(data.city)));
  if(exact.length===1 && norm(data.address)) return exact[0];
  if(uncertain.length) fail('Atrasti iespējami esoši restorāni. Izvēlies ierakstu pēc adreses vai precizē adresi un pilsētu.',409,uncertain);
  return null;
 }
 router.param('id',(req,res,next,id)=>{if(!/^[1-9]\d*$/.test(id)||Number(id)>2147483647)return res.status(400).json({error:'Nederīgs ID.'});next();});
 router.get('/',run(async(req,res)=>{
  let rows=(await pool.query(select+' ORDER BY r.created_at DESC,r.id DESC')).rows;
  if(req.query.q) rows=rows.filter(r=>norm([r.name,r.address,r.city].join(' ')).includes(norm(req.query.q)));
  res.json(rows);
 }));
 router.get('/:id',run(async(req,res)=>{const r=await one(pool,req.params.id);if(!r)fail('Restorāns nav atrasts.',404);res.json(r);}));
 router.post('/',run(async(req,res)=>{
  const data=validate(req.body,true);
  const result=await transaction(async db=>{
   await db.query('LOCK TABLE warming_restaurants IN SHARE ROW EXCLUSIVE MODE');
   const existing=await identity(db,data);
   if(existing) return {created:false,restaurant:await one(db,existing.id)};
   const keys=Object.keys(data);
   const {rows}=await db.query(`INSERT INTO warming_restaurants (${keys.join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`,Object.values(data));
   return {created:true,restaurant:await one(db,rows[0].id)};
  });
  res.status(result.created?201:200).json({...result.restaurant,existing:!result.created});
 }));
 router.patch('/:id',run(async(req,res)=>{
  const data=validate(req.body);
  const saved=await transaction(async db=>{
   await db.query('LOCK TABLE warming_restaurants IN SHARE ROW EXCLUSIVE MODE');
   const old=await one(db,req.params.id);if(!old)fail('Restorāns nav atrasts.',404);
   if(['name','address','city'].some(k=>k in data && norm(data[k])!==norm(old[k]))) {
    const match=await identity(db,{...old,...data},old.id);
    if(match)fail('Restorāns šajā adresē jau ir reģistrēts.',409,[match]);
   }
   const keys=Object.keys(data);
   await db.query(`UPDATE warming_restaurants SET ${keys.map((k,i)=>k+'=$'+(i+1)).join(',')},updated_at=NOW() WHERE id=$${keys.length+1}`,[...Object.values(data),req.params.id]);
   return one(db,req.params.id);
  });
  res.json(saved);
 }));
 router.post('/:id/notes',run(async(req,res)=>{
  if(!req.body || Object.keys(req.body).some(k=>k!=='body') || typeof req.body.body!=='string'||!req.body.body.trim()||req.body.body.length>10000)fail('Norādi piezīmi (līdz 10 000 rakstzīmēm).');
  const {rows}=await pool.query('INSERT INTO warming_notes (restaurant_id,body) SELECT id,$2 FROM warming_restaurants WHERE id=$1 RETURNING id,body,created_at',[req.params.id,req.body.body.trim()]);
  if(!rows.length)fail('Restorāns nav atrasts.',404);res.status(201).json(rows[0]);
 }));
 router.post('/:id/interactions',run(async(req,res)=>{
  const data=validate(req.body,false,['kind','occurred_on','summary','contact_person','contact_role','interest_status','next_action','next_action_date','request_id']);
  if(!data.request_id || !/^[a-zA-Z0-9_-]{8,100}$/.test(data.request_id))fail('Norādi unikālu request_id (8–100 simboli).');
  data.kind ||= 'visit';
  const payload=JSON.stringify(data);
  const result=await transaction(async db=>{
   await db.query('LOCK TABLE warming_restaurants IN SHARE ROW EXCLUSIVE MODE');
   const restaurant=await one(db,req.params.id);if(!restaurant)fail('Restorāns nav atrasts.',404);
   const previous=(await db.query('SELECT * FROM warming_interactions WHERE request_id=$1',[data.request_id])).rows[0];
   if(previous) {
    if(previous.restaurant_id!==Number(req.params.id)||JSON.stringify(Object.entries(previous.request_payload).sort())!==JSON.stringify(Object.entries(data).sort()))fail('request_id jau izmantots citam ierakstam.',409);
    return {existing:true,restaurant};
   }
   const keys=Object.keys(data);
   await db.query(`INSERT INTO warming_interactions (restaurant_id,request_payload,${keys.join(',')}) VALUES ($1,$2,${keys.map((_,i)=>'$'+(i+3)).join(',')})`,[req.params.id,payload,...Object.values(data)]);
   // Backdated or undated history must not overwrite a more recent dated snapshot.
   const current=!restaurant.last_contact_date || (data.occurred_on && data.occurred_on>=restaurant.last_contact_date);
   const updates={};
   if(current) {
    if(data.occurred_on) updates.last_contact_date=data.occurred_on;
    for(const key of ['contact_person','contact_role','interest_status','next_action','next_action_date']) if(key in data)updates[key]=data[key];
   }
   const updateKeys=Object.keys(updates);
   await db.query(`UPDATE warming_restaurants SET updated_at=NOW()${updateKeys.map((k,i)=>','+k+'=$'+(i+2)).join('')} WHERE id=$1`,[req.params.id,...Object.values(updates)]);
   return {existing:false,restaurant:await one(db,req.params.id)};
  });
  res.status(result.existing?200:201).json(result);
 }));
 return router;
};
