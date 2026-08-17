\set ON_ERROR_STOP on

-- Run from an administrative database, for example:
-- psql -U postgres -d postgres -f scripts/createVoiceautoProdDb.sql
--
-- This clones the existing voiceauto database into voiceautoprod so the
-- production deployment can point DATABASE_URL at voiceautoprod.
-- If voiceautoprod already exists, CREATE DATABASE will fail intentionally.

SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'voiceauto'
  AND pid <> pg_backend_pid();

CREATE DATABASE voiceautoprod
WITH TEMPLATE voiceauto
OWNER voiceauto_app;
