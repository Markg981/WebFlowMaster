# Tests ausführen

Tests laufen in **Testplänen**. Ein Plan legt fest, welche Tests in welchen Browsern laufen, wie
viele gleichzeitig, was von jedem Lauf aufbewahrt wird und wer benachrichtigt wird.

## Beim Einreihen festgelegte Daten

Für neu eingereihte Planläufe speichert der Ausführungs-Snapshot die Inline-Datasets der
ausgewählten Web-/BDD-Tests bzw. die expandierten Zeilen gemeinsamer Sätze sowie die
Erstzeilenwerte `{{data.<set>.<column>}}` der Organisation, die Web-, API- und mobile Tests
verwenden. Einen gemeinsamen Satz zu bearbeiten, umzubenennen oder zu löschen, während ein Lauf
wartet, ändert diese Eingaben nicht. Auch leere und fehlende Datasets werden festgelegt: Später
hinzugefügte Zeilen machen aus diesem wartenden Lauf keinen mehrzeiligen Lauf.

Das Dataset einer veröffentlichten Web-/BDD-Version hat Vorrang vor dem der Arbeitskopie. Ein
referenzierter Satz, der beim Einreihen nicht verfügbar ist, wird als Fehler dieses Tests
festgehalten; die Referenz danach zu reparieren, erfordert einen neuen Lauf. Anfragen mit demselben
Idempotenzschlüssel und automatische Wiederholungen verwenden den ursprünglichen Snapshot. Ein
neuer Lauf erfasst die aktuellen Daten.

Ältere Läufe ohne Dataset-Snapshot lösen die Daten weiterhin beim Start des Workers auf. Diese
Funktion friert Dateneingaben ein, nicht jede Testdefinition oder jedes externe System:
Umgebungs-Secrets, aus Antworten erfasste Variablen, erzeugte Werte, Geräte und Anwendungszustand
können sich weiterhin ändern. Umgebungszugangsdaten werden nicht kopiert. Dataset-Werte werden als
gewöhnliche Laufdaten in `configuration_snapshot.datasets` gespeichert; verwenden Sie
Umgebungs-Secrets für Zugangsdaten und wenden Sie Ihre Aufbewahrungs- und Zugriffsrichtlinie für
Läufe auf sensible Testdaten an. Jeder Worker muss die aktualisierte Version ausführen, bevor Sie
sich während eines schrittweisen Deployments auf dieses Verhalten verlassen.

## Einen Plan anlegen

![Die Seite der Testpläne](/screenshots/test-plans.webp)

**Testpläne → + Testplan** öffnet einen Assistenten in drei Schritten:

1. **Name** und Beschreibung.
2. **Maschinen und Suiten**. Jede Maschinenkonfiguration fügt einen Browser hinzu — Chrome, Edge,
   Firefox oder WebKit (die Engine von Safari), sichtbar oder headless, auf dem Desktop oder als
   Telefon oder Tablet ([Geräte](#mobile-devices)); Chrome und Edge müssen auf dem Runner
   installiert sein. **Suiten hinzufügen** wählt die Tests des Plans (Suche nach Name oder Tag). Die
   Felder Betriebssystem und Browserversion werden gespeichert, aber nicht angewendet: Tests laufen
   auf dem System des Runners, mit den dort installierten Browsern, und der Bericht sagt das.
   [Mobile-App-Tests](./mobile-apps#in-einem-testplan) können ebenfalls gewählt werden: Sie laufen
   einmal pro Lauf, auf dem Gerät und Grid, die sie nennen, unabhängig von den Browsern.
3. **Einstellungen**: Screenshots (standardmäßig bei fehlgeschlagenen Schritten, immer oder nie), ein
   **Video** jedes Laufs (nie, wenn der Test scheitert, oder immer), wie viele Tests **gleichzeitig
   laufen** dürfen, Zeitlimits, was zu tun ist, wenn ein Schritt oder eine Voraussetzung scheitert,
   wie oft ein fehlgeschlagener Test wiederholt wird, und Benachrichtigungen. Dieselben Optionen
   lassen sich später unter [Planeinstellungen](#planeinstellungen) ändern.

## Planeinstellungen

**Einstellungen** in der Zeile eines Plans ändert, wie sich sein nächster Lauf verhält:

| Einstellung                                   | Was sie bewirkt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Browser**                                   | Jeder Test läuft einmal pro aufgeführtem Browser, jeweils auf dem Desktop oder als Telefon oder Tablet ([Geräte](#mobile-devices)). Keiner aufgeführt: der Browser aus Ihren eigenen Einstellungen.                                                                                                                                                                                                                                                                                                     |
| **Sprachen**                                  | Sprachcodes wie `it-IT, en-US` (höchstens 10). Jeder Test läuft einmal pro Sprache in jedem Browser; siehe [In mehreren Sprachen testen](#languages). Leer: die eigene Sprache des Browsers.                                                                                                                                                                                                                                                                                                            |
| **Höchstens ausführen (Tests gleichzeitig)**  | 1 bis 16 Browser-Sitzungen gleichzeitig. 1 führt den Plan einen Test nach dem anderen aus, Browser für Browser.                                                                                                                                                                                                                                                                                                                                                                                         |
| **Worker pro Ausführung**                     | 1 bis 8 Runner für einen Lauf, jeder mit der obigen Zahl gleichzeitig; siehe [Ein Lauf auf mehreren Runnern](#shards). 1 hält den Lauf auf einem Runner.                                                                                                                                                                                                                                                                                                                                                |
| **Eine Aufzeichnung des Laufs behalten**      | Ein **Video** und ein Playwright-**Trace** jedes Tests — nie, wenn der Test scheitert, oder immer — und der **Netzwerk**verkehr als HAR-Datei. Sie beantworten, was ein Screenshot nicht kann, und belegen bei jedem Lauf Speicherplatz.                                                                                                                                                                                                                                                                |
| **Visuelle Tests**                            | Vergleicht den Screenshot jedes Schritts mit seiner Referenz; siehe [Visuelle Tests](./results#visual-testing).                                                                                                                                                                                                                                                                                                                                                                                         |
| **Ausführen auf**                             | Die Runner dieses Servers, ein Pool [lokaler Agenten](/en/integrations/local-agents) (auf Englisch) in Ihrem eigenen Netzwerk oder ein [Browser-Grid](#browser-grids).                                                                                                                                                                                                                                                                                                                                  |
| **Fehler ablegen in**                         | Ein Issue-Tracker (Jira, Azure DevOps), den ein Eigentümer verbunden hat. Mit **Ein Ticket öffnen, wenn ein Test fehlschlägt** erhält jeder fehlgeschlagene Test pro Browser ein Ticket; derselbe Fehler wird später als Kommentar hinzugefügt.                                                                                                                                                                                                                                                         |
| **Ergebnisse veröffentlichen in**             | TestRail, Xray oder Zephyr Scale, verbunden unter **Einstellungen → Testmanagement**: Jeder abgeschlossene Lauf wird dort Fall für Fall veröffentlicht; siehe [Veröffentlichen in TestRail, Xray oder Zephyr](./results#test-management).                                                                                                                                                                                                                                                               |
| **Benachrichtigen, wenn** und die Webhook-URL | Eine Nachricht an einen eingehenden Webhook von Slack oder Microsoft Teams oder an jede URL, die einen POST annimmt, wenn ein Lauf besteht, scheitert, nicht ausgeführt oder gestoppt wird. Slack- und Teams-Adressen erhalten ihr eigenes Kartenformat: das Urteil in Farbe, die Zahlen und eine Schaltfläche **Bericht öffnen**, wenn die Installation ihre öffentliche Adresse kennt. Die dort aufgeführten E-Mail-Adressen erhalten ebenfalls eine E-Mail, wenn die Installation E-Mails versendet. |

**Suiten** in der Zeile fügt [Suiten](./organizing#suites) hinzu: Sie laufen nach den eigenen Tests
des Plans, in der angehakten Reihenfolge, und ein Test in mehreren Suiten läuft nur einmal.

### Ein Lauf auf mehreren Runnern {#shards}

Ein langer Plan ist schneller fertig, wenn sich mehrere Runner ihn teilen. Steht **Worker pro
Ausführung** über 1, schreibt der Runner, der den Lauf übernimmt, seine Arbeit auf — ein Stück pro
Test in jedem Browser und jeder Sprache — und bittet die Warteschlange um Helfer. Jeder Runner, der
sich anschließt, der erste eingeschlossen, nimmt das nächste Stück, das niemand hält, führt es aus
und nimmt ein weiteres, sodass ein langsamer Test nie einen festen Stapel aufhält.

- Der Bericht ist ein einziger Lauf, wie immer: ein Satz Ergebnisse, ein Urteil, eine
  Benachrichtigung.
- Ein Plan, dessen API-Tests Werte für spätere Anfragen erfassen, hält diese zusammen: Jeder Browser
  und jede Sprache ist ein Stück, das der Reihe nach auf einem Runner läuft.
- Ein Runner, der stoppt, während er ein Stück hält (ein Absturz, eine verlorene Maschine), antwortet
  nicht mehr; nach zwei Minuten übernimmt ein anderer Runner dieses Stück und führt es aus.
- Eine Stopp-Richtlinie (zum Beispiel _Lauf stoppen_ bei einem Fehlschlag) stoppt jeden Runner:
  Noch nicht gestartete Tests werden mit Grund als übersprungen festgehalten.
- Helfer sind gewöhnliche Jobs in der Warteschlange: Sie nehmen freie Runner und helfen nur, wenn es
  welche gibt. Ohne freien Runner führt der erste jeden Test selbst aus, und das Protokoll sagt das.

### Browser-Grids {#browser-grids}

Die Runner haben Chromium, Firefox und WebKit auf dem System, auf dem sie installiert sind. Für
Windows und macOS, das Marken-Chrome und -Edge oder eine ältere Version kann ein Plan seine Browser
von einem **Browser-Grid** leihen, das unter **Einstellungen → Browser-Grids** hinzugefügt wird:

| Anbieter                                                                            | Benötigt                                                                                                                                              | Betriebssystem und Versionen                                                                |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **BrowserStack**                                                                    | Benutzername und Zugriffsschlüssel                                                                                                                    | Berücksichtigt                                                                              |
| **LambdaTest**                                                                      | Benutzername und Zugriffsschlüssel                                                                                                                    | Berücksichtigt                                                                              |
| **Playwright-Server** — Ihr eigenes `npx playwright run-server`, Browserless, Moon… | Seine `ws://`- oder `wss://`-Adresse und ein Token, falls er eines verlangt (enthält die Adresse `{token}`, kommt es dorthin, sonst als Bearer-Token) | Nicht berücksichtigt: Er führt die Browser aus, die er hat                                  |
| **Lokales Appium (Agent)**                                                          | Ein Pool lokaler Agenten und die Adresse von Appium                                                                                                   | Führt nur [Mobile-App-Tests](./mobile-apps#local-appium) aus, nicht die Browser eines Plans |

Der Schlüssel wird verschlüsselt gespeichert und nie wieder angezeigt. **Verbindung testen** öffnet
eine kurze Chromium-Sitzung auf dem Grid und sagt, ob es funktioniert hat. Ein Playwright-Server
muss dieselbe Playwright-Version ausführen wie die Runner.

Ist **Ausführen auf** auf ein Grid gesetzt, erhält jede Browserzeile des Plans außerdem ein
**Betriebssystem** (Windows oder macOS), seine **Version** (`11`, `Sonoma`) und eine
**Browserversion** (`latest`, wenn leer). Jede Zeile ist ein Durchgang des Laufs, und der Bericht
beschriftet ihn mit seiner Maschine — _chrome · Windows 11_, _chrome · macOS Sonoma_. Ohne
Betriebssystem läuft WebKit auf macOS und alles andere auf Windows 11. Safari auf einem Grid ist
weiterhin das WebKit von Playwright.

Jeder Test ist eine Sitzung im Dashboard des Anbieters, nach dem Test benannt, unter dem Lauf
gruppiert und als bestanden oder fehlgeschlagen markiert. Wird ein Grid gelöscht, kehren die Pläne,
die es nutzten, zu den Runnern des Servers zurück. Ein Plan läuft auf einem Grid oder auf lokalen
Agenten, nie auf beiden.

### Telefone und Tablets {#mobile-devices}

**Gerät** in einer Browserzeile der Planeinstellungen macht aus diesem Browser ein Telefon oder ein
Tablet: iPhone 15, iPhone 15 Pro Max, iPhone 14, iPhone SE, iPhone 13 Mini, Pixel 7, Pixel 5,
Galaxy S24, Galaxy A55, iPad Pro 11, iPad Mini, Galaxy Tab S9 (Tablets auch im Querformat). Die
Seite sieht dann dieses Gerät: seine Bildschirmgröße und Pixeldichte, Touch statt Maus
(`pointer: coarse`), das mobile Layout (`<meta name="viewport">` wird beachtet) und seinen User
Agent, sodass eine responsive Website die Menüs, Größen und Seiten zeigt, die sie auf diesem
Telefon zeigt. Jede Zeile ist ein eigener Durchgang: Chromium auf dem Desktop und Chromium als
Pixel 7 sind zwei Ergebnisse pro Test, und der Bericht sagt, welches welches ist
(`chromium · Pixel 7`).

Wählen Sie die Engine, auf der der eigene Browser des Geräts aufbaut — **WebKit** für ein iPhone
oder iPad, **Chromium** oder **Chrome** für Android —, um dem Ergebnis am nächsten zu kommen.
**Firefox** kann kein Gerät emulieren; die Auswahl wird dafür nicht angeboten. Geräte werden im
Plan-Assistenten oder in den Planeinstellungen gewählt und funktionieren auf den Runnern des
Servers, auf [lokalen Agenten](/en/integrations/local-agents) (auf Englisch) und auf einem
[Browser-Grid](#browser-grids), dessen Desktop-Browser dann das Gerät zeigt.

Das ist Emulation, kein echtes Telefon: Was vom Gerät selbst abhängt — das eigene Verhalten von
Safari unter iOS, die Bildschirmtastatur, die Geschwindigkeit des Telefons, native Apps —, braucht
echte Geräte, die mit dem Testen mobiler Apps kommen.

### In mehreren Sprachen testen {#languages}

Sind **Sprachen** gesetzt, ist jede Sprache ein eigener Lauf des Plans in jedem Browser: Zwei
Browser und drei Sprachen ergeben sechs Durchgänge. In jedem startet der Browser in dieser Sprache —
der `Accept-Language`-Header, den die Anwendung erhält, `navigator.language` und die Zahlen- und
Datumsformate der Seite —, und <code v-pre>{{locale}}</code> enthält den Code, für UI- und
API-Tests gleichermaßen.

Eine Prüfung, deren Text sich mit der Sprache ändert, gehört in ein **Wenn** auf
<code v-pre>{{locale}}</code> (siehe [bedingungen und Schleifen](./web-tests#conditions-and-loops)):

| Schritt             | Wert                                   |
| ------------------- | -------------------------------------- |
| Wenn (kein Element) | <code v-pre>{{locale}} == it-IT</code> |
| Text prüfen         | `Accedi`                               |
| Sonst               |                                        |
| Text prüfen         | `Sign in`                              |
| Ende wenn           |                                        |

Der Bericht beschriftet jedes Ergebnis mit Browser und Sprache (`chromium · it-IT`), und bei
visuellen Tests wird jede Sprache mit ihren eigenen Referenzen verglichen.

## Jetzt ausführen

**Ausführen** in der Zeile des Plans startet einen Lauf und öffnet seine Seite: den Fortschritt, den
Status jedes Tests und das Protokoll, während der Lauf es schreibt. **Detaillierten Bericht
anzeigen** öffnet den Bericht.

![Ein laufender Plan: jeder Test und Browser im Fortschritt](/screenshots/run-in-progress.webp)

Ein Lauf wartet in einer Warteschlange, wenn Ihre Organisation so viele Pläne ausführt, wie ihre
Grenze erlaubt, oder wenn kein Runner online ist: **Einstellungen → Ausführungsauslastung** sagt,
was davon zutrifft.

Um einen Lauf zu stoppen, **Lauf abbrechen** in seinem Bericht. Nicht gestartete Tests werden als
übersprungen gemeldet; ein laufender Test stoppt bei seinem nächsten Schritt.

### Fehlschläge wiederholen

Mit **Erneut ausführen bei Fehlschlag** wird ein fehlgeschlagener Test bis zu dreimal erneut
ausgeführt. Ein Test, der erst bei einem späteren Versuch besteht, wird im Bericht als **instabil**
markiert und zählt trotzdem als bestanden.

## Zeitplanung

![Die Planungsseite mit einem nächtlichen Plan](/screenshots/scheduling.webp)

**Planung → Zeitplan erstellen** führt einen Plan von selbst aus:

- **Häufigkeit**: einmal, alle 5, 15 oder 30 Minuten, alle 1, 6 oder 12 Stunden, täglich,
  wöchentlich, monatlich oder ein **Benutzerdefinierter CRON**-Ausdruck (Minute, Stunde, Tag des
  Monats, Monat, Wochentag).
- **Zeitzone**: Der Zeitplan läuft das ganze Jahr zu dieser Ortszeit, Sommerzeit eingeschlossen.
- **Umgebung**, deren Secrets der Lauf verwendet, und die **Browser**, in denen er läuft (headless:
  Niemand sieht zu).
- **Bei Fehler wiederholen**: den ganzen Plan ein- oder zweimal erneut ausführen, wenn er scheitert.
- **Zeitplan aktiv**: ihn ausschalten, ohne ihn zu löschen.

Das Dashboard listet die nächsten geplanten Läufe.

## Aus einer Pipeline

Ein Plan kann von Ihrem CI-System gestartet werden, und sein Ergebnis kann den Build scheitern
lassen: mit einem API-Schlüssel und der Kommandozeile `wfm` oder mit dem Webhook des Plans. Siehe
[CI integration](/en/integrations/ci) (auf Englisch).

### Nur ausführen, was eine Änderung betrifft {#impact}

Eine Pipeline, die bei jedem Commit den ganzen Plan ausführt, wartet auf Tests, die der Commit nicht
kaputt gemacht haben kann. **Einstellungen → Auswirkungskarte** sagt, welche Dateien welche Tests
betreffen: Jede Regel ordnet ein Dateimuster einem Ihrer [Tags](./organizing#die-testbibliothek) zu —
`src/checkout/**` → `checkout`. Eine Regel mit **kein Test** markiert Dateien, die nichts
betreffen, etwa `docs/**` oder `*.md`.

Starten Sie den Lauf mit den Dateien, die der Commit geändert hat —
`wfm run <plan> --changed-since origin/main` oder die Eingabe `changed-since` der GitHub Action —,
und er führt aus:

- die Tests mit einem Tag, auf das eine geänderte Datei verweist;
- die Tests, die die Karte nicht abdeckt (keines ihrer Tags kommt in einer Regel vor), da nichts
  sagt, dass die Änderung sie nicht kaputt machen kann;
- die Tests, die im letzten abgeschlossenen Lauf des Plans fehlgeschlagen oder mit Fehler beendet
  waren, damit der Lauf, der eine Korrektur zeigen soll, sie auch zeigt.

Im Zweifel führt er mehr aus: Eine geänderte Datei, auf die **keine Regel passt**, führt den ganzen
Plan aus, und ohne Regeln laufen alle Tests. Das Protokoll des Laufs, das Feld `selection` der API
und die CLI sagen, was entschieden wurde — zum Beispiel _3 changed file(s) affect the tags
checkout: 7 of 40 tests run_ —, sodass ein nicht ausgeführter Test eine Entscheidung ist, keine
Lücke. **An einer Änderung ausprobieren** im selben Einstellungsbereich zeigt, welche Tests eine
Dateiliste ausführen würde, ohne sie auszuführen.

Muster sind im Git-Stil: `**` ein beliebiger Pfad, `*` und `?` innerhalb eines Ordners, `{ts,tsx}`
eines von beiden; ein Muster ohne `/` nennt eine Datei irgendwo (`*.md`), und eines, das auf `/`
endet, einen ganzen Ordner.
