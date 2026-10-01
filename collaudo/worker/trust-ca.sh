#!/bin/sh
# Makes the browsers the worker launches trust the collaudo certificate authority, then starts the
# worker. Node already trusts it through NODE_EXTRA_CA_CERTS; Chromium on Linux reads only its
# NSS database, so without this a test that goes to https://keycloak.collaudo.test (WEB-48) stops on
# ERR_CERT_AUTHORITY_INVALID. Firefox starts each run from a fresh profile and is not covered.
set -e
CA=/collaudo-ca/root.crt
DB="sql:${HOME:-/root}/.pki/nssdb"

if ! command -v certutil >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq --no-install-recommends libnss3-tools >/dev/null
fi
mkdir -p "${HOME:-/root}/.pki/nssdb"
[ -f "${HOME:-/root}/.pki/nssdb/cert9.db" ] || certutil -d "$DB" -N --empty-password
certutil -d "$DB" -D -n collaudo >/dev/null 2>&1 || true
certutil -d "$DB" -A -t "C,," -n collaudo -i "$CA"
echo "Collaudo CA trusted by the worker's Chromium"

exec "$@"
