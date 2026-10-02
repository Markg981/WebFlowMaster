# API tests

An API test is one HTTP request with the checks its answer must pass. Several of them in a plan
make a flow: sign in, create an order, read it back, delete it — each passing values to the next.
You build them in **API Tester**.

## The request

- **Method** and **Base URL**; **Query Params** are added below and shown in the **Effective URL**.
  The address may start with a variable — <code v-pre>{{baseUrl}}/orders</code> — so one test
  follows each environment's server.
- **Environment**: which environment's secrets fill the <code v-pre>{{placeholders}}</code> in
  the address, the headers, the body and the authorization, as for
  [web tests](./web-tests#variables-and-environments).
- **Headers**: name and value pairs.
- **Body**: none, form data (text fields and files), URL-encoded form, raw (JSON, XML, text,
  HTML, JavaScript, with the matching `Content-Type`), a binary file, or a GraphQL query with its
  variables.
- **Authorization**:

| Type | What is sent |
|---|---|
| No Auth | Nothing. |
| Basic Auth | A username and password as a Basic header. |
| Bearer Token | `Authorization: Bearer` and the token. |
| API Key | A key in a header or a query parameter, under the name you choose. |
| OAuth 2.0 | A token fetched first from the token URL, with the **client credentials** or **password** grant, then sent as a Bearer token. The client credentials go in a Basic header or in the body. |
| JWT Bearer | A JWT signed for every request: **HS256/384/512** with a shared secret (optionally Base64), **RS\*** or **ES\*** with a PEM private key. The claims and extra header fields are JSON; `iat` is added when absent. Sent as `Authorization: <prefix> <token>` (prefix *Bearer* by default) or as a query parameter. |
| Digest Auth | The request goes out, the server answers 401 with its terms, and the request is sent again with the answer (RFC 7616: MD5, SHA-256, their `-sess` variants, qop `auth` and `auth-int`). |
| OAuth 1.0 | Each request signed (RFC 5849) with **HMAC-SHA1/256/512** or **PLAINTEXT**, over the method, the URL, the query and a form body. Leave the token empty for two-legged OAuth. In the Authorization header or in the query. |
| Hawk Authentication | A MAC over method, path, host and port, with timestamp and nonce; optionally the body hash, for servers that verify payloads. |
| AWS Signature | Signature Version 4: `Authorization` and `x-amz-date`, plus `x-amz-security-token` with temporary credentials and `x-amz-content-sha256` for S3. Leave the service empty to read it from an `*.amazonaws.com` host. |
| NTLM Authentication | The NTLMv2 handshake (negotiate, challenge, authenticate) on one connection, which NTLM requires — from the server or from the agent when the plan runs on an agent pool. `DOMAIN\user` in the username works too. |
| Akamai EdgeGrid | `EG1-HMAC-SHA256` with the client token, client secret and access token of your `.edgerc` section; the headers you list and the body of POST requests (up to the maximum) are signed. |
| Atlassian ASAP | A short-lived JWT (**RS\*** or **ES\***) with issuer, audience, key ID and a fresh `jti`, sent as a Bearer token. |

A header named `Authorization` written on the Headers tab wins over the type chosen here. If a
required field is empty — a username, a key — the request is not sent, and the result says which
field is missing, rather than letting the server answer 401. The authorization-code grant needs a
person at a browser, so it cannot be used by a scheduled run. Every field of every type accepts
environment placeholders — keep the passwords, secrets and private keys there rather than in the
test.

**Send** runs the request from the server and shows the **Response**: status, time, body and
headers, and the result of each assertion. Every request sent is kept in **History**, from which
you can open it again.

## Assertions

Each assertion reads one part of the answer and compares it:

| Source | Property | Example |
|---|---|---|
| status code | — | equals `201` |
| header | the header's name | `Content-Type` contains `json` |
| body json path | a path in the JSON body | `items[0].id` exists |
| body text | — | contains `"status":"ok"` |
| response time | — | less than `500` (milliseconds) |
| body xpath | an XPath in an XML body | `//status` equals `Shipped` — see [SOAP](#protocols) |

Comparisons: equals, not equals, contains, not contains, exists, not exists, is empty, is not
empty, greater than, less than (or equal), matches regex, not matches regex. An assertion can be
switched off without being deleted. The test passes when every enabled assertion does.

## Captures: passing values on {#captures}

A **capture** takes a value out of the answer — a token, the id of what was created — and names it.
The API tests that come after it in the same run of a plan can use it as
<code v-pre>{{name}}</code>, in the address, the headers or the body.

A capture reads the same places as an assertion: the status code, a header, a JSON path, or the
body text. Names are letters, digits and underscores, starting with a letter. **Send** shows the
value each capture took, or why it could not take one.

Captured values travel within one browser's pass through the plan, in the order the tests run.
A plan that relies on them should keep those tests in the right order; with several tests running
at once, the plan keeps the API tests of each browser in order.

## Response times over several requests {#performance}

The **response time** assertion judges one request, and one request's time is noise: a cold cache
or a garbage collection decides it. The **Performance** tab checks an endpoint the way a person
would trust: switch on **Check response times over several requests** and set

- **Requests** — how many, 2 to 200, the functional request included;
- **At once** — how many are in flight together, 1 to 10;
- the thresholds the test fails on, each optional: **Median (p50)**, **95th percentile (p95)** and
  **Slowest**, in milliseconds, and **Failed requests**, in percent.

In a plan the request is sent once as usual — its assertions decide the result and its captures
go on to the next tests — and then again until the count is reached. A repetition counts as
failed when it could not be made or failed one of the test's assertions. Percentiles are nearest
rank: p95 of 20 requests is the 19th fastest. When a threshold is exceeded the test fails with
what was exceeded ("p95 412 ms > 300 ms"), and the run report's **Response times** card lists
every test that checked its times: requests, p50, p95, slowest, failed requests and verdict.

The repetitions leave from where the test runs — a local agent's network when the plan uses one —
and stop when the run is cancelled. A request that cannot be made at all skips the check: there is
nothing to time. The caps are deliberate: this answers "did this endpoint get slower?" on every
run, it is not a load test.

## SOAP, WebSocket and gRPC {#protocols}

**SOAP** is HTTP: a `POST` with the XML envelope as a raw body (`text/xml`, or
`application/soap+xml` for SOAP 1.2) and, for SOAP 1.1, a `SOAPAction` header. Read the answer with
**body xpath** assertions and captures: `//status` equals `Shipped`, `//Fault` not exists,
`count(//item)` greater than `2`, `//order/@id` captured as `orderId`. An expression without a
prefix ignores the namespaces, so `//status` finds `<ns2:status>`; one with a prefix uses the
document's own (`//ns2:status`). A service's WSDL can be [imported](#import).

**WebSocket**: choose the method **WEBSOCKET** and a `ws://` or `wss://` address. The raw body holds
the messages to send, one per line, or a plan —
<code v-pre>{"send": ["subscribe", {"op": "ping"}], "waitMs": 3000, "until": 2}</code> — that also
says how long to listen (2 seconds by default, at most 60) and after how many messages to stop.
Headers and header-based authorizations go on the handshake. The answer is a JSON body
`{ messages, last, count }`: assert `count` equals `2`, `last.type` equals `pong`, or
`messages[0].id` exists; JSON messages are parsed, others kept as text.

**gRPC**: choose the method **GRPC**, an address `grpc://host:port/package.Service/Method`
(`grpcs://` for TLS), and paste the service's `.proto` in the field that appears. The raw body is
the request message as JSON, headers are sent as metadata, and the answer's body is the response
message as JSON. The status is the gRPC status code — `0` for OK, `5` for NOT_FOUND… — so an
expected error is asserted with **status code** like any other. Unary calls only.

WebSocket and gRPC tests are sent from the server's runners: a plan on local agents runs them from
there, not from the agents' network.

## Importing from OpenAPI, Postman or WSDL {#import}

**Saved Tests → Import** makes tests from what a team already has: an **OpenAPI 3** or
**Swagger 2** description, in JSON or YAML, a **Postman collection** (v2.0 or v2.1), or a SOAP
service's **WSDL** (1.1). Open the
file or paste it, press **Show what it makes**, keep the tests you want — those whose method and
address already exist here are left unticked — choose a project and import.

- One test per operation (OpenAPI) or request (Postman), named after its summary, operation id or
  Postman name, grouped by its tag or folder as the module.
- The address starts with <code v-pre>{{baseUrl}}</code>; path parameters become
  <code v-pre>{{name}}</code> (Postman's `:name` too). Postman's own <code v-pre>{{variables}}</code>
  are the same syntax and stay as they are.
- Required query and header parameters get their example, default or first allowed value, or a
  variable. The body is the operation's example, or one made from its schema (JSON and URL-encoded
  forms); Postman's raw, URL-encoded and GraphQL bodies are kept.
- Security becomes the test's authorization — bearer, basic or API key — with the secret as a
  variable (<code v-pre>{{token}}</code>, <code v-pre>{{password}}</code>…). A secret written into a
  Postman collection is not imported.
- The expected status is an assertion: OpenAPI's first 2xx response, or Postman's
  `pm.response.to.have.status(…)`.
- From a WSDL: one `POST` per operation of the SOAP binding (1.1 when there is one, else 1.2), with
  the envelope, the `SOAPAction`, and the request element written out from the schema, its fields
  as `?` to fill in. Each test expects `200` and no `//Fault`.

The preview lists the variables the tests need, with the server address as a suggestion for
<code v-pre>{{baseUrl}}</code>: set them in an [environment](./web-tests#variables-and-environments)
before running. What could not be carried over is said for each test: multipart bodies, Postman
scripts beyond the status check, pre-request scripts, OAuth flows (the test then sends
<code v-pre>{{token}}</code>). At most 500 tests per import, 12 MB per file; the audit log records
each import.

## Saving

**Save Test** asks for a name and, optionally, a project; **Save Changes** updates the test you
opened from **Saved Tests**. A saved API test can be added to test plans, and used as a
[precondition](./web-tests#preconditions) of a web test.
