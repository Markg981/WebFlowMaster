# Network isolation for a shared SaaS

Use the standalone `deployment/saas-network/compose.yml` when several organizations share
the installation. It provides destination restrictions for **both the API and workers**:
interactive previews also execute tests in the API process. The ordinary root Compose file
is intended for environments where the operator supplies network restrictions separately.

## Start the isolated deployment

Requirements: Linux containers, Docker Compose 2.33.1 or newer, working IPv4/IPv6 iptables
in container namespaces, and a TLS reverse proxy on the host. Do not overlay this file on
`docker-compose.yml`; its network layout is standalone.

1. Copy `deployment/saas-network/.env.example` to a private environment file.
2. Generate **each** of the six secrets independently, using
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   The validator requires 64 lowercase hexadecimal characters and rejects shared secrets.
3. Set `WEBFLOW_PUBLIC_URL` to the public HTTPS origin. Put your TLS reverse proxy in front
   of `127.0.0.1:5090` (or `WFM_SAAS_PORT`). PostgreSQL, Redis and the egress proxy have no
   published ports. Keep secure cookies enabled.
4. Set an exact hostname and port allowlist, for example:

   ```dotenv
   WFM_SAAS_ALLOWLIST='[{"host":"app.example.com","ports":[443]},{"host":"rpc.example.com","ports":[50051]}]'
   ```

   An absent or empty list denies every test destination. Wildcards, IP literals and URLs
   are rejected. Every redirect destination, OAuth token endpoint, browser resource and
   WebSocket/gRPC endpoint needs its own matching entry.
5. Start from the repository root:

   ```sh
   docker compose -p wfm-saas --env-file deployment/saas-network/.env -f deployment/saas-network/compose.yml up -d --build --wait
   ```

The deployment creates PostgreSQL and Redis volumes, applies migrations as an administrative
role, and grants runtime access to a separate `wfm_runtime` login. This login has
`BYPASSRLS`, as required by privileged application bootstraps, but is neither a superuser
nor a role/database creator. Tenant queries switch to `app_user`, which cannot bypass RLS.
Register the first account yourself before exposing the TLS endpoint.

## What is enforced

API and worker containers share separate network namespaces with small firewall containers.
Only those firewall containers receive `NET_ADMIN`; applications and the proxy drop all
capabilities and cannot change the rules. Both IPv4 and IPv6 output default to deny.
The API and workers may contact only their required PostgreSQL/Redis ports, the mandatory
proxy, Docker DNS and their local services; the worker also reaches the API relay.

The only external route is Squid through a third guarded namespace. It accepts exact
hostname/port pairs and refuses loopback, private, link-local, metadata and reserved
destinations, including DNS names resolving there. Its packet firewall also denies those
addresses, preventing a changed or mixed DNS answer from opening a private route.
Direct connections, host gateway connections, proxy bypass flags and an empty allowlist
are tested against real Docker networks in CI.

The API guard also joins a dedicated ingress bridge so Docker can publish its loopback
port. Its output firewall still denies new external connections; only replies to incoming
requests are permitted. Docker does not publish ports from an exclusively internal network.

`WFM_EGRESS_PROXY` is fixed by this Compose file. HTTP requests, OAuth/NTLM target requests,
Node `fetch`, native WebSocket and unary gRPC, and local Chromium/Firefox/WebKit launches use
it. Browser localhost bypasses are disabled. Invalid proxy settings fail instead of
silently selecting a direct connection. Normal installations and customer agents retain
their existing behavior when this setting is absent.

## Boundaries and operations

- The allowlist is **installation-wide**, managed by the operator, rather than a per-tenant
  authorization policy. CONNECT restricts the destination hostname and port; it does not
  inspect encrypted payloads or enforce application-level host identity inside the tunnel.
- Required control-plane ports remain reachable by the application namespaces. Their
  authentication and tenant isolation remain essential; this deployment does not provide
  a separate network namespace for each individual test.
- Direct TCP protocols such as database tests and SMTP, external browser grids and SDKs
  that do not support the proxy fail closed. Use a customer
  [local agent](../LOCAL_AGENT) for private applications; restrict that agent's network
  separately. Allowlisting a private name does not grant a private route.
- DNS goes through Docker's embedded resolver. DNS queries themselves are not filtered by
  the HTTP allowlist. This profile is destination isolation, not protection against every
  possible data-exfiltration channel or a replacement for container/host patching.
- Artifact storage defaults to shared local volumes. External integrations need compatible
  proxy transports and explicit public destination rules before enabling them.
- Networks use `172.29.240.0/24` and `172.29.241.0/24`. If these conflict, update **both**
  Compose and `guard.sh`. Keep this deployment on its own host/network allocation.
- After changing allowlist rules, recreate `egress`. After replacing a namespace guard,
  recreate its application containers as well; otherwise they can retain the old namespace.
  Apply upgrades with runners drained and a verified database backup.

To repeat the disposable acceptance check without touching the installation:

```sh
npm run test:network:unit
npm run build:network-probe
# Set WFM_SAAS_TRANSPORT_BUNDLE to the absolute tmp/saas-transports.mjs path,
# and WFM_SAAS_NODE_MODULES to the absolute node_modules path.
npm run test:network
```

The check creates and removes its own Docker project and volumes. With both path variables
set, it additionally exercises the production HTTP, WebSocket and gRPC transports and all
three browser engines from a guarded worker namespace.
`npm run test:network:production` additionally builds and starts the actual API/worker
images with fresh secrets, verifies first-account registration, runtime database privileges
and a live queue worker, then removes its disposable project. Both checks run in CI.
