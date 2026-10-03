# Shared SaaS network isolation

## Approved intent

The operator supplies an exact-domain/port allowlist. Empty policy denies all test destinations.
The user approved the Docker design and completion through a PR without further intermediate
approvals. Supply an enforceable deployment, not instructions to configure a firewall elsewhere.

## Boundaries

- A separate hardened Compose deployment, never an overlay that inherits the ordinary external
  network. PostgreSQL/Redis have no host ports. The sole application ingress binds to loopback
  for an operator's TLS reverse proxy. All production secrets are mandatory inputs.
- API and worker use separate guarded network namespaces with default-deny output (IPv4/IPv6).
  Only DNS, their necessary internal control-plane ports and the egress proxy are allowed.
  Docker internal networks alone are insufficient because host gateways can still be reachable.
- Only the namespace guards hold NET_ADMIN. API/worker drop capabilities and cannot modify
  routes/rules; they share the guard's namespace, not its filesystem or PID namespace.
- The egress proxy checks requested domains and ports, refuses IP-literal targets and resolved
  private/loopback/link-local/metadata/reserved destinations, and denies everything else.
  CONNECT checks tunnel destinations; it does not decrypt or authorize every encrypted payload
  inside an otherwise allowed tunnel. This is an installation-wide policy, not tenant-specific.
- HTTP target requests (including OAuth/NTLM), browsers and native WebSocket/gRPC tests honor
  `WFM_EGRESS_PROXY`. Unconfigured transports cannot fall back to direct external access.
  Internal trusted control-plane traffic remains available. Agents operate in the customer's
  network under its own policy; the SaaS does not gain direct routes into that network.
- Normal single-tenant/development and local-agent behavior stays unchanged without the flag.

## Acceptance

Prove allowed HTTP/browser/native traffic through the proxy, denied destinations and ports,
redirects to denied destinations, private DNS answers, literal metadata/loopback/IPv6 and direct
connections bypassing the proxy. Prove host-gateway denial and mandatory-secret/config validation.
Use an isolated test deployment; preserve the existing Collaudo's data and running services.
Add the relevant gate to CI and maintain EN/IT hardening/installation documentation.

## Implementation interfaces

- `WFM_EGRESS_PROXY=http://egress:3128` on both application processes.
- Pure proxy configuration helper, proxy-aware target dispatchers, native agents and browser
  launch options; invalid configuration fails closed.
- Deployment files under `deployment/saas-network/`; policy entries are exact DNS hostnames and
  explicit TCP ports. No client-editable policy, wildcards or automatic private-network exemption.
