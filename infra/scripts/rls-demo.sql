-- Demonstrates that tenant isolation actually works, and why the connecting role matters.
--
-- Run it as ONE unit — it will not work pasted line by line:
--     npm run db:psql -- -f infra/scripts/rls-demo.sql
--   or
--     docker exec -i whatsapp-crm-dev-db psql -U dev -d whatsapp_crm_dev -f - < infra/scripts/rls-demo.sql
--
-- Why it has to be one unit: `set_config(..., true)` and `SET LOCAL` are both
-- TRANSACTION-SCOPED. Outside a transaction the setting is gone by the next statement, and
-- `SET LOCAL ROLE` merely warns "can only be used in transaction blocks" and leaves you as
-- whoever you were. You then get the superuser answer and it looks like isolation is broken.
--
-- Everything here rolls back. Nothing is left behind.

\set ORG_A '00000000-0000-4000-8000-00000000000a'
\set ORG_B '00000000-0000-4000-8000-00000000000b'

BEGIN;

-- Become org A and write one contact.
SELECT set_config('app.org_id', :'ORG_A', true);
INSERT INTO org (id, name, slug) VALUES (:'ORG_A', 'Org A', 'rls-demo-a');
INSERT INTO contact (org_id, display_name) VALUES (:'ORG_A', 'belongs to org A');

-- Now look at it as org B — a different tenant entirely.
SELECT set_config('app.org_id', :'ORG_B', true);

\echo ''
\echo '1. As the SUPERUSER, asking as org B. Expect 1 — superusers bypass RLS entirely,'
\echo '   which is exactly what the startup warning is about.'
SELECT current_user AS role, count(*) AS org_a_rows_visible FROM contact;

SET LOCAL ROLE crm_app;

\echo ''
\echo '2. As crm_app, the non-superuser application role, still asking as org B.'
\echo '   Expect 0 — this is isolation working.'
SELECT current_user AS role, count(*) AS org_a_rows_visible FROM contact;

\echo ''
\echo '3. Switch to org A. Expect 1 — the row is visible to the tenant that owns it.'
SELECT set_config('app.org_id', :'ORG_A', true);
SELECT current_user AS role, count(*) AS org_a_rows_visible FROM contact;

\echo ''
\echo '4. Try to write a row belonging to org B while acting as org A. Expect an ERROR:'
\echo '   RLS blocks the write, not just the read.'
SELECT set_config('app.org_id', :'ORG_A', true);
INSERT INTO contact (org_id, display_name) VALUES (:'ORG_B', 'smuggled into org B');

ROLLBACK;
