# API tests

An API test is one HTTP request with the checks its answer must pass. Several of them in a plan
make a flow: sign in, create an order, read it back, delete it — each passing values to the next.
You build them in **API Tester**.

## The request

- **Method** and **Base URL**; **Query Params** are added below and shown in the **Effective URL**.
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

## Saving

**Save Test** asks for a name and, optionally, a project; **Save Changes** updates the test you
opened from **Saved Tests**. A saved API test can be added to test plans, and used as a
[precondition](./web-tests#preconditions) of a web test.
