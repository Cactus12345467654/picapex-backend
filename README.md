# Picapex backend

Production uses the existing DATABASE_URL (PostgreSQL) and API_KEY environment variables.
No keys or local test configuration are included in this repository.
Startup applies the additive, idempotent warming.sql migration before listening.
It creates only warming_restaurants, warming_notes and warming_interactions.
Existing contacts are not changed or imported.
See VISITS-API.md for authenticated routes, validation and duplicate handling.
The GPT connection is not enabled.
