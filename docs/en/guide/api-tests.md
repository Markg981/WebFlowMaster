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

The other types in the list are shown as *not available*. The authorization-code grant needs a
person at a browser, so it cannot be used by a scheduled run. Every field of every type accepts
environment placeholders — keep the passwords and client secrets there rather than in the test.

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

## Saving

**Save Test** asks for a name and, optionally, a project; **Save Changes** updates the test you
opened from **Saved Tests**. A saved API test can be added to test plans, and used as a
[precondition](./web-tests#preconditions) of a web test.
