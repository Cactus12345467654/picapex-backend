CREATE TABLE IF NOT EXISTS warming_restaurants (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  contact_person TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  other_contact TEXT NOT NULL DEFAULT '',
  last_contact_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS warming_notes (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES warming_restaurants(id),
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS warming_notes_restaurant_idx ON warming_notes(restaurant_id, created_at, id);


ALTER TABLE warming_restaurants ADD COLUMN IF NOT EXISTS contact_role TEXT NOT NULL DEFAULT '' CHECK (contact_role IN ('','owner','manager','salesperson','other'));
ALTER TABLE warming_restaurants ADD COLUMN IF NOT EXISTS interest_status TEXT NOT NULL DEFAULT '' CHECK (interest_status IN ('','unknown','interested','considering','not_interested'));
ALTER TABLE warming_restaurants ADD COLUMN IF NOT EXISTS next_action TEXT NOT NULL DEFAULT '';
ALTER TABLE warming_restaurants ADD COLUMN IF NOT EXISTS next_action_date DATE;
CREATE TABLE IF NOT EXISTS warming_interactions (
 id SERIAL PRIMARY KEY,
 restaurant_id INTEGER NOT NULL REFERENCES warming_restaurants(id),
 kind TEXT NOT NULL DEFAULT 'visit' CHECK (kind IN ('visit','call','email','message','other')),
 occurred_on DATE,
 summary TEXT NOT NULL DEFAULT '',
 contact_person TEXT NOT NULL DEFAULT '',
 contact_role TEXT NOT NULL DEFAULT '' CHECK (contact_role IN ('','owner','manager','salesperson','other')),
 interest_status TEXT NOT NULL DEFAULT '' CHECK (interest_status IN ('','unknown','interested','considering','not_interested')),
 next_action TEXT NOT NULL DEFAULT '',
 next_action_date DATE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 request_id TEXT NOT NULL UNIQUE,
 request_payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS warming_interactions_restaurant_idx ON warming_interactions(restaurant_id,occurred_on,created_at);

