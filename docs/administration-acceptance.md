# Administration acceptance / Collaudo amministrazione

Scope: advanced SAML and HTML email with delivery/bounce tracking. Billing and consumption plans
are deferred by the user's decision on 2026-10-02. No billing provider, prices or billable unit
have been selected. Existing organization execution quotas continue to apply.

Run automated regressions from the repository root:

```sh
npm test -- server/sso-saml.test.ts server/sso.test.ts server/websocket.test.ts server/email-delivery.test.ts server/mail-messages.test.ts server/routes/mail-delivery.routes.test.ts server/middleware/csrf.test.ts server/middleware/saml-session.test.ts server/member-removal.test.ts server/organization-lifecycle.test.ts
npm test --workspace=client -- --run src/components/settings/SsoCard.test.tsx src/components/settings/EmailDeliveryCard.test.tsx
```

Apply migrations 0073 and 0074 in a disposable test installation before exercising the UI. Use
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
