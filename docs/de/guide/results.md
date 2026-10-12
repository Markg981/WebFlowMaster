# Ergebnisse

## Historische Eingaben und Wiederholung

Berichte zeigen die erfassten Testversionen, die veröffentlichte bzw. Arbeitsquelle, den SHA-256
jeder Definition und Fingerabdrücke der Datasets und der aufbewahrten Konfiguration. HTML-/PDF-,
Allure- und JUnit-Exporte enthalten diese Herkunft ohne Snapshot-Werte und ohne Zugangsdaten.

Bearbeiter und Eigentümer können **Historische Konfiguration wiederholen** wählen und einen neuen
manuellen Lauf bestätigen. Er verwendet die aufbewahrten Tests, Dataset-Werte, Browserauswahl und
Einstellungen, auch nach Änderungen am Katalog oder am Plan. Der neue Bericht verweist auf seine
Quelle und behält identische Eingabe-Fingerabdrücke. Gelöschte Tests können Ergebnisse aus
gespeicherten Definitionen liefern; der Quellplan muss aber noch existieren. Berichte ohne
geprüfte eingereihte Eingaben bieten keine historische Wiederholung an.

Es gelten die aktuellen Zugriffsrechte, Prüfungen und Kontingente. Umgebungs-Secrets, gespeicherte
Sitzungen, Geräte, Browser-Binärdateien, BDD-Profile, Integrationen und die getestete Anwendung
verwenden ihren aktuellen Stand. Externe Änderungen können das Ergebnis ändern. Die Wiederholung
aktualisiert nicht den Status des ursprünglichen CI-Builds.

## Übersicht

Die **Übersicht** zeigt, wie die letzten Läufe ausgegangen sind, die Zahl der bestandenen und
fehlgeschlagenen Läufe der letzten 30 Tage, die neuesten Berichte und die nächsten geplanten Läufe.

## Berichte

**Berichte** listet jeden abgeschlossenen Lauf: seinen Plan, Status, Startzeit, Dauer, die Zahl der
bestandenen, fehlgeschlagenen und übersprungenen Tests und wer oder was ihn gestartet hat (eine
Person, ein Zeitplan, eine Pipeline). Filtern Sie nach Plan und Status und öffnen Sie einen Lauf
mit **Bericht anzeigen**.

![Berichte: jeder abgeschlossene Lauf](/screenshots/reports.webp)

## Der Bericht eines Laufs

![Ein Laufbericht: Summen, Dauer und Ergebnisse nach Modul](/screenshots/run-report.webp)

Der Bericht listet jeden Test in jedem Browser mit seinem Ergebnis und seine Schritte mit ihren
Zeiten. Darum herum:

- **Build**: Bei einem aus der CI gestarteten Lauf das getestete Repository, Branch, Commit und
  Build.
- **Ausgeführt auf**: der Runner oder die lokalen Agenten, die ihn ausgeführt haben.
- **Versuche**: Ein Test, der nach einem Fehlschlag erneut lief, zeigt seine Versuche; einer, der
  erst bei einem späteren Versuch bestanden hat, wird als **instabil** markiert.
- **Quarantäne**: Fehlschläge von Tests in Quarantäne werden angezeigt, haben den Lauf aber nicht
  scheitern lassen.
- Wie ein Lauf endete, der nicht fertig wurde: **Abgebrochen**, **Zeitlimit überschritten** oder
  **Nicht abgeschlossen** (der Runner hat aufgehört).

![Fehlgeschlagene Tests im Bericht, mit Browser, Grund und Nachweisen](/screenshots/run-report-failure.webp)

Die **Diagramme** zeigen die Aufteilung des Laufs — bestanden, fehlgeschlagen und übersprungen, mit
der Erfolgsquote — und dieselbe Aufteilung pro Priorität und pro Schweregrad; fahren Sie über einen
Balken, um seine Zahl zu sehen. Die **Filter** schränken die fehlgeschlagenen Tests und die
Ergebnisse nach Modul auf eine Komponente, einen Schweregrad oder ein Ergebnis ein; die Zahlen sind
dann die der angezeigten Tests, und **Filter zurücksetzen** holt den ganzen Lauf zurück.

### Manuelle Ergebnisse {#manual-results}

Die [manuellen Tests](./organizing#manual-tests) eines Laufs erscheinen in der Karte **Manuelle
Tests**, eine Zeile pro Test, **Wartet**, bis jemand sein Ergebnis einträgt; ein Lauf mit wartenden
Tests endet trotzdem als abgeschlossen. Nach dem Ende des Laufs öffnet ein Bearbeiter die Zeile,
markiert jeden Schritt als **OK**, **Fehler** oder **Nicht ausgeführt** mit einer Notiz und trägt
das Urteil ein:

- **Bestanden** zählt zu den bestandenen Tests.
- **Fehlgeschlagen** zählt zu den fehlgeschlagenen und lässt den Lauf scheitern; als Grund wird die
  Notiz angezeigt, andernfalls die Notiz des ersten fehlerhaften Schritts.
- **Blockiert** (konnte nicht durchgeführt werden) zählt zu den übersprungenen.

Jedes Urteil berechnet Summen und Status des Laufs neu, sodass der Bericht manuelle und
automatisierte Ergebnisse mischt. Ein abgebrochener oder zeitüberschrittener Lauf behält sein Ende.
Ein Urteil lässt sich korrigieren, indem man es erneut einträgt; die Zeile zeigt, wer es wann
eingetragen hat, und jede Eintragung geht ins Audit-Protokoll.

### Veröffentlichen in TestRail, Xray oder Zephyr {#test-management}

Ein Plan, dessen Einstellungen unter **Ergebnisse veröffentlichen in** eine Verbindung nennen,
sendet jeden abgeschlossenen Lauf an dieses Werkzeug, das Ergebnis jedes Tests unter seinem Fall:

| Werkzeug                                    | Was aus einem Lauf wird                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **TestRail**                                | Ein Test Run im Projekt (und in der Suite), nur mit den Fällen des Laufs, und je ein Ergebnis.     |
| **Xray Cloud**, **Xray Server/Data Center** | Ein Test-Execution-Issue, das dem Xray-Testplan hinzugefügt wird, wenn die Verbindung einen nennt. |
| **Zephyr Scale** (Cloud)                    | Ein Testzyklus mit einer Test Execution pro Fall.                                                  |

**Welcher Fall ein Test ist.** Unter **Einstellungen → Testmanagement** listet **Testfälle** bei
einer Verbindung jeden Test — Web, API und mobile App — mit einem Feld für seinen Schlüssel: `C123`
in TestRail (oder nur `123`), `SHOP-45` in Xray, `SHOP-T12` in Zephyr. Ein Test, dessen Name mit
einem Schlüssel in eckigen Klammern beginnt — `[C123] Login` —, braucht keine Eingabe: Der
Schlüssel wird grau im Feld angezeigt und so verwendet. Ein im Feld eingetragener Schlüssel hat
Vorrang vor dem Namen. Tests ohne beides werden ausgelassen, und die Veröffentlichung sagt, wie
viele; ein Fall, den das Werkzeug nicht kennt, ließe den ganzen Import scheitern.

**Was für einen Fall gesendet wird.** Bestanden, fehlgeschlagen oder übersprungen, und **Nicht
ausgeführt** für einen Test, der noch auf ein manuelles Urteil wartet (Xray TODO, Zephyr Not
Executed; TestRail erhält dafür kein Ergebnis). Ein Test in mehreren Browsern oder zwei Tests zum
selben Fall ergeben ein Ergebnis, fehlgeschlagen, wenn einer fehlgeschlagen ist, mit dem Ausgang
jedes Browsers, dem Grund eines Fehlschlags (bis zu 1000 Zeichen) und der Adresse des Berichts im
Kommentar. Der Titel des Laufs ist der Name des Plans und sein Ende, in UTC.

Die Karte **Testmanagement** des Berichts zeigt, wohin der Lauf ging, mit einem Link zum
TestRail-Run oder zum Xray-Issue, wie viele Fälle veröffentlicht wurden und wie viele Tests keinen
Fall hatten, und warum eine Veröffentlichung scheiterte (ein falsches Token, ein vom Werkzeug
abgelehnter Fall). **Erneut veröffentlichen** sendet den Lauf noch einmal — wenn die manuellen
Urteile vorliegen oder das Werkzeug nicht erreichbar war — an die Verbindung des Plans oder an eine
andere; jedes Mal entsteht ein neuer Run im Werkzeug. Eine gescheiterte Veröffentlichung ändert nie
das Ergebnis des Laufs.

### KI-Fehleranalyse {#ai-failure-analysis}

Hat die Installation einen KI-Schlüssel (`GEMINI_API_KEY`), hat jeder fehlgeschlagene Test unter
**Fehlgeschlagene Tests** eine Schaltfläche **Mit KI analysieren**. Ein Bearbeiter klickt darauf,
und die KI liest, was der Bericht bereits enthält: den Grund des Runners, die Schritte rund um den
Fehlschlag mit ihren Fehlern, die fehlgeschlagenen und langsamen Anfragen und den Screenshot. Sie
antwortet in der Sprache der Oberfläche mit:

- einer **Kategorie**: **Locator** (das Element ist da, aber der Test sucht es falsch),
  **Anwendungsfehler**, **Timing**, **Testdaten**, **Umgebung** oder **Unklar**;
- wie sicher sie ist und welchen Schritt sie verantwortlich macht;
- warum sie das denkt und was als Nächstes zu tun ist;
- bei einem Locator einen **Vorgeschlagener Selektor**, zum Kopieren oder um ihn mit **Auf den Test
  anwenden** in den Schritt zu übernehmen.

**Auf den Test anwenden** ändert den Selektor genau dieses Schritts und speichert den Test als neue
Version, die der Verlauf rückgängig machen kann; Pläne verwenden sie, sobald sie veröffentlicht
ist. Die Schaltfläche erscheint, wenn der Schritt zum Test selbst gehört — ein Schritt innerhalb
einer Schrittgruppe wird in der Gruppe geändert — und bei Läufen ab dieser Version von
WebFlowMaster, deren Schritte festhalten, welcher Schritt des Tests sie waren.

Die Analyse wird am Ergebnis aufbewahrt: Sie erneut zu öffnen kostet niemanden etwas, und **Erneut
analysieren** fordert eine neue an. Sie ist eine wahrscheinliche Ursache, kein Urteil — prüfen Sie
sie an den Schritten. Werte, die wie Passwörter, Codes oder Schlüssel aussehen, werden nie gesendet
(siehe [AI features](/en/security/#ai-features), auf Englisch), und jede Analyse geht ins
Audit-Protokoll.

### Die Details eines Schritts

Ein geöffneter Schritt zeigt seinen **Screenshot**, den Fehler, an dem er gescheitert ist, und —
wenn der Plan sie aufbewahrt — das **Video** und den **Playwright-Trace** des Tests. Laden Sie den
Trace herunter und öffnen Sie ihn mit `npx playwright show-trace` oder auf trace.playwright.dev: Er
spielt jede Aktion mit der Seite, wie sie war, der Konsole und dem Netzwerk erneut ab.

Ein als **repariert** markierter Schritt hat sein Element erst gefunden, nachdem sein Selektor
ersetzt wurde (siehe [Element-Repository](./web-tests#element-repository)).

### Visuelle Tests {#visual-testing}

Sind **Visuelle Tests** in einem Plan eingeschaltet, wird der Screenshot jedes Schritts mit seiner
**Referenz** verglichen. Der erste Lauf nach dem Einschalten zeichnet die Referenzen auf. Danach
zeigt ein Schritt, dessen Screenshot abweicht, die **Referenz**, **Dieser Lauf** und die
**Differenz**.

### Netzwerk

Bewahrt der Plan das Netzwerk auf, fasst der Bericht den Verkehr jedes Tests zusammen: wie viele
Anfragen, wie viele fehlgeschlagen, wie viel empfangen wurde und die fehlgeschlagenen und
langsamsten Anfragen. **HAR herunterladen**, um die ganze Aufzeichnung in den Entwicklerwerkzeugen
eines beliebigen Browsers zu öffnen. Sie enthält nie Request- oder Response-Bodys, Cookies, Tokens
oder Passwörter.

### Barrierefreiheit

Ein Schritt **Barrierefreiheit prüfen** zeigt, welche Regeln auf welchen Elementen verletzt wurden
und wie schwer jeweils; welche eingehalten wurden; und welche eine Prüfung durch einen Menschen
brauchen.

## Einen Lauf exportieren

**Exportieren** lädt den Lauf herunter als:

| Format                   | Wofür                                                           |
| ------------------------ | --------------------------------------------------------------- |
| HTML-Bericht             | Eine Datei, die sich überall öffnen lässt, mit Screenshots.     |
| PDF                      | Zum Anhängen an ein Ticket oder zur Aufbewahrung für ein Audit. |
| Allure-Ergebnisse (.zip) | `allure generate` oder ein Allure-Server.                       |
| JUnit XML                | Der Testbericht eines CI-Systems.                               |

**Abgedeckte Anforderungen** zeigt die [Anforderungen](./organizing#requirements) mit genau den
Ergebnissen dieses Laufs und exportiert sie als Rückverfolgbarkeitsmatrix.

## Ein Ticket anlegen

Hat ein Eigentümer Jira oder Azure DevOps verbunden, hat ein fehlgeschlagener Test im Bericht
**Ticket anlegen**, das ein Ticket mit den Details des Fehlschlags öffnet, und danach **Im Tracker
öffnen**. Ein Plan kann sie auch selbst anlegen (siehe [Planeinstellungen](./running#planeinstellungen)).

## Instabile Tests und Quarantäne

**Berichte** zeigt außerdem **Tests, die sich widersprechen**: über die letzten Tage die Tests,
deren Urteil von einem Lauf zum nächsten wechselte, ohne dass etwas es erklärt. Ein Test, der kaputt
war und repariert wurde, steht nicht darin, ebenso wenig einer, dessen Urteil sich änderte, weil er
bearbeitet wurde. Mobile Tests werden pro Gerät gezählt ([mobile Apps](./mobile-apps#unstable)).

Ein instabiler Test kann mit Begründung in **Quarantäne** gestellt werden. Er läuft weiter und seine
Ergebnisse werden aufbewahrt, aber seine Fehlschläge lassen keine Läufe mehr scheitern, stoppen
keine Pläne, legen keine Tickets an und brechen keine Pipelines. **Tests in Quarantäne** zeigt, wie
sich jeder seitdem geschlagen hat; besteht er wieder, **Entlassen** Sie ihn mit einer Notiz, was ihn
repariert hat. Web-, API- und [mobile](./mobile-apps#quarantine) Tests können alle in Quarantäne
gestellt werden.

## Wie lange Nachweise aufbewahrt werden

Screenshots, Videos, Traces und Netzwerkaufzeichnungen werden nach der Aufbewahrungsfrist Ihrer
Installation entfernt (standardmäßig 90 Tage). Der Bericht weist dann darauf hin; seine Ergebnisse
und Urteile bleiben.
