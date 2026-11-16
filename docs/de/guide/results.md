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
fehlgeschlagenen Läufe der letzten 30 Tage (Läufe, die ihr Zeitlimit erreichten, werden getrennt als **Zeitüberschreitung** im Statusdiagramm und seiner Legende gezählt), die neuesten Berichte und die nächsten geplanten Läufe.

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
Tests endet trotzdem als abgeschlossen. Ein Lauf, in dem jeder Test übersprungen wurde (zum Beispiel durch die Richtlinie „nur veröffentlicht“), endet mit **Fehler** und dem Grund „No test produced a verdict (all skipped)“, der im Berichtskopf steht: Früher endete er abgeschlossen und grün. Das ist eine Verhaltensänderung. Nach dem Ende des Laufs öffnet ein Bearbeiter die Zeile,
markiert jeden Schritt als **OK**, **Fehler** oder **Nicht ausgeführt** mit einer Notiz und trägt
das Urteil ein:

- **Bestanden** zählt zu den bestandenen Tests.
- **Fehlgeschlagen** zählt zu den fehlgeschlagenen und lässt den Lauf scheitern; als Grund wird die
  Notiz angezeigt, andernfalls die Notiz des ersten fehlerhaften Schritts.
- **Blockiert** (konnte nicht durchgeführt werden) zählt zu den übersprungenen.

Jedes Urteil berechnet Summen und Status des Laufs neu, sodass der Bericht manuelle und
automatisierte Ergebnisse mischt. Ein abgeschlossener oder fehlgeschlagener Lauf wechselt zwischen beiden wie jedes Laufende, sodass Commit-Status, Benachrichtigungen und Testmanagement-Veröffentlichung mit dem neuen Ergebnis erneut laufen. Ein abgebrochener oder zeitüberschrittener Lauf behält sein Ende und meldet nichts.
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
abgelehnter Fall). Ein Lauf, bei dem das Werkzeug nur einen Teil der Fälle übernahm, ist **Teilweise veröffentlicht**, einer, bei dem es keinen übernahm, ist **Fehlgeschlagen**, nie Veröffentlicht; ein TestRail-Run, der vor dem Scheitern seiner Ergebnisse angelegt wurde, bleibt verlinkt. Anfragen mit Netzwerkfehler, 429 oder 502–504 werden bis zu dreimal wiederholt. **Erneut veröffentlichen** sendet den Lauf noch einmal — wenn die manuellen
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

#### Wer einen Trace herunterladen darf {#who-can-download-a-trace}

Ein Trace ist **Rohmaterial als Nachweis**: Er enthält den Inhalt der Seite und jede Anfrage mit ihrem
Body, ein während des Tests getipptes Passwort steht also im Klartext darin. Nur **Bearbeiter** und
**Eigentümer** können Traces und HAR-Dateien herunterladen; ein Betrachter sieht den Rest des Berichts
und einen Hinweis, dass der Trace existiert. Der Server entscheidet das bei jedem Download, die
Kenntnis der Adresse ändert daran nichts. Ein API-Schlüssel braucht außerdem den Scope `runs:evidence`.

| Datei                                                       | Betrachter | Bearbeiter, Eigentümer |
| ----------------------------------------------------------- | ---------- | ---------------------- |
| Screenshots, visuelle Diffs, Video                          | ✓          | ✓                      |
| Lighthouse-Bericht, von einem Test heruntergeladene Dateien | ✓          | ✓                      |
| Playwright-Trace, HAR                                       | —          | ✓                      |
| Jede andere Datei des Laufs (ältere oder unbekannte Namen)  | —          | ✓                      |

Die Dateien eines Tests in einem **eingeschränkten Projekt** sind nur für die Personen des Projekts
(und für Eigentümer) verfügbar. Für alle anderen existieren sie nicht: Sie erhalten dieselbe Antwort
wie für eine Datei, die nie geschrieben wurde.

Dieselbe Einschränkung gilt für den Planbericht, die Live-Ausführungsansicht und den JUnit-Export
(auch den mit einem API-Schlüssel abgerufenen, der als Benutzer des Schlüssels handelt): Ein Test
eines eingeschränkten Projekts, in dem Sie nicht sind, zeigt nur seinen Namen und sein Urteil, ohne
Schritte, Protokolle, Netzwerkaufzeichnung oder KI-Analyse, und ein Lauf, der einen solchen Test
enthält, kann nicht live verfolgt werden.

Ein Test, der sichtbar mit einer Zugangsinformation umgeht — ein Wert `{{secret_…}}` oder ein Feld,
Selektor oder Wert namens _password_ —, **zeichnet keinen Trace auf**, auch wenn der Plan einen
verlangt; das Protokoll des Laufs sagt das. Video und Screenshots bleiben wie verlangt erhalten.

::: warning Screenshots, Videos und Traces werden nicht bereinigt
Nichts entfernt ein Geheimnis aus einem Bild oder einer Aufzeichnung. Ein Browser zeichnet ein
Passwortfeld als Punkte, aber eine Anwendung kann ein Token, einen personenbezogenen Datensatz oder
einen Einmalcode überall auf der Seite anzeigen, und genau das enthalten Screenshot und Video dann.
Für Abläufe mit echten Zugangsdaten oder personenbezogenen Daten: Verwenden Sie eigene Testkonten,
stellen Sie im Plan **Trace** auf _Nie_ und **Video** auf _Nie_ oder _Wenn der Test scheitert_ und
halten Sie `ARTIFACT_RETENTION_DAYS` kurz.
:::

#### Reparierte Schritte {#healed-steps}

Ein als **nach Reparatur bestanden** markierter Schritt ist mit einem reparierten Locator bestanden,
nicht mit seinem eigenen (siehe
[Runtime use, approval and publishing](/en/guide/web-tests#healing-approval), auf Englisch). Er zählt
weiterhin als bestanden, und die Schritte danach liefen normal. Schritte, die mit ihrem eigenen
Locator bestanden haben, tragen kein Abzeichen. Die Schrittdetails zeigen:

- den **geschriebenen Locator** und den **in diesem Lauf verwendeten**;
- was ihn gefunden hat: ein bekannter Fallback oder die KI;
- den **Vorschlag** und seinen aktuellen Zustand: _vorgeschlagen_, _genehmigt_ (mit der Version der
  Arbeitskopie, die daraus wurde), _abgelehnt_ oder _veraltet_ (der Schritt wurde nach dem Lauf
  geändert und kann daher nicht mehr genehmigt werden).

Bearbeiter und Eigentümer des Projekts sehen **Genehmigen** und **Ablehnen**. Das Genehmigen schreibt
die Reparatur dorthin, wo der Schritt geschrieben ist, unter dem Fingerabdruck, den der Lauf
festgehalten hat. Es veröffentlicht nichts: Die neue Version geht nur über den üblichen
Veröffentlichungs- oder Prüfschritt live. Das Protokoll des Laufs enthält für jeden reparierten Schritt
eine Warnung. Vorschläge sind auch über `GET /api/healing-proposals?testId=…` verfügbar.

Vor den Genehmigungen aufgezeichnete Ergebnisse zeigen, was der Lauf damals tat (er schrieb die
Reparatur selbst).

Die rote Umrandung, die das bearbeitete Element markiert, wird nach jeder Aktion entfernt.
Screenshots, visuelle Vergleiche und die an die KI gesendete Seite zeigen die Anwendung, wie sie ist.

#### Versuche und Dataset-Zeilen {#attempts-and-rows}

Jede Zeile des Berichts ist ein Test in einem Browser, in einer Sprache (und bei einem mobilen Test
auf einem Gerät): eine **Einheit** des Laufs. Die Nachweise einer Einheit werden pro **Versuch** und,
bei einem Test mit [Dataset](./web-tests#datasets), pro **Zeile** jedes Versuchs aufbewahrt. Eine
Wiederholung überschreibt die Nachweise des ersten Versuchs nicht, und eine Zeile überschreibt die
einer anderen nicht.

Hat ein Ergebnis mehr als einen Versuch oder Dataset-Zeilen, öffnen seine Details mit zwei
Auswahlfeldern:

- **Versuche**: _Versuch 1 · fehlgeschlagen_, _Versuch 2 · bestanden · Ergebnis_… Die Details öffnen
  sich beim Versuch, auf dem das Ergebnis beruht. Wählen Sie einen früheren, um die Nachweise des
  Fehlschlags zu öffnen, den die Wiederholung ersetzt hat: Screenshot, Video, Trace und HAR sowie den
  Grund des Fehlschlags.
- **Datensatzzeilen**: _Alle Zeilen_ oder eine Zeile mit ihrem eigenen Ergebnis und Fehler. Wer eine
  Zeile wählt, sieht deren Schritte und ihr eigenes Video, ihren Trace und HAR, nichts von den
  anderen Zeilen.

Der Bericht behält die Schritte des Versuchs, auf dem das Ergebnis beruht. Ein früherer Versuch zeigt
seine Nachweise und seinen Grund und sagt, dass seine Schritte in seinem Trace stehen. Die obigen
Regeln, wer einen Trace herunterladen darf, gelten für jeden Versuch und jede Zeile.

Ein Link kann den Bericht auf einem Ausschnitt öffnen: Hängen Sie `?unit=<unit id>&attempt=<n>&row=<m>`
an die Adresse des Berichts an (row ab 0). Die API liefert dieselbe Sicht: `GET /api/v1/runs/{runId}/units`
listet die Einheiten eines Laufs, und `GET /api/v1/runs/{runId}/units/{unitId}` liefert jeden Versuch
und jede Zeile mit Links zu ihren Dateien (siehe [API](/en/reference/api), auf Englisch). Aus einer
Pipeline gibt `wfm units <runId> [<unitId>]` sie aus.

Der Nachweis eines Versuchs wird nur einmal geschrieben. Ein verspäteter Upload desselben Versuchs
(zum Beispiel von einem Worker, der seine Arbeit verloren hat) ersetzt keine Datei, auf die der
Bericht bereits verweist. Läufe aus der Zeit vor dieser Version behalten ihre Links wie bisher. Ihre
Versuche und Zeilen wurden nicht getrennt aufbewahrt.

### Visuelle Tests {#visual-testing}

Sind **Visuelle Tests** in einem Plan eingeschaltet, wird der Screenshot jedes Schritts mit seiner
**Referenz** verglichen. Der erste Lauf nach dem Einschalten zeichnet die Referenzen auf. Danach
zeigt ein Schritt, dessen Screenshot abweicht, die **Referenz**, **Dieser Lauf** und die
**Differenz**.

Ein Vergleich kann auch gar nicht zustande kommen: Die gespeicherte Referenz ist kein lesbares Bild,
der Artefaktspeicher ist nicht erreichbar oder der Screenshot des Schritts kann nicht aufgenommen
werden. Dieser Schritt ist **nicht verifiziert**, und der Test endet als **Fehler** — nie als
bestanden und nie als visuelle Abweichung gezählt. Der Schritt zeigt die Ursache (`baseline-corrupt`,
`storage-unavailable`, `screenshot-unavailable`, `comparison-failed`); der Grund lautet „Visual
comparison could not run (…)“. Die Exporte stimmen überein: Der JSON-Bericht behält die Ursache am
Schritt, Allure zeigt Test und Schritt als _broken_ unter **Visual comparison errors**, und JUnit
schreibt ein `<error>`. Eine beschädigte Referenz wird nie von selbst ersetzt: Starten Sie einen Lauf
mit `updateBaselines: true` (siehe [API](/en/reference/api), auf Englisch), um die Screenshots dieses
Laufs als neue Referenzen zu übernehmen.

#### Eine neue Baseline genehmigen {#approve-baseline}

Ist eine visuelle Abweichung gewollt — ein Redesign, ein neues Banner —, kann ein **Bearbeiter** oder
**Eigentümer** sie aus dem Bericht übernehmen: Öffnen Sie die Schritte des Tests, drücken Sie beim
Schritt mit der Abweichung **Als neue Baseline freigeben** und bestätigen Sie. Das Bild dieses Laufs
ersetzt die gespeicherte Baseline für diesen Test, Schritt, Browser und diese Dataset-Zeile, und der
Schritt zeigt, wer sie wann freigegeben hat. Der nächste Lauf wird mit dem neuen Bild verglichen. Die
Freigabe wird im Audit-Protokoll festgehalten (`visual_baseline.approved`). In einem eingeschränkten
Projekt braucht sie Bearbeitungsrechte am Projekt; Betrachter sehen die Schaltfläche nicht. Das
Urteil des Laufs ändert sich nicht: Er bleibt fehlgeschlagen.

### Netzwerk

Bewahrt der Plan das Netzwerk auf, fasst der Bericht den Verkehr jedes Tests zusammen: wie viele
Anfragen, wie viele fehlgeschlagen, wie viel empfangen wurde und die fehlgeschlagenen und
langsamsten Anfragen. **HAR herunterladen**, um die ganze Aufzeichnung in den Entwicklerwerkzeugen
eines beliebigen Browsers zu öffnen. Sie enthält nie Request- oder Response-Bodys; Cookies, Authorization-Header und Query-Parameter mit zugangsdatenähnlichen Namen werden durch `[redacted]` ersetzt. Eine Zugangsinformation in anderer Form — in einem Pfad, in einem eigenen Header — wird nicht erkannt, weshalb das HAR wie der Trace Rohmaterial als Nachweis ist.

### Barrierefreiheit

Ein Schritt **Barrierefreiheit prüfen** zeigt, welche Regeln auf welchen Elementen verletzt wurden
und wie schwer jeweils; welche eingehalten wurden; und welche eine Prüfung durch einen Menschen
brauchen.

## Zwei Umgebungen vergleichen {#comparing-environments}

Ein Vergleich führt einen Plan auf zwei Umgebungen aus und stellt die beiden Läufe Test für Test
nebeneinander. Er zeigt, dass sich eine neue Version wie die aktuelle verhält: die **Referenz** ist
die Umgebung, der Sie vertrauen, der **Kandidat** die, die Sie prüfen.

Unter **Testpläne** klickt ein Editor bei einem Plan auf **Umgebungen vergleichen**, wählt Referenz
und Kandidat (zwei verschiedene [Umgebungen](./web-tests#variables-and-environments)) und die
Reihenfolge:

- **Erst die Referenz, dann der Kandidat**: der Kandidat startet, wenn der Lauf der Referenz beendet ist.
- **Beide gleichzeitig**: die beiden Läufe starten zusammen.

Beide Läufe führen dieselben eingefrorenen Tests aus, sodass eine zwischenzeitliche Änderung nicht
nur eine Seite erreichen kann. Jeder Lauf ist ein normaler Lauf mit eigenem Bericht, und dieser
Bericht verweist auf seinen Vergleich. Ein Editor kann einen laufenden Vergleich abbrechen; Viewer
können ihn lesen.

**Vergleiche** im Seitenmenü listet sie auf. Sind beide Läufe beendet, zeigt der Bericht eines
Vergleichs:

- das Gesamtergebnis und wie viele Tests jedes Testergebnis haben;
- **Parität nach Modul**: den Anteil identischer oder gleichwertiger Tests in jedem Modul;
- die Tests, nach Ergebnis filterbar. Ein geöffneter Test zeigt jede Abweichung: den Schritt, den
  Checkpoint, die Art (Ergebnis, Text, Screenshot, Dauer…), was jede Seite hatte und ob sie
  blockierend oder informativ ist. Eine Screenshot-Abweichung zeigt beide Screenshots. Ein Test,
  den Sie nicht sehen dürfen, wird ohne Details aufgeführt.

| Testergebnis              | Wann                                             |
| ------------------------- | ------------------------------------------------ |
| Identisch                 | Keine Abweichung                                 |
| Gleichwertig              | Nur informative Abweichungen                     |
| Abweichend                | Mindestens eine blockierende Abweichung          |
| Ergebnis abweichend       | Auf einer Seite bestanden, auf der anderen nicht |
| Auf beiden fehlgeschlagen | Auf beiden Seiten fehlgeschlagen: beweist nichts |
| Nicht vergleichbar        | Eine Seite hat kein Ergebnis für den Test        |

Das Gesamtergebnis ist **Regressionen**, wenn ein Test abweichend ist oder ein abweichendes
Ergebnis hat; sonst **Nicht eindeutig**, wenn einer auf beiden Seiten fehlgeschlagen oder nicht
vergleichbar ist; sonst **Parität mit akzeptierten Unterschieden**, wenn einer gleichwertig ist;
sonst **Parität**.

Was verglichen wird, Checkpoint für Checkpoint, nach Namen zugeordnet:

- das Ergebnis jedes Tests;
- **Checkpoint text**: die Texte, in ihrer Reihenfolge;
- **Checkpoint table**: die Zellen, Zeile für Zeile und Zelle für Zelle. Eine Zeile, die nur auf
  einer Seite steht, ist eine Abweichung. Eine Zelle, die auf beiden Seiten als Zahl gelesen wird,
  stimmt innerhalb der numerischen Toleranz überein;
- **Checkpoint chart**: die Serien, nach Namen zugeordnet, und ihre Punkte nach Argument (Werte
  innerhalb der numerischen Toleranz); die Achsenbereiche; die Referenzlinien;
- **Checkpoint network**: jeder Aufruf (Methode, Pfad und Query) seit dem vorigen
  Netzwerk-Checkpoint, wie oft er erfolgte, sein Status und der Hash des Request-Bodys, und des
  Response-Bodys, wenn die Toleranzen es verlangen;
- die Screenshots desselben Schritts und die Dauern: die des Tests und, wo das Log sie erfasst, die
  jedes Schritts. Schneller zu sein ist nie eine Abweichung, eine Verlangsamung unter 250 ms auch
  nicht.

Ein Test behält höchstens 200 Abweichungen; der Bericht sagt, wie viele weitere gefunden wurden.

### Toleranzen

**Toleranzen** im Dialog **Umgebungen vergleichen** legen fest, wie streng der Vergleich ist. Die
API nimmt dieselben Einstellungen als `policy` in `POST /api/test-plans/{planId}/comparisons`.

| Gruppe      | Einstellung                                                     | Standard        |
| ----------- | --------------------------------------------------------------- | --------------- |
| Text        | Mehrere Leerzeichen als eines behandeln                         | an              |
| Text        | Groß- und Kleinschreibung ignorieren                            | aus             |
| Text        | Ersetzungen, eine `Muster => Ersatz` pro Zeile                  | keine           |
| Zahlen      | Absolute Toleranz; relative Toleranz (%)                        | 0; 0            |
| Netzwerk    | Verglichene Pfade (Muster, `*` passt auf alles)                 | `**/api/**`     |
| Netzwerk    | Ignorierte Query-Parameter; Hash des Response-Bodys vergleichen | keine; aus      |
| Screenshots | Aus, informativ oder blockierend; abweichende Pixel erlaubt (%) | informativ; 1%  |
| Dauern      | Aus, informativ oder blockierend; erlaubte Verlangsamung (%)    | informativ; 20% |

Eine Ersetzung ist ein regulärer Ausdruck, der vor dem Vergleich auf beide Seiten angewendet wird,
überall im Text: `\d{2}/\d{2}/\d{4} => DATUM` macht zwei Daten gleich. Eine Regel ohne `=>` löscht,
was sie findet.

### Einen Test prüfen und bekannte Abweichungen {#known-differences}

In einem geöffneten Test klickt ein Editor auf **Prüfung** und sagt, ob die Abweichungen erwartet
sind:

- **Akzeptiert**: die Abweichung ist erwartet. Eine Begründung ist Pflicht.
- **Fehler**: der Kandidat ist falsch. Die Notiz ist optional.

Die Prüfung und ihre Notiz bleiben am Test; ein Viewer sieht sie, kann aber nicht prüfen.

Ein akzeptierter Test kann auch spätere Vergleiche anleiten: **Diese Abweichungen in späteren
Vergleichen erwarten** speichert die gewählten blockierenden Abweichungen (höchstens 50) als
**bekannte Abweichungen**, für diesen Test, alle Tests seines Projekts oder alle Tests der
Organisation, mit optionaler Referenz (etwa einem Ticket) und Ablaufdatum. Die Begründung der
Prüfung wird ihre Begründung. Von da an wird eine Abweichung, die eine bekannte Abweichung abdeckt,
als **bekannt** markiert und blockiert nicht mehr: ein Test, dessen einzige blockierende
Abweichungen bekannt sind, ist **Gleichwertig**. Eine bekannte Abweichung deckt eine Abweichung
derselben Art ab, am selben Checkpoint (oder an jedem, wenn sie keinen nennt) und mit einem Pfad,
den ihr Muster erkennt, bis sie abläuft. Ein bereits durchgeführter Vergleich behält sein Ergebnis.

**Einstellungen → Bekannte Abweichungen** listet sie alle auf, markiert die abgelaufenen und lässt
einen Editor eine von Hand hinzufügen oder löschen. Eine bekannte Abweichung eines eingeschränkten
Projekts sieht nur, wer das Projekt sehen darf, und nur wer das Projekt bearbeiten darf, kann sie
hinzufügen oder löschen.

### Grenzen

- Die Zeilen einer Tabelle werden nach Position verglichen: eine auf einer Seite eingefügte Zeile
  verschiebt alle folgenden, und jede verschobene Zeile ist eine Abweichung (bis zu den 200, die
  ein Test behält). Erfassen Sie eine Tabelle auf beiden Seiten gleich sortiert, oder erfassen Sie
  nur die nötigen Zeilen mit `rows=` im Checkpoint.
- Netzwerkpfade werden gefiltert, wenn der Vergleich läuft, nicht wenn der Lauf sie erfasst: ein
  Netzwerk-Checkpoint behält alle Fetch- und XHR-Aufrufe (oder die, die auf seine eigenen Muster
  passen), sodass ein späterer Vergleich andere Pfade wählen kann.
- Die Dauer eines Web-Schritts steht nicht im Log, daher wird bei Web-Tests nur die Dauer des
  ganzen Tests verglichen.

Hat ein Element auf zwei Umgebungen verschiedene Selektoren, geben Sie ihm eine
[Locator-Variante](/en/guide/web-tests#element-variants) statt eines zweiten Elements.

### Den Paritätsbericht exportieren {#exporting-comparison}

Im Bericht eines beendeten Vergleichs bietet **Exportieren** einen **HTML-Paritätsbericht** (eine
Datei, die sich überall öffnet: Ergebnisse, Toleranzen und Prüfungen) und **PDF** (zum Anhängen an
eine Freigabe oder zum Ablegen für ein Audit). Exportieren kann jeder, der den Vergleich lesen darf.
CLI und API schreiben dieselben Dateien, siehe [Aus CI ausführen](/en/integrations/ci#comparison)
und die API unten.

Die API v1 startet und liest Vergleiche mit demselben Schlüssel wie Läufe (`runs:write` zum
Starten, `runs:read` zum Lesen), dokumentiert in `GET /api/v1/openapi.json`:

| Endpunkt                                                    | Was er tut                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `POST /api/v1/plans/{planId}/comparisons`                   | Startet einen Vergleich; antwortet `202` mit dem Vergleich und einem `Location`-Header. |
| `GET /api/v1/comparisons/{comparisonId}`                    | Liest ihn: `status`, `verdict`, `summary`, beide Seiten mit ihren Läufen, `failure`.    |
| `GET /api/v1/comparisons/{comparisonId}/export/{html\|pdf}` | Lädt den Paritätsbericht herunter.                                                      |

Der Body nimmt `baselineEnvironmentId` und `candidateEnvironmentId` (zwei verschiedene Umgebungen)
und optional `mode` (`sequential`, der Standard, oder `parallel`), `name` und `policy` (die
Toleranzen). Der optionale Header `Idempotency-Key` (höchstens 255 Zeichen) sorgt dafür, dass eine
wiederholte Anfrage den bereits gestarteten Vergleich zurückgibt. `links` in der Antwort nennt den
Bericht und die beiden Exporte. `verdict` ist `regressions`, `inconclusive`,
`parity_with_accepted` oder `parity` und bleibt leer, bis der Vergleich beendet ist.

Ein Vergleich sendet **eine** Benachrichtigung, wenn er endet, statt einer pro Lauf: siehe
[Planeinstellungen](./running#planeinstellungen). Sie folgt den Benachrichtigungseinstellungen des
Plans: Parität (mit oder ohne akzeptierte Unterschiede) ist ein Erfolg, Regressionen und ein nicht
eindeutiger Vergleich ein Fehlschlag, ein Vergleich, der nicht laufen konnte, „nicht ausgeführt“.
Ein abgebrochener Vergleich wird nur dort gemeldet, wo ein abgebrochener Lauf gemeldet würde. Die
Nachricht nennt den Plan, die beiden Umgebungen, das Ergebnis und die Anzahl der Tests je Ergebnis,
mit dem Link zum Bericht; Slack und Teams erhalten ihre eigene Karte, und die eingetragenen
E-Mail-Adressen bekommen auch eine Mail.

## Einen Lauf exportieren

**Exportieren** lädt den Lauf herunter als:

| Format                   | Wofür                                                           |
| ------------------------ | --------------------------------------------------------------- |
| HTML-Bericht             | Eine Datei, die sich überall öffnen lässt, mit Screenshots.     |
| PDF                      | Zum Anhängen an ein Ticket oder zur Aufbewahrung für ein Audit. |
| Allure-Ergebnisse (.zip) | `allure generate` oder ein Allure-Server.                       |
| JUnit XML                | Der Testbericht eines CI-Systems.                               |

Ein Export enthält die Ergebnisse und die Screenshots fehlgeschlagener Tests und sonst keine
Nachweise des Laufs: keinen Trace, kein HAR und kein Video, auch keinen Link darauf, wer auch immer
exportiert. Ein Screenshot eines Tests in einem eingeschränkten Projekt, in dem die exportierende
Person nicht ist, wird weggelassen.

Versuche und Dataset-Zeilen zählen nie als eigene Tests: Ein Export hat einen Test pro Einheit, wie
der Bericht. Der HTML-Bericht listet sie unter **Versuche und Dataset-Zeilen**. Allure hängt sie als
_Attempts and dataset rows_ an ihren Test. JUnit behält einen `<testcase>` pro Einheit und legt sie in
die Eigenschaft `wfm.attempts`.

Ein Lauf, der mit **Fehler**, **Zeitüberschreitung** oder **Abbruch** endete, wird nie nur mit seinen
grünen Tests exportiert. JUnit fügt einen `<error>`-Testfall mit dem Namen des Endes hinzu (zum
Beispiel _Run cancelled_), und Allure ein _broken_-Ergebnis desselben Namens, beide mit dem Grund des
Laufs. Der Berichtskopf zeigt den Status des Laufs, ob fertig oder nicht: dasselbe Urteil wie die API,
der CLI-Exit-Code und jeder Export.

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
bearbeitet wurde. Jeder Test wird für sich gezählt, nicht nach Name: Zwei verschiedene Tests mit demselben Namen bleiben getrennt, und ein umbenannter Test behält seinen Verlauf unter dem neuen Namen. Mobile Tests werden pro Gerät gezählt ([mobile Apps](./mobile-apps#unstable)).

Ein Test, der **beim Wiederholen bestanden** hat, wird ebenfalls gelistet, auch wenn jeder Lauf grün endete und sich nie ein Urteil änderte: Drei Läufe, die je beim zweiten Versuch bestanden, zeigen **3× beim Wiederholen bestanden**, und ein letzter grüner Lauf nimmt den Test nicht von der Liste. Wiederholungen, Urteilswechsel, Läufe, die wegen eines Infrastrukturfehlers nie liefen, und Bearbeitungen werden getrennt gezählt und nie ineinander aufsummiert. Nur vergleichbare Läufe teilen einen Verlauf: derselbe Test mit derselben Definition (eine bloße Umbenennung trennt ihn nicht, eine Änderung seiner Schritte, Daten oder Abhängigkeiten schon), im selben Browser, in derselben Umgebung, Sprache und auf demselben Gerät. **Nachweise** listet auf, was geschah, neueste zuerst, jeder Eintrag mit Link zum Bericht des Laufs, geöffnet beim Versuch, der ihn zeigt — bei einer Wiederholung der erste fehlgeschlagene Versuch und warum. Ein Lauf, der vor der Aufbewahrung von Versuchen aufgezeichnet wurde, sagt, dass die Ursache nicht aufgezeichnet wurde, statt eine zu raten.

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
