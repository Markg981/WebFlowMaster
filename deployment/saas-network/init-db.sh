#!/bin/sh
set -eu
# The runtime is deliberately not a superuser. BYPASSRLS is required by the
# trusted background path; tenant requests SET LOCAL ROLE app_user.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=runtime_password="$WFM_DATABASE_PASSWORD" <<'SQL'
CREATE ROLE wfm_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD :'runtime_password';
GRANT CONNECT ON DATABASE webflowmaster TO wfm_runtime;
SQL
