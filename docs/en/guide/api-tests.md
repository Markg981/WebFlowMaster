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

**SOAP** uses HTTP POST with a raw XML envelope: `text/xml` and `SOAPAction` for SOAP 1.1, or `application/soap+xml` for SOAP 1.2. XPath assertions and captures work with namespaces (`//status` ignores prefixes; `//ns:status` uses the document's prefix). [Import](#import) creates editable requests from WSDL.

**gRPC** supports unary, server streaming, client streaming and bidirectional streaming. Choose **GRPC**, provide `grpc://host:port/package.Service/Method` (`grpcs://` for verified TLS), and paste the service's **.proto**. Headers are metadata. **gRPC mode** defaults to the method definition; an explicit mode must agree with it. Unary/server-stream calls take one JSON request. Client/bidirectional streams accept:

```json
{"messages":[{"value":"first"},{"value":"second"}]}
```

Bidirectional streams can instead use the ordered conversation below. Unary and client-stream responses remain single JSON messages. Response streams return `{messages,last,count,captures}`; assert `count`, `last.value` or `messages[0].value`. Terminal status and trailers are available to assertions (status 0 means OK). Remote error codes remain assertable; a local deadline, cancellation, malformed conversation or exceeded resource limit fails execution, even without assertions.

**WebSocket** accepts `ws://` or `wss://`. Existing line-separated raw messages and `{"send":["ping"],"waitMs":2000,"until":1}` remain supported. To alternate replies, captures and dependent sends, select raw body and use **Conversation** (ordered editor or JSON):

```json
{"steps":[
  {"type":"receive"},
  {"type":"capture","name":"token","property":"token"},
  {"type":"send","message":"{{capture.token}}"},
  {"type":"receive","timeoutMs":2000,"property":"accepted","equals":true},
  {"type":"end"}
]}
```

Receives consume queued replies, including an immediate server challenge. An optional property such as `items[0].id` and `equals` select the expected reply. Capture reads the most recently received message; its name must begin with a letter and contain letters, digits or underscores. Use <code v-pre>{{capture.token}}</code> only after capturing it; these names are reserved within the conversation. Missing captures and early close fail with the step number. **End** closes WebSocket or half-closes the gRPC request stream. Client-streaming gRPC conversations cannot receive before their single final response.

**Protocol configuration** sets the overall timeout, received-message count and received UTF-8 bytes. Defaults are **30 seconds / 100 messages / 1 MiB**; maximums are **60 seconds / 1,000 messages / 8 MiB**. Captures have a separate aggregate byte budget using the same maximum; all conversation sends together are bounded to 8 MiB after substitution. Conversations allow **100 steps**. The response transcript shows messages and conversation captures. Saved tests, executable versions, approved publishing and YAML/JSON bundles retain the configuration. Plan reports persist a redacted transcript while retaining live extractions for later requests.

### Verified TLS and client certificates

In the selected organization's environment, create encrypted secret values containing the PEM root CA, client certificate and private key. Enter their exact references in **Protocol configuration**, for example:

```json
{"tls":{"rootCa":"{{secret_grpc_ca}}","clientCertificate":"{{secret_grpc_cert}}","clientKey":"{{secret_grpc_key}}","keyPassphrase":"{{secret_grpc_passphrase}}"}}
```

Use the actual secret variable names. CA is optional when system trust is sufficient; client certificate and key must be supplied together, and passphrase is only for an encrypted key. Each resolved PEM field is bounded to 256 KiB. Plaintext certificates/keys in saved configuration are rejected. The resolved address must use `grpcs://`, including when supplied through an environment variable. Certificate/key matching, trust and destination hostname are verified; there is no insecure fallback. Rotate credentials by changing environment secret values, then rerun the test; versions keep references, not PEM material. Only necessary resolved TLS fields travel on the authenticated agent relay; tickets contain capability names. Environment values and PEM material are redacted from transport errors and request history.

Plans using local agents execute all these protocols from the agent's network. Upgrade to **agent 1.2.0** by downloading the new script/dependencies or rebuilding/restarting the Docker agent ([Local agents](../LOCAL_AGENT)). Older native agents can still run legacy unary/WebSocket calls, but advanced tickets require `native-protocol-v2`; an unsupported pool fails explicitly. The editor's **Send** preview executes from the server. Existing mandatory proxy and destination restrictions still apply.

## Importing from OpenAPI, Postman or WSDL {#import}

**Saved Tests → Import** makes tests from what a team already has: an **OpenAPI 3** or
**Swagger 2** description, in JSON or YAML, a **Postman collection** (v2.0 or v2.1), or a SOAP
service's **WSDL** (1.1/2.0). Open the
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
- From a WSDL: one `POST` per operation of the selected SOAP binding, with an envelope and schema fields written as `?` to fill in. SOAP 1.1 uses `SOAPAction`; SOAP 1.2 uses the content-type action. Request-response expects `200` and no `//Fault`; one-way expects a 2xx status.

The preview lists the variables the tests need, with the server address as a suggestion for
<code v-pre>{{baseUrl}}</code>: set them in an [environment](./web-tests#variables-and-environments)
before running. What could not be carried over is said for each test: multipart bodies, Postman
scripts beyond the status check, pre-request scripts, OAuth flows (the test then sends
<code v-pre>{{token}}</code>). At most 500 tests per import, 12 MB per file; the audit log records
each import.

### Offline WSDL/XSD bundles

Open multiple files or a directory, choose the root WSDL and edit logical locations so that imports resolve relative to the importing document (for example `service.wsdl`, `types/request.xsd`, `types/base.xsd`). Directory paths are retained. Select the SOAP endpoint in the preview; changing files, locations or endpoint invalidates the previous preview.

WSDL 1.1 imports, WSDL 2.0 imports/includes and SOAP HTTP request-response/one-way operations are supported, including XSD import/include, qualified names, element references and complex-type extensions. Limits are 32 documents, 10 MiB total and import depth 10. Dependencies are resolved only from uploaded documents: there are no network or filesystem reads; DTD/entities, missing/ambiguous dependencies and unsafe paths are rejected. RPC/encoded bindings, unsupported groups/complex restrictions and recursive skeletons fail explicitly. Policies, policy references, SOAP modules, headers, choices and attributes needing manual work produce preview warnings. Review generated envelopes before running.

## Saving

**Save Test** asks for a name and, optionally, a project; **Save Changes** updates the test you
opened from **Saved Tests**. A saved API test can be added to test plans, and used as a
[precondition](./web-tests#preconditions) of a web test.

## Versions and publication

Saved tests have [history, comparison and restore](./organizing#history-and-versions).
[Publication and reviews](./organizing#publishing-and-reviews) choose the revision plans execute;
saving or restoring a working copy leaves an existing publication in place. **Test** runs the saved API working copy.
