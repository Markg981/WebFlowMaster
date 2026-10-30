# Tests organisieren

## Die Testbibliothek

**Testbibliothek** listet jeden gespeicherten Webtest: seine Tags, wo er beginnt und wann er zuletzt
gespeichert wurde. Suchen Sie nach Namen oder filtern Sie per Klick auf ein Tag. In jeder Zeile
können Sie seinen **Verlauf** öffnen, seine Tags ändern oder ihn **Löschen** (mit seinem Verlauf).

![Die Testbibliothek mit Tags, Typen und letzten Ergebnissen](/screenshots/test-library.webp)

Die Bibliothek lädt 25 Zusammenfassungen pro Seite und zeigt die Gesamtzahl der Treffer Ihrer
Filter. Blättern Sie mit **Zurück** und **Weiter**. Die Namenssuche ignoriert Groß- und
Kleinschreibung und sucht den wörtlichen Text (einschließlich `%` und `_`); mehrere ausgewählte
Tags verlangen jedes Tag. Projekt- und Statusfilter gelten vor der Seitenaufteilung, und eine
Filteränderung führt zur ersten Seite zurück. API-Tests, mobile Tests und gemeinsame Testdaten
verwenden ebenfalls seitenweise Listen. Jede Liste lädt vollständige Definitionen nur bei Bedarf:
Einen manuellen oder BDD-Test bearbeiten holt seine Schritte, einen Datensatz bearbeiten holt seine
Tabelle, und einen API- oder mobilen Test laden oder ausführen holt seine ausführbare
Konfiguration. Listenantworten enthalten Metadaten und Anzahlen, nicht alle Schritte oder
Dataset-Werte.

**Tags** sind die eigenen Bezeichnungen Ihrer Organisation — `smoke`, `checkout`, `nightly` —, die
über die Zeile des Tests vergeben werden. Nach ihnen wählen [dynamische Suiten](#suites) aus.
**Einstellungen → Tags** listet jedes Tag mit der Zahl der Tests, die es tragen; ein Bearbeiter kann
es dort umbenennen (alle Tests folgen) oder löschen, was es von allen Tests entfernt, die es
trugen.

## Manuelle Tests {#manual-tests}

Mit **Testbibliothek → Neuer manueller Test** speichern Sie ein menschliches Vorgehen mit seinen
Schritten. Ein Plan hält manuelle Ergebnisse fest, statt Sätze in Browseraktionen umzuwandeln.
Prüfen und veröffentlichen Sie ihn über denselben Versionsablauf. Gherkin-Bearbeitung und
-Ausführung stehen unter [BDD-Tests](./bdd-tests).

**Gherkin-/Cucumber-Dateien.** Wählen Sie in **Dateien** **Gherkin (.feature)**, um Webtests zu
exportieren, oder öffnen Sie eine `.feature`-Datei und sehen Sie sich die Importvorschau an.
Standard-Gherkin in mehreren Sprachen umfasst Rule, Backgrounds, Doc Strings, Schritttabellen und
getaggte Examples. Wählen Sie manuelle Ausführung oder ein autorisiertes Cucumber-Profil auf dem
dedizierten Agenten Ihrer Organisation. Ausführbare portable Importe erfordern eine ausdrückliche
Zielbindung; Support-Definitionen sind vom Betreiber installiertes JavaScript/TypeScript.
WebFlowMaster-Metadaten stellen ursprüngliche Browseraktionen oder versionierte BDD-Definitionen
wieder her. Siehe [Details zu Gherkin-Dateien](./gherkin-files).

## Kommentare

Öffnen Sie **Kommentare** an einem gespeicherten Web-, API- oder mobilen Test oder an einem
Testergebnis in einem Bericht. Antworten Sie, erwähnen Sie Mitglieder, die das Ziel lesen dürfen,
und markieren Sie Gespräche als erledigt. Siehe
[Über einen Test oder ein Ergebnis sprechen](./collaboration#uber-einen-test-oder-ein-ergebnis-sprechen) zu Berechtigungen,
Filtern und Verhalten beim Löschen.

## Dashboards

Behalten Sie mehrere private Dashboards oder teilen Sie sie mit Ihrer Organisation. Wählen Sie ein
persönliches Standard-Dashboard und passen Sie Widget-Instanzen, Filter, Titel und Breiten an.
Bestehende persönliche Layouts bleiben erhalten. Siehe
[Dashboards auswählen und teilen](./collaboration#dashboards-auswahlen-und-teilen).

## Einen manuellen Test schreiben

Nicht alles lohnt sich zu automatisieren: eine Prüfung einmal pro Release, ein Ablauf, der das
Urteil einer Person braucht, ein Gerät, das kein Browser ersetzen kann. **Neuer manueller Test** in
der Bibliothek schreibt einen: einen Namen und seine Schritte, jeder mit einer auszuführenden
**Aktion** und dem **Erwartetes Ergebnis**. Er erscheint in der Bibliothek mit dem Abzeichen
**Manuell**, und sein Stift bearbeitet die Schritte. Jeder Schritt braucht seine Aktion: Leere
Schritte werden beim Speichern verworfen, und ein manueller Test ohne Schritte wird abgelehnt —
auch über die API.

Ein manueller Test ist ein Test wie die anderen: Er hat Versionen und Prüfungen, trägt Tags, kommt
in Suiten und Pläne. In einem Lauf öffnet er keinen Browser — er wartet im Bericht des Laufs auf das
Urteil eines Menschen (siehe [Manuelle Ergebnisse](./results#manual-results)), einmal pro Lauf,
gleich welche Browser und Sprachen der Plan hat.

## Verlauf und Versionen {#history-and-versions}

Web-, API- und mobile Tests haben eigene **Versionen**, nummeriert ab 1. Das Speichern einer
geänderten ausführbaren Konfiguration erzeugt eine Revision; das Speichern einer unveränderten
nicht. **Verlauf** zeigt die Revisionen, neueste zuerst, mit Autor und Datum, und lässt Sie sie
vergleichen. API-Vergleiche umfassen Protokoll, Anfrage, Autorisierung, Assertions, Erfassungen,
Performance und Aufräumen; mobile Vergleiche umfassen Plattform, App, Gerät, Betriebssystem, Grid
und Schritte.

**Wiederherstellen** speichert die frühere Konfiguration als neue Revision der Arbeitskopie und
behält jede Revision dazwischen. Es veröffentlicht sie nicht und ändert nicht die Version, die
Pläne ausführen.

Bestehende API- und mobile Tests beginnen bei Version 1 mit der Konfiguration, die zum Zeitpunkt der
Migration gespeichert war. Frühere Änderungen lassen sich nicht rekonstruieren; ältere Ergebnisse
ohne Version bleiben unversioniert.

## Tests als Dateien {#tests-as-files}

**Testbibliothek → Dateien** exportiert die Web- und API-Tests eines Projekts — oder alle — als eine
YAML- oder JSON-Datei, um sie in einem Repository neben der Anwendung aufzubewahren, in Pull
Requests zu prüfen und in eine andere Installation zu importieren. Die Datei enthält, was die Tests
sind (Schritte, Vorbedingungen, Aufräumen, Datasets, Anfragen, Assertions, Berichtsfelder), und
nichts, was zu dieser Installation gehört: keine IDs, Autoren oder Daten, sodass ein Diff nur zeigt,
was sich an den Tests geändert hat. Ein literales Secret in der Autorisierung eines API-Tests wird
als Variable geschrieben (<code v-pre>{{bearer_token}}</code>…): Legen Sie sie dort, wo die Tests
importiert werden, in einer Umgebung an.

**Importieren** liest eine solche Datei zurück. **Änderungen zeigen** listet jeden Test als neu,
aktualisiert, unverändert oder nicht importiert (mit Grund); **Importieren** speichert dann: Ein
Test mit demselben Namen wird aktualisiert und erhält eine neue [Version](#history-and-versions),
die anderen werden im gewählten Projekt angelegt. Schritte, die eine Schrittgruppe oder eine
benutzerdefinierte Aktion aufrufen oder ein gemeinsames Element nennen, verweisen per ID darauf;
diese Tests importieren sich also in ihre eigene Organisation; der Export sagt, wie viele es sind.
Die CLI macht dasselbe aus einer Pipeline: `wfm tests export` und `wfm tests import`
([CLI](/en/reference/cli), auf Englisch).

**Als Playwright-Test.** Das Dateisymbol an einem Webtest lädt ihn als Playwright-Test-Datei
(`*.spec.ts`) herunter, mit den Schritten, die ein Lauf ausführt — Schrittgruppen und
benutzerdefinierte Aktionen expandiert, gemeinsame Elemente aufgelöst. Variablen kommen aus
Umgebungsvariablen namens `WFM_<NAME>` (`WFM_BASEURL` für <code v-pre>{{baseUrl}}</code>);
Vorbedingungen laufen zuerst über die Request-Fixture von Playwright und das Aufräumen danach, was
auch immer passiert ist; ein Dataset wird zu einem Test pro Zeile. Schritte ohne Gegenstück
außerhalb von WebFlowMaster — auf eine E-Mail warten, eine Datenbankabfrage, der
Barrierefreiheits-Scan — werden als Kommentare geschrieben, und die ersten Zeilen der Datei sagen,
wie viele.

## Veröffentlichung und Prüfungen {#publishing-and-reviews}

Diese Regeln gelten für **Web-, API- und mobile** Tests. Ein gespeicherter Test ist eine
**Arbeitskopie**. Pläne führen die **veröffentlichte** Version aus, wenn es eine gibt; wurde ein
Test nie veröffentlicht, führen Pläne seine letzte Speicherung aus — es sei denn, Ihre Organisation
verlangt Prüfungen.

Das Veröffentlichungsfeld eines Tests zeigt, welche Version Pläne ausführen und ob es neuere
Änderungen gibt:

- **Version N veröffentlichen** lässt Pläne ab ihrem nächsten Lauf diese Version ausführen.
- **Hierauf zurücksetzen** im Verlauf lässt Pläne wieder eine frühere veröffentlichte Version
  ausführen.

Schaltet ein Eigentümer **Prüfung vor Veröffentlichung verlangen** ein (unter **Prüfungen**),
braucht das Veröffentlichen einer Version die Freigabe eines anderen berechtigten Mitglieds. Die
gemeinsame Seite **Prüfungen** umfasst alle drei Testarten:

1. Der Autor verwendet **Prüfung von Version N anfordern**, mit einer Notiz für den Prüfer.
2. Ein anderes Mitglied öffnet **Prüfungen**, liest die Änderung und wählt entweder **Genehmigen
   und veröffentlichen** oder **Ablehnen** mit einem Kommentar, was sich ändern muss. Niemand gibt
   seine eigene Änderung frei.
3. Solange nichts veröffentlicht ist, überspringen Pläne den Test. Auf eine Version
   zurückzusetzen, die vorher schon aktiv war, bleibt ohne Prüfung möglich.

Verlauf, Veröffentlichung und Prüfungen respektieren den Zugriff auf Organisation und
eingeschränkte Projekte. Bearbeiten nach der Veröffentlichung lässt Pläne auf der veröffentlichten
Revision. Ein direkter API-Testlauf oder ein mobiler Debug-Lauf verwendet die gespeicherte
Arbeitskopie; der mobile Lauf erfasst diese Konfiguration bei der Anforderung, sodass eine spätere
Änderung einen bereits angeforderten Lauf nicht ändern kann. Planergebnisse halten die ausgeführte
Revision fest.

## Suiten {#suites}

Eine **Suite** ist eine Liste von Tests, die einmal gepflegt und von so vielen Plänen eingebunden
wird, wie sie brauchen. **Suiten → Neue Suite** legt eine von zwei Arten an:

- **Statisch**: diese Tests, in der Reihenfolge, in der Sie sie wählen — Web-, API- und
  [Mobile-App](./mobile-apps)-Tests gleichermaßen.
- **Dynamisch**: jeder Test, der **alle** gewählten Tags trägt, jedes Mal ermittelt, wenn ein Lauf
  angelegt wird. Ein später getaggter Test ist im nächsten Lauf dabei, ohne dass etwas bearbeitet
  wird — Web-, API- und [Mobile-App](./mobile-apps#tags)-Tests gleichermaßen.

Eine Suite zeigt, welche Pläne sie einbinden. Wird eine von Plänen genutzte Suite gelöscht, führen
diese ihre Tests nicht mehr aus; bereits erfolgte Läufe behalten, was sie ausgeführt haben.

## Anforderungen und Abdeckung {#requirements}

**Anforderungen** beantwortet die Frage vor einem Release: Welche Stories sind getestet, welche
scheitern und welche haben gar keinen Test?

Eine Anforderung ist ein **Epic**, eine **User Story** oder eine einfache **Anforderung**, mit
einem Schlüssel (`SHOP-142`, `4711`, `REQ_12`), einem Titel und dem Epic, zu dem sie gehört. Legen
Sie eine mit **Neue Anforderung** an oder **Aus Tracker importieren** über ein bereits unter
**Einstellungen → Issue-Tracker** verbundenes Jira oder Azure DevOps:

- **Epics und Stories des Projekts** (Jira: Issue-Typen Epic und Story; Azure DevOps: Epic,
  Feature, User Story, Product Backlog Item, Requirement);
- **Diese Schlüssel**: `SHOP-142, SHOP-143` oder Work-Item-IDs;
- **Eine JQL-Abfrage** (Jira) oder **Eine WIQL-Abfrage** (Azure DevOps), etwa die Stories eines
  Releases.

Eine importierte Story bringt ihr Epic mit, und jede landet unter ihrem Elternelement. Erneutes
Importieren oder **Importierte synchronisieren** aktualisiert Titel, Typen und den Status des
Trackers; eine von Hand eingegebene Anforderung mit demselben Schlüssel wird zur importierten und
behält ihre Tests. In den Tracker wird nie etwas geschrieben. Höchstens 500 Einträge kommen auf
einmal.

**Tests** an einer Anforderung verknüpft die Web-, API- und [Mobile-App](./mobile-apps)-Tests, die
sie abdecken. Ein Epic zählt seine eigenen Tests und die jeder seiner Stories, jeden einmal. Seine
Abdeckung wird aus dem **letzten Ergebnis jedes Tests** ermittelt, alle Browser dieses Laufs
zusammen:

| Abdeckung            | Bedeutung                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Besteht**          | Jeder abdeckende Test hat bei seinem letzten Lauf bestanden.                                                             |
| **Schlägt fehl**     | Mindestens einer ist gescheitert (in einem beliebigen Browser).                                                          |
| **Nicht ausgeführt** | Keiner ist gescheitert, aber einige liefen nie, wurden übersprungen oder sind manuelle Tests, die auf ein Urteil warten. |
| **Keine Tests**      | Nichts deckt sie ab.                                                                                                     |

**Ergebnisse aus** schränkt ein, welche Läufe zählen: der letzte Lauf jedes Tests irgendwo oder der
letzte Lauf eines Plans — etwa des Release-Plans. **Abgedeckte Anforderungen** im Bericht eines
Laufs öffnet die Seite mit genau den Ergebnissen dieses Laufs. Die Zahlen über der Tabelle nennen
die Gesamtzahl, den Anteil mit mindestens einem Test und wie viele sich in jedem Zustand befinden.
Die Zahlen einer Zeile öffnen ihre Tests, jeden mit seinem letzten Ergebnis und einem Link zum
Bericht dieses Laufs.

**Matrix exportieren (CSV)** lädt die Rückverfolgbarkeitsmatrix für das Angezeigte herunter: eine
Zeile pro Anforderung und abdeckendem Test, mit letztem Ergebnis, Lauf und Plan, und eine Zeile für
jede Anforderung, die kein Test abdeckt.

Ein verknüpfter Test in einem Projekt, das Sie nicht sehen können, wird gezählt (_+1 in Projekten,
die Sie nicht sehen können_), aber nicht genannt, bleibt beim Zustand außen vor und bleibt
verknüpft, wenn Sie die anderen ändern. Betrachter lesen; Bearbeiter legen an, importieren,
verknüpfen und löschen. Das Löschen einer Anforderung entfernt ihre Verknüpfungen, nie die Tests;
was sie enthielt, rückt auf die oberste Ebene.

### Tests aus einer Story {#tests-from-a-story}

Die Funkel-Schaltfläche in der Zeile einer Anforderung schlägt Testfälle dafür vor, wenn der
Betreiber das KI-Modell eingerichtet hat. Sie liest die Story so, wie der Tracker sie **jetzt** hat
— ihre Beschreibung und ihre Akzeptanzkriterien (Jira: die Felder namens _Acceptance criteria_;
Azure DevOps: _Acceptance Criteria_) — oder bei einer hier eingegebenen Anforderung deren
Beschreibung. **Tests vorschlagen** fordert bis zur gewählten Anzahl an (standardmäßig 6, höchstens
12), in der Sprache der Oberfläche geschrieben: der Hauptweg, die Fehler, die ein Benutzer machen
kann, und die Grenzen, jeder mit dem abgedeckten Kriterium, seinen Vorbedingungen und seinen
Schritten (eine Aktion und das erwartete Ergebnis).

Nichts wird angelegt, bevor Sie es sagen. Jeder Fall kann umbenannt und korrigiert werden —
Schritte hinzugefügt, entfernt, umgeschrieben — und abgewählt; **Erstellen** macht die
ausgewählten zu **manuellen Tests**, mit der Anforderung verknüpft und den Vorbedingungen als
erstem Schritt. Sie laufen in Plänen wie jeder manuelle Test, und ihre Schritte sind Sätze, die
[das Beschreiben eines Tests in Sätzen](./web-tests#einen-test-in-satzen-beschreiben) später in einen
automatisierten Test verwandelt. Ein bereits vergebener Name lässt das Ganze ablehnen und wird rot
angezeigt; nichts wird halb angelegt. **Erneut vorschlagen** fordert neue Fälle an. Nur für
Bearbeiter; der Text der Story wird an das Modell gesendet (siehe
[AI features](/en/security/#ai-features), auf Englisch), und in den Tracker wird nichts
geschrieben.

## Testmanager

**Testmanager** ist für Teams, deren Testfälle in Excel liegen. **Excel hochladen** (.xlsx, bis
10 MB) importiert einen Fall pro Zeile, mit ID, Priorität und Ziel. Ordnen Sie jedem Fall einen
gespeicherten Test zu (**Sequenz wählen**), wählen Sie die Fälle aus und **Auswahl ausführen**;
Status und letzter Bericht jedes Falls werden daneben angezeigt.

### Testfälle aus dem QA-Hub {#testcase-hub}

Teams, deren Fälle im **QA-Testfall-Hub** liegen (ein Repository mit einer `definition.json` je
Fall unter `TestCasesDefinitions/<Modul>/<Id>/`), brauchen keine Arbeitsmappe: WebFlowMaster
liest den Hub selbst. Ein Bearbeiter verbindet ihn einmal je Organisation unter
**Einstellungen → QA-Testfall-Hub**, entweder als Ordner auf dem Server (ein Klon des
Repositorys unterhalb eines vom Betreiber mit `TESTCASE_HUB_ROOTS` erlaubten Ordners, siehe
[Configuration](/en/admin/configuration), auf Englisch) oder als Azure-DevOps-Repository
(Organisations-URL, Projekt, Repository, Branch und ein persönliches Zugriffstoken mit
_Code: read_, verschlüsselt gespeichert und nie wieder angezeigt). **Verbindung testen** prüft
die Quelle; **Katalog aktualisieren** liest alle Fälle in einen von WebFlowMaster gehaltenen
Katalog und sagt, wie viele neu, geändert oder nicht mehr im Hub sind. Noch wird nichts zum Test.

Der Reiter **QA-Testfall-Hub** des **Testmanagers** (auch `/test-manager?source=hub`) listet den
Katalog: Id, Modul, Priorität, Reifegrad, Ziel und wo jeder Fall gegenüber der Bibliothek steht
(nicht importiert, importiert, seit dem Import geändert, aus dem Hub verschwunden). Filtern Sie
nach Modul, Status, Priorität, Reifegrad oder Zustand, suchen Sie nach Id oder Ziel und öffnen
Sie einen Fall, um seine Schritte so zu lesen, wie der Hub sie enthält und wie der manuelle Test
sie hätte. Veraltete Fälle bleiben im Katalog, sind aber ausgeblendet, bis man sie anfordert;
ebenso aus dem Hub verschwundene Fälle, die nicht importiert werden können.

Wählen Sie die Fälle aus (bis zu 500 auf einmal) und **Auswahl importieren…**: jeder wird zu
einem **manuellen Test** namens `[FALL_ID] Ziel`, mit der Priorität des Hubs, der Vorbedingung
als erstem Schritt und den nummerierten Schritten samt erwartetem Ergebnis, im Projekt und in der
Suite Ihrer Wahl (eine bestehende statische Suite oder eine neue). Fälle mit Schritten für die
Referenzumgebung lassen sich mit dieser Variante importieren. Ein bereits importierter Fall wird
als neue Version aktualisiert, wenn der Hub ihn geändert hat, und sonst unverändert gelassen; ein
inzwischen automatisierter Test wird übersprungen, ebenso ein Name, den schon ein anderer Test
trägt. Die importierten Tests sind gewöhnliche manuelle Tests: führen Sie sie in Plänen aus oder
öffnen Sie einen im Baukasten und automatisieren Sie ihn. Betrachter sehen den Katalog, können
aber nicht importieren. Das Entfernen des Hubs löscht den Katalog; die importierten Tests bleiben
in der Bibliothek, nur nicht mehr mit ihm verknüpft.

## Gemeinsame Testdaten {#test-data}

Dieselben Kunden, Produkte oder Karten wurden früher von Test zu Test kopiert und liefen
auseinander. **Testdaten** bewahrt sie einmal für die ganze Organisation auf: Ein Satz hat einen
Namen (`customers`), eine Beschreibung und eine Tabelle. Betrachter können die Sätze lesen;
Bearbeiter legen sie an und ändern sie.

Die Verwaltung listet Namen, Beschreibungen und Zeilen-/Spaltenzahlen in Seiten zu 25, mit der
passenden Gesamtzahl und den Schaltflächen **Zurück**/**Weiter**. Suchen Sie nach dem wörtlichen
Namen, ohne Groß- und Kleinschreibung zu beachten. Öffnen Sie **Bearbeiten**, um Spalten und Zeilen
des gewählten Satzes zu laden; das Durchblättern der Liste lädt nicht jede Tabelle herunter.
Anlegen, Ändern oder Löschen eines Satzes aktualisiert die Liste.

Ein Satz wird auf zwei Arten verwendet:

- **Werte, in jedem Test.** <code v-pre>{{data.customers.email}}</code> ist die Spalte `email` der
  ersten Zeile von `customers`, in einem UI-Schritt, einer API-Anfrage oder einem mobilen Schritt,
  in Plänen wie im Testbaukasten. Umgebungswerte mit demselben Namen haben Vorrang, sodass eine
  Umgebung einen Wert überschreiben kann.
- **Zeilen, für einen UI-Test.** Im Dataset des Tests lässt **Gemeinsamen Datensatz verwenden** den
  Test einmal pro Zeile des Satzes laufen, mit seinen Spalten als <code v-pre>{{spalte}}</code> —
  siehe [Datasets](./web-tests#datasets).

Namen bestehen aus Kleinbuchstaben, Ziffern und Unterstrichen; Spalten aus Buchstaben, Ziffern und
Unterstrichen, damit ein Platzhalter sie nennen kann. Ein Satz fasst bis zu 1.000 Zeilen und 50
Spalten. Ein Satz, über den ein Test läuft, kann nicht gelöscht werden, solange dieser Test ihn
nutzt; die Ablehnung nennt die Tests. Anlegen, Ändern und Löschen eines Satzes werden im
Audit-Protokoll festgehalten.
