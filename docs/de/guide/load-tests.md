# Lasttests

Die [Leistungsprüfung](./api-tests#performance) eines API-Tests wiederholt eine Anfrage innerhalb
eines funktionalen Laufs: höchstens 200 Anfragen, 10 gleichzeitig, jedes Mal mit denselben Werten.
Sie beantwortet die Frage „Ist dieser Endpunkt langsamer geworden?“. Ein **Lasttest** beantwortet
eine andere Frage: Wie verhält sich das System, wenn viele Benutzer gleichzeitig einen Ablauf
durchlaufen, minutenlang, bei wachsender Last?

Öffnen Sie **Lasttests** in der Navigation. Ein Lasttest wiederholt API-Tests, die Sie bereits im
[API-Tester](./api-tests) gespeichert haben; er läuft nie als Teil eines Plans.

## Das Szenario

Ein Lasttest ist eine Folge gespeicherter API-Tests — anmelden, in den Warenkorb legen, bezahlen —,
die jeder **virtuelle Benutzer** der Reihe nach immer wieder ausführt. Ein Durchgang durch die Folge
ist eine **Iteration**.

- Was ein Test [erfasst](./api-tests#captures), senden die nächsten Tests derselben Iteration, wie
  in einem Plan: Das Token aus der Anmeldung geht in die Warenkorb-Anfrage.
- Ein Test scheitert, wenn seine Anfrage nicht gestellt werden kann oder eine seiner Assertions
  nicht erfüllt ist. Ein fehlgeschlagener Test beendet die Iteration — die nächsten Tests würden
  senden, was er nicht erfasst hat —, und der Benutzer beginnt die nächste.
- **Pause danach (ms)** wartet nach einem Test, wie eine Person, die die Seite liest. Bis zu 60 s.

Bis zu 20 API-Tests pro Szenario. Jeder Test wird mit eigener Methode, URL, Headern, Body,
Authentifizierung, Assertions und Erfassungen gesendet, genau wie in einem Plan.

## Das Lastprofil

Die Zahl der virtuellen Benutzer folgt **Stufen**. Jede Stufe bewegt sie linear von dort, wo die
vorige Stufe endete (0 am Anfang), zu ihrem Ziel an **virtuellen Benutzern**, über ihre **Dauer**:

| Stufe | Dauer | Virtuelle Benutzer | Was passiert                       |
| ----- | ----- | ------------------ | ---------------------------------- |
| 1     | 60 s  | 50                 | Anstieg von 0 auf 50               |
| 2     | 600 s | 50                 | 50 Benutzer 10 Minuten lang halten |
| 3     | 60 s  | 0                  | Abstieg auf 0                      |

Bis zu 10 Stufen; insgesamt 200 virtuelle Benutzer und 3.600 s, sofern die Installation nichts
anderes festlegt (`LOAD_MAX_VIRTUAL_USERS`, `LOAD_MAX_DURATION_S`:
[Konfiguration](/en/admin/configuration#load-tests), auf Englisch). Ein Test über der Grenze wird
unter Nennung der Grenze abgelehnt. Ein Benutzer über dem aktuellen Ziel hört am Ende seiner
Iteration auf, sodass ein Abstieg nie ein Szenario mittendrin abbricht. Der Editor zeichnet das
Profil, während Sie es ändern.

Die **Aufwärmphase** (in Sekunden) ist der Beginn des Laufs, der gesendet, aber nicht bewertet
wird: Caches, JIT-Compiler und Verbindungspools füllen sich dort. Ihre Anfragen werden getrennt
gezählt und auf der Zeitachse schattiert. Die Aufwärmphase muss vor dem Ende der letzten Stufe
enden.

## Daten pro virtuellem Benutzer

Ohne Datensatz sendet jeder virtuelle Benutzer dieselben Werte. Wählen Sie einen der
[Testdaten](./organizing#test-data)-Sätze der Organisation, und `{{data.<satz>.<spalte>}}` in den
API-Tests wird zur eigenen Zeile jedes Benutzers:

- **Eine eigene Zeile für jeden virtuellen Benutzer** — Benutzer 1 liest Zeile 1, Benutzer 2
  Zeile 2 und so weiter. Der Satz braucht mindestens so viele Zeilen wie virtuelle Benutzer in der
  Spitze, damit sich keine zwei Benutzer ein Konto teilen; einen Test mit weniger Zeilen zu
  speichern oder zu starten wird abgelehnt, mit der Angabe, wie viele fehlen.
- **Die nächste Zeile bei jeder Iteration** — jede Iteration, gleich welches Benutzers, nimmt die
  nächste Zeile und beginnt am Ende von vorn. Jede Zeilenzahl ist recht.

`{{load.vu}}` (1, 2, …) und `{{load.iteration}}` (1, 2, … pro Benutzer) sind immer verfügbar, etwa
um eine Bestellreferenz eindeutig zu machen: `order-{{load.vu}}-{{load.iteration}}`.

## Schwellenwerte und Urteil

Jeder Schwellenwert ist optional und wird an den nach der Aufwärmphase gesendeten Anfragen
gemessen:

- **Median (p50)**, **95. Perzentil (p95)**, **99. Perzentil (p99)** und **Langsamste**, in ms;
- **Fehlgeschlagene Anfragen**, in Prozent;
- **Mindestdurchsatz**, in Anfragen pro Sekunde über die bewertete Zeit.

Ein Lauf **besteht**, wenn er das Ende innerhalb aller Schwellenwerte erreicht, und **scheitert**
unter Nennung jedes überschrittenen Schwellenwerts („p95 412 ms > 300 ms“, „Durchsatz 38 req/s <
50 req/s“). Ein Lauf, der keine Anfrage bewertet hat, scheitert ebenfalls. **Abgebrochen** heißt,
jemand hat ihn gestoppt, wartend oder laufend; **Nicht ausführbar** heißt, er ist nie angelaufen —
ein API-Test oder der Datensatz wurde gelöscht, der Datensatz hat zu wenige Zeilen, das Profil
überschreitet die Grenzen der Installation; **Worker verloren** heißt, der ausführende Worker
antwortet nicht mehr (ein Absturz, ein Redeploy, der nicht gewartet hat): Seine Zusammenfassung
bis dahin bleibt erhalten, und der Lauf wurde nicht beendet.

## Einen Lauf starten und verfolgen

Öffnen Sie die **Ausführungen** eines Lasttests, wählen Sie eine Umgebung (ihre Variablen und
Secrets lösen die `{{placeholders}}` wie in einem Plan auf) und **Lauf starten**. Der Lauf ist
**In der Warteschlange**, bis ein Last-Worker ihn übernimmt — sofort, wenn einer frei ist —, und
von da an **Läuft**. Die Seite verfolgt ihn alle 2 Sekunden:

- Fortschritt, virtuelle Benutzer jetzt und in der Spitze;
- die Zeitachse: virtuelle Benutzer, Anfragen pro Sekunde und p95 über die Zeit, mit schattierter
  Aufwärmphase;
- für jeden API-Test und für alle Anfragen: Anfragen, Fehler, p50, p90, p95, p99 und langsamste;
- abgeschlossene und fehlgeschlagene Iterationen und die ersten unterschiedlichen Fehler.

**Lauf stoppen** beendet einen wartenden Lauf sofort und einen laufenden innerhalb von 2 Sekunden;
bereits gesendete Anfragen werden abgeschlossen. Jeder Lasttest behält seine letzten 10 Läufe auf
der Seite, mit Zusammenfassung und Urteil.

### Wo ein Lauf läuft

Ein Lastlauf ist ein Job in einer eigenen Warteschlange, ausgeführt von **einem der Worker der
Installation**, getrennt von Plänen, Runnern und Agenten: Er belegt keinen Runner-Slot, ein Plan
bremst ihn nicht, und er übersteht einen Neustart des Webservers — ein laufender Lauf läuft weiter,
ein wartender wartet weiter. Da die Last aus dem Netzwerk des Workers kommt, testen Sie von dort,
wo die Worker das zu testende System erreichen.

- Ein Lastlauf gleichzeitig pro Organisation, wartend oder laufend: Zwei würden sich gegenseitig
  messen. Die Installation kann mehr erlauben (`LOAD_MAX_RUNS_PER_ORGANIZATION`); jenseits der
  Grenze wird ein Start abgelehnt, mit Hinweis darauf.
- Ein Worker führt einen Lastlauf gleichzeitig aus, sofern nicht anders konfiguriert
  (`LOAD_WORKER_CONCURRENCY`); sind alle Worker beschäftigt, wartet ein Lauf als **In der
  Warteschlange** und startet, sobald einer frei ist. Der
  [Administrator](/en/admin/load-testing#sizing-a-load-worker) (Seite auf Englisch) dimensioniert
  und skaliert die Worker.
- Ein Lauf wird von einem einzigen Worker vollständig ausgeführt: Seine virtuellen Benutzer werden
  nicht auf Worker verteilt. Über das hinaus, was ein Worker senden kann, führt der Weg zu mehr
  Last über mehr Worker mit mehr Läufen — mehrerer Organisationen oder einer Organisation mit
  angehobener Grenze.
- Ein Lauf zählt zu den [Ausführungsminuten](/en/admin/administration#quotas) (auf Englisch) der
  Organisation, wie ein API-Test.
- Fällt der ausführende Worker aus, endet der Lauf etwa zwei Minuten später als **Worker
  verloren**, und die Organisation kann einen weiteren starten.

Perzentile stammen aus einer gleichmäßigen Stichprobe von höchstens 10.000 Dauern pro Test und
sind darüber also Schätzungen; Anzahlen, Fehler, Minimum, Mittelwert und Maximum sind exakt. Die
Zeitachse hat höchstens 240 Punkte.

## Berechtigungen

Betrachter sehen Lasttests und ihre Läufe. Bearbeiter erstellen, ändern, starten, stoppen und
löschen sie. Ein Lasttest in einem eingeschränkten Projekt gehört dem Projekt, wie seine API-Tests.
