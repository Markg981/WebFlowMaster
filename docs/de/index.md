# WebFlowMaster-Dokumentation

WebFlowMaster ist eine Plattform für Testautomatisierung von Webanwendungen, HTTP-APIs und nativen
mobilen Apps: Tests aufzeichnen oder beschreiben, in Pläne und Suiten ordnen, in mehreren Browsern
nach Zeitplan oder aus der CI ausführen — auch in Netzwerken, die der Server nicht erreicht — und zu
jedem Lauf einen ausführlichen Bericht erhalten.

**Erster Tag?** [Hier beginnen](./start/) bietet einen kurzen Weg pro Rolle: der erste Test eines
Testers in 10 Minuten, der erste Lauf eines DevOps-Engineers aus einer Pipeline, die erste
Organisation eines Administrators mit Single Sign-on.

## Benutzerhandbuch

Für alle, die Tests schreiben und ausführen:

- [Einstieg](./guide/) — anmelden, zurechtfinden, ein erster Test von Anfang bis Ende.
- [Webtests](./guide/web-tests) · [API-Tests](./guide/api-tests) · [Lasttests](./guide/load-tests) ·
  [BDD / Cucumber](./guide/bdd-tests) · [Gherkin-Dateien](./guide/gherkin-files) ·
  [Mobile Apps](./guide/mobile-apps)
- [Tests organisieren](./guide/organizing) ·
  [Gespräche und Dashboards](./guide/collaboration) · [Tests ausführen](./guide/running) ·
  [Ergebnisse](./guide/results)

## Referenzdokumentation auf Englisch

Der Rest der Dokumentation liegt auf Englisch (und Italienisch) vor. Er richtet sich vor allem an
alle, die die Plattform installieren, verwalten oder weiterentwickeln:

- [WebFlowMaster at a glance](/en/overview) — was das Produkt ist, wie es aufgebaut ist, wo was
  liegt.
- [Install and administer](/en/admin/installation) — Installation, Betrieb, Konfiguration,
  Verwaltung einer Organisation.
- [Security and compliance](/en/security/) — Isolation, Identität, Verschlüsselung, Audit,
  Datenschutz.
- [Integrations](/en/integrations/ci) — CI und lokale Agenten.
- [Reference](/en/reference/api) — REST-API, Kommandozeile `wfm`,
  [Versionshinweise](/en/reference/changelog).
- [Internals](/en/internals/) — Architektur und Interna.

## PDF

`npm run docs:pdf` schreibt jeden Abschnitt dieser Dokumentation als PDF, in jeder Sprache, nach
`docs/pdf/` — für eine Audit-Akte oder zum Lesen ohne Verbindung.
