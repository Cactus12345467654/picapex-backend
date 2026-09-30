# Visit / GPT integration contract (connection not enabled)

All endpoints require x-api-key. Base path: /api/warming-restaurants.
Restaurants, append-only interactions and append-only notes are separate entities.
Existing contacts are never copied. Migrations add fields/tables without deleting history.

Restaurant fields: name (only required field), address, city, contact_person, phone,
email, other_contact, last_contact_date, contact_role, interest_status, next_action,
next_action_date. Unknown text stays empty, unknown dates are null.

contact_role: empty, owner, manager, salesperson, other.
interest_status: empty/unknown, interested, considering, not_interested.
kind: visit, call, email, message, other.

Workflow for the next GPT connection:
1. GET /?q=restaurant-name to find candidates, or GET /:id for a known ID.
2. Identify the restaurant by name + street address + city. Do not guess a branch.
3. POST / creates a restaurant, or returns the existing one with existing:true (HTTP 200)
   for an exact normalized name/address/city match. It never overwrites existing data.
   Normalization ignores case and repeated whitespace; address abbreviations/fuzzy
   matches require confirmation. Different known addresses represent different branches.
4. HTTP 409 with candidates means the identity is ambiguous (including a missing
   address). Ask for address or select a confirmed ID. Do not automatically create another.
   A previously unseen name alone is sufficient to create a minimal record.
5. POST /:id/interactions adds history, using a stable unique request_id for retries.
   Example:
   {
     "request_id": "stable-unique-visit-uuid",
     "kind": "visit",
     "occurred_on": "2026-09-30",
     "summary": "Runāju ar vadītāju. Jāpiezvana īpašniekam.",
     "contact_role": "manager",
     "interest_status": "considering",
     "next_action": "Piezvanīt īpašniekam",
     "next_action_date": "2026-10-01"
   }
   Only request_id is required; kind defaults to visit. Other unknown fields are omitted.
   Retrying the same payload returns HTTP 200 and adds no second event. Reusing the ID
   with a different payload or restaurant returns 409. Creation returns 201.
6. Resolve words such as "tomorrow" against the user's local date/timezone, then send
   YYYY-MM-DD. Do not invent an event date when unknown. created_at is server time;
   occurred_on is the actual event date. These are deliberately separate.
7. The event and current restaurant snapshot are saved atomically. Dated events newer
   than or equal to last_contact_date update explicitly supplied snapshot fields.
   Backdated events and undated events when a dated snapshot exists only add history.
   Unknown omitted fields do not erase prior known values.
8. PATCH /:id updates explicit restaurant fields; date null clears a date. Identity
   changes are checked for collisions. Use this for corrections without inventing visits.
9. POST /:id/notes remains available for unstructured timestamped notes.

Identity-changing writes and interaction writes serialize in a database transaction,
so simultaneous matching create requests cannot create duplicates through these routes.
No automatic merging or cleanup of pre-existing ambiguous records occurs.
The future connector must keep the API key private. This change does not connect GPT.
