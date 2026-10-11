# Administration acceptance / Collaudo amministrazione

Scope: advanced SAML, organization SMTP/provider settings and editable HTML email with delivery/bounce tracking. Billing and consumption plans
are deferred by the user's decision on 2026-10-02. No billing provider, prices or billable unit
have been selected. Existing organization execution quotas continue to apply.

Run automated regressions from the repository root:

```sh
npm test -- server/sso-saml.test.ts server/sso.test.ts server/websocket.test.ts server/email-delivery.test.ts server/mail-messages.test.ts server/routes/mail-delivery.routes.test.ts server/mail-settings.test.ts server/routes/mail-settings.routes.test.ts server/mail-providers.test.ts server/routes/mail-provider.routes.test.ts server/mail-templates.test.ts server/routes/mail-templates.routes.test.ts server/middleware/csrf.test.ts server/middleware/saml-session.test.ts server/member-removal.test.ts server/organization-lifecycle.test.ts
npm test --prefix client -- --run src/components/settings/SsoCard.test.tsx src/components/settings/EmailDeliveryCard.test.tsx src/components/settings/EmailProviderCard.test.tsx src/components/settings/EmailTemplatesCard.test.tsx
```

Apply migrations through 0077 (including 0073 and 0074) in a disposable test installation before exercising the UI. Use
separate organizations and owner/editor accounts. Never use production identity certificates or mail recipients.

| Case | Action | Expected result |
|---|---|---|
| SAML-ADM-01 | POST a signed unsolicited assertion with IdP sign-in disabled, then explicitly enable it and send a fresh assertion. | Disabled: refused. Enabled: correct organization account signs in; domains and group rules still apply. |
| SAML-ADM-02 | Replay an accepted assertion, including two concurrent POSTs. Change Destination, Recipient, audience, issuer or expiry in separate signed fixtures. | At most one login; invalid destination, identity constraints or time window refused. |
| SAML-ADM-03 | Save an RSA certificate and matching private key; reload settings and export metadata. | Key is not returned or rehydrated; public certificate is advertised; blank key retains stored key. Invalid/mismatching key is rejected. |
| SAML-ADM-04 | Send a signed encrypted assertion. Enable required encryption and try unencrypted or incorrectly encrypted assertions. | Valid encrypted login succeeds. Required encryption refuses plaintext; wrong key and unsigned assertions fail. |
| SAML-ADM-05 | Sign in through SAML and use Logout with a configured provider logout URL. | Local session ends; browser follows signed LogoutRequest. Only a signed, correlated provider response is accepted. |
| SAML-ADM-06 | Submit signed provider LogoutRequest by Redirect and POST without a cookie; retry the same request, then submit unsigned/mismatching identity/session requests. | Matching sessions end. Replay and unsigned messages refused. Unrelated sessions remain active. |
| SAML-ADM-07 | Open a log WebSocket as a SAML user, revoke its registry row without deleting the backing session, and try a new upgrade and another log broadcast. | New upgrade refused; the existing socket closes and receives no more logs. |
| MAIL-ADM-01 | Send invitation, password reset and completed-run notification to a test relay. | HTML and text alternatives carry equivalent information; names with HTML markup render as text. History contains no body or link token. |
| MAIL-ADM-02 | Have the relay accept or reject the recipient. | Acceptance is labelled SMTP acceptance, not delivered. Rejection does not return sent=true. |
| MAIL-ADM-03 | Post a signed delivery event within five minutes. Replay it; change its signature/timestamp/message id in separate requests. | Valid event recorded once. Invalid/expired credentials refused. No arbitrary recipient lookup. |
| MAIL-ADM-04 | Record a hard bounce, then attempt another send to the same organization/address. Send a late delivery event and try the address in another organization. | Same organization suppressed; late event cannot undo bounce. Other organization unaffected. |
| MAIL-ADM-05 | View delivery history as owner, editor, unauthenticated visitor and another organization's owner. | Only owners see their own organization's history; no anonymous password-reset enumeration. |
| ADM-ERASE-01 | Remove a member and erase a disposable organization. | Personal SAML session registry is removed with its member; delivery/event history is removed with its organization. |

Mail provider integration requires an adapter to the signed event contract documented in Administration.
The SMTP relay itself does not report delivery or bounces. These cases describe acceptance criteria;
live provider interoperability must be exercised separately from mocked transports and signed XML fixtures.

## Configurable tenant quotas (migration 0081)

QUO-01–QUO-14 are also included in the local Collaudo catalog (protocol 25).
Select **Catalogo attuale** to consult them, then create a new cycle to record manual results.

Use disposable organizations A/B and a human installation administrator. Keep web and worker
defaults identical. These are repeatable acceptance procedures, not claims of live completion.

| Case | Procedure | Expected result |
| --- | --- | --- |
| QUO-01 Free local | Set installation mode `off`; set finite tenant caps, then create tests/run work beyond them. | No quota refusal, no payment prerequisite; independent worker safety limits still apply. |
| QUO-02 Modes | Set tenant mode `monitor`, exceed a cap; switch to `enforce`. | Monitor reports usage without blocking; enforce refuses new growth, preserves content and active runs. |
| QUO-03 Mixed tests | Cap A at three; save UI/BDD, API and mobile definitions, then create/clone/import another. | Total three; fourth returns 429; bulk import rolls back; edit works; deletion releases capacity. |
| QUO-04 Hidden projects | Restrict an A project from an editor; fill A's cap with its tests; create from the editor's visible project. | Full organization total applies; hidden test details stay inaccessible. |
| QUO-05 Inventory | Put legacy files in A's local/S3 prefixes; attempt finite enforcing cap before inventory, then reconcile. | Initially unmeasured; save returns 409; successful inventory counts files, then finite cap can be saved. |
| QUO-06 Artifact growth | Replace a baseline with a larger one at capacity; test new evidence and inline mobile screenshot beyond cap. | Only growth consumes capacity; rejected replacement preserves previous evidence; verdict remains independent. |
| QUO-07 Recovery | Inject storage timeout after persistence and an unsuccessful inventory. Restore connection and reconcile. | Reservation remains conservative; failed scan retains last inventory; successful scan resolves actual bytes. |
| QUO-08 Retention | Delete/expire A evidence, including a simulated S3 partial-delete failure. | Bytes release after confirmed physical removal; failed deletion retains ledger conservatively. |
| QUO-09 Minutes | Exhaust A's monthly minutes; submit plan/direct browser/API/mobile operations. | New admissions return 429; already queued work waits; running work finishes; deleting reports does not erase usage. |
| QUO-10 Month boundary | Run across UTC month boundary; inspect each month's interval; include a shard. | Interval split across months; queued time excluded; additional worker occupancy included. |
| QUO-11 Administration | Edit A, clear override, select off/monitor; submit stale revision; inspect audit. | Inheritance/default visible; stale save 409; actor/old/new/revision recorded in A's audit. |
| QUO-12 Isolation | As A's ordinary owner/service account call installation quota APIs; attempt B changes. | 403; only authenticated human installation admin enumerates/changes tenant quotas. |
| QUO-13 Active staging | Reconcile while a plan is generating files; finish publication or force quota rejection. | Untracked active/incomplete staging is not retained evidence or downloadable; committed evidence remains measured. |
| QUO-14 Debug rejection | Exhaust execution budget and start a debug session. | 429; initialized debug state ends and no phantom active session remains. |

Automated coverage includes database triggers, aggregate/RLS boundaries, API revisions/audit,
ambiguous storage reservations, occupancy month boundaries and UI inheritance/conflicts.
Real bucket interoperability, authenticated UI acceptance and production migration remain separate checks.
