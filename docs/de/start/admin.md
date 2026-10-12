# Ihre erste Organisation mit Single Sign-on

Für den Administrator, der eine Organisation einrichtet. Am Ende melden sich Ihre Kollegen mit
ihrem Firmenkonto an, erhalten eine Rolle aus ihren Gruppen und verlieren den Zugang, wenn sie das
Unternehmen verlassen. Sie brauchen die Rolle **Eigentümer** und einen Administrator Ihres
Identitätsanbieters (Microsoft Entra ID, Okta, Google Workspace, Keycloak, ADFS…) in Reichweite.
Ist WebFlowMaster noch nicht installiert, beginnen Sie mit der
[Installation](/en/admin/installation) (auf Englisch): Das erste dort registrierte Konto wird
Eigentümer der ersten Organisation.

## 1. Die Organisation benennen und das eigene Konto absichern (5 Minuten)

1. **Einstellungen → Konto**: Ändern Sie das Anfangspasswort, wenn es Ihnen jemand anderes gegeben
   hat.
2. **Einstellungen → Sicherheit**: Richten Sie einen zweiten Faktor mit einer Authenticator-App ein
   und bewahren Sie die Wiederherstellungscodes sicher auf. Eigentümer behalten die Anmeldung per
   Passwort, auch wenn Single Sign-on verpflichtend ist; dieses Konto kommt also hinein, wenn der
   Anbieter ausfällt.
3. Laden Sie einen zweiten Eigentümer ein (**Einstellungen → Mitglieder**), damit die Organisation
   nie von einer einzigen Person abhängt.

## 2. Den Identitätsanbieter verbinden (20 Minuten)

OpenID Connect ist der kürzere Weg, wo der Anbieter es unterstützt; SAML 2.0 funktioniert auf der
Seite von WebFlowMaster genauso
([Single sign-on](/en/admin/administration#single-sign-on), auf Englisch).

1. **Einstellungen → Sicherheit → Single Sign-on**, Protokoll **OpenID Connect**. Kopieren Sie die
   **Redirect-URI**.
2. Registrieren Sie beim Anbieter eine Webanwendung mit dieser Redirect-URI, den Scopes
   `openid email profile` und einem Client-Secret.
3. Zurück in WebFlowMaster geben Sie **Issuer**, **Client-ID**, **Client-Secret**, Ihre
   **E-Mail-Domains** und die **Rolle neuer Konten** ein (Betrachter ist die sichere
   Voreinstellung).
4. **Speichern**, dann **Anbieter testen**.
5. Melden Sie sich ab und mit **Mit SSO anmelden** über ein Testkonto Ihres Unternehmens wieder an.

## 3. Ihre Domänen nachweisen (5 Minuten)

Jede Domäne zeigt einen DNS-TXT-Eintrag, `_wfm-verification.<domäne>`. Veröffentlichen Sie ihn und
klicken Sie dann auf **Prüfen**. Auf einer geteilten Installation leitet eine nicht nachgewiesene
Domäne keine Anmeldung weiter, und der Nachweis verhindert, dass eine andere Organisation sie
beansprucht.

## 4. Rollen aus Gruppen (10 Minuten)

Ordnen Sie unter **Rollen aus den Gruppen des Anbieters** die Gruppen des Anbieters Rollen zu: zum
Beispiel `wfm-viewers` Betrachter, `wfm-testers` Bearbeiter, `wfm-admins` Eigentümer. Bitten Sie
den Administrator des Anbieters, die Gruppen im Token mitzusenden (bei Entra ID ordnen Sie die
Objekt-IDs der Gruppen zu, nicht ihre Namen). Schalten Sie **Abweisen, wer in keiner dieser Gruppen
ist** ein, um die Gruppen zur Eingangstür zu machen: Wer beim Anbieter aus den Gruppen entfernt
wird, verliert den Zugang hier bei der nächsten Anmeldung.

## 5. Verpflichtend machen (2 Minuten)

Wenn ein Testkonto von Anfang bis Ende funktioniert, schalten Sie **Verpflichtend machen** ein.
Mitglieder außer den Eigentümern können sich nicht mehr mit Passwort anmelden, und ihre offenen
Passwort-Sitzungen enden. API-Schlüssel funktionieren weiter; Pipelines sind also nicht betroffen.

## 6. Das Audit-Protokoll prüfen (3 Minuten)

**Einstellungen → Audit-Protokoll** zeigt die Änderung der Einstellungen, jedes bei der ersten
Anmeldung angelegte Konto und jede Anmeldung mit `method: sso`
([Audit log](/en/admin/administration#audit-log), auf Englisch).

## Wie es weitergeht

- Konten beim Anbieter anlegen und entfernen, sobald sie sich ändern: SCIM-Provisionierung, in
  derselben Karte.
- Einige Projekte einigen Personen vorbehalten:
  [Restricted projects](/en/admin/administration#restricted-projects) (auf Englisch).
- Pipelines: Dienstkonten und Schlüssel mit begrenztem Umfang
  ([Ihr erster Lauf aus einer Pipeline](./devops)).
- Verbrauch und Grenzen: [Quotas](/en/admin/administration#quotas) (auf Englisch).
