# Webtests

Ein Webtest ist eine **Folge von Schritten**, die ein Browser in Ihrer Anwendung ausführt: eine
Seite aufrufen, in ein Feld schreiben, klicken, prüfen, was erscheint. Sie bauen ihn unter **Test
erstellen**.

## Die Anwendung laden

1. Geben Sie die Adresse in **URL der zu testenden Website** ein und klicken Sie auf **Website
   laden**. Die Seite wird von einem echten Browser auf dem Server geöffnet, und unter **Vorschau
   der Website** erscheint ein Screenshot.
2. Klicken Sie auf **Elemente erkennen**. Die Liste **Erkannte Elemente** zeigt, was auf der Seite
   angeklickt, ausgefüllt oder geprüft werden kann — Schaltflächen, Felder, Links, Auswahllisten —,
   jeweils mit dem Selektor, mit dem der Test es finden wird.

![Test erstellen mit geladener Seite: verfügbare Aktionen, Vorschau der Website und erkannte Elemente](/screenshots/builder-detected.webp)

Erkannt wird nur, was beim Laden der Seite sichtbar ist. Für ein Element, das später erscheint (ein
Menü, das sich öffnet, eine zweite Seite), fügen Sie die Schritte hinzu, die dorthin führen, führen
Sie sie aus und erkennen Sie erneut.

## Die Sequenz bauen

Ziehen Sie eine Aktion aus **Verfügbare Aktionen** in die **Testsequenz** und legen Sie dann ein
erkanntes Element darauf ab (oder verwenden Sie **Element festlegen**). Füllen Sie den Wert aus,
den die Aktion braucht: den einzugebenden Text, die zu wählende Option, den erwarteten Text.

![Schritte in der Testsequenz unter der Vorschau](/screenshots/builder-sequence.webp)

| Aktion                                                        | Was sie bewirkt                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Navigieren**                                                | Ruft eine Adresse auf.                                                                                                                                                                                                             |
| **Element anklicken**                                         | Klickt.                                                                                                                                                                                                                            |
| **Text eingeben**                                             | Schreibt in ein Feld.                                                                                                                                                                                                              |
| **Option wählen**                                             | Wählt eine Option einer nativen Auswahlliste.                                                                                                                                                                                      |
| **Aus Liste Wählen**                                          | Öffnet eine benutzerdefinierte Auswahlliste und wählt eine Option nach ihrem Text.                                                                                                                                                 |
| **Überfahren**                                                | Bewegt die Maus über ein Element (für Menüs, die sich beim Überfahren öffnen).                                                                                                                                                     |
| **Scrollen**                                                  | Scrollt die Seite oder ein Element.                                                                                                                                                                                                |
| **Zustand herstellen**                                        | Schaltet ein Kontrollkästchen oder einen Schalter ein oder aus, nur wenn er es nicht schon ist.                                                                                                                                    |
| **Warten**                                                    | Wartet eine feste Zahl von Millisekunden. Bevorzugen Sie die folgenden Wartearten.                                                                                                                                                 |
| **Auf Element Warten**                                        | Wartet, bis ein Element sichtbar oder ausgeblendet ist.                                                                                                                                                                            |
| **Auf Text Warten**                                           | Wartet, bis ein Element einen Text enthält.                                                                                                                                                                                        |
| **Auf Netzwerk Warten**                                       | Wartet, bis die Anfragen der Seite abgeschlossen sind.                                                                                                                                                                             |
| **Sichtbarkeit prüfen**                                       | Scheitert, wenn das Element nicht sichtbar ist.                                                                                                                                                                                    |
| **Text prüfen**                                               | Scheitert, wenn das Element den Text nicht enthält.                                                                                                                                                                                |
| **Anzahl der Elemente prüfen**                                | Scheitert, wenn die Zahl passender Elemente nicht stimmt, z. B. `==1`, `>=5`, `<3`.                                                                                                                                                |
| **Zustand prüfen**                                            | Scheitert, wenn ein Steuerelement nicht angehakt, aktiviert, bearbeitbar ist — oder das Gegenteil.                                                                                                                                 |
| **Barrierefreiheit prüfen**                                   | Prüft die Seite an dieser Stelle mit axe-core und scheitert bei Verstößen ab dem gewählten Schweregrad (standardmäßig serious).                                                                                                    |
| **Standort setzen**                                           | Ab dann meldet der Browser der Seite diese Position — siehe [Standort und Downloads](#location-and-downloads).                                                                                                                     |
| **Download prüfen**                                           | Klickt auf das Element und prüft die Datei, die es herunterlädt — siehe [Standort und Downloads](#location-and-downloads).                                                                                                         |
| **Seitengeschwindigkeit messen**                              | Prüft die Core Web Vitals und Zeiten, die der Browser für die Seite gemessen hat, gegen Grenzen — siehe [Seitengeschwindigkeit](#page-speed).                                                                                      |
| **Lighthouse-Audit**                                          | Führt Lighthouse auf der aktuellen Seite aus und prüft seine Werte — siehe [Seitengeschwindigkeit](#page-speed).                                                                                                                   |
| **Taste drücken**                                             | Drückt eine Taste oder Kombination — `Enter`, `Tab`, `Escape`, `Control+A` — auf dem Element oder auf dem, was den Fokus hat, wenn der Schritt keines hat.                                                                         |
| **Doppelklick** / **Rechtsklick**                             | Doppelklickt oder öffnet das Kontextmenü des Elements.                                                                                                                                                                             |
| **Ziehen und ablegen**                                        | Zieht das Element auf das, dessen Selektor der Wert ist.                                                                                                                                                                           |
| **Datei hochladen**                                           | Gibt einem Dateifeld — oder der Schaltfläche, die die Dateiauswahl öffnet — eine aus dem Wert erzeugte Datei: `invoice.csv` oder `invoice.csv\|ihr Inhalt`.                                                                        |
| **Dialog beantworten**                                        | Legt fest, wie der nächste `alert`, `confirm` oder `prompt` beantwortet wird: `accept`, `dismiss` oder `accept:text`. Setzen Sie ihn **vor** den Schritt, der den Dialog öffnet. Ein unbeantworteter Dialog wird verworfen.        |
| **Tab wechseln**                                              | Fährt in einem anderen Tab fort: leer für den neuesten, eine Nummer (ab 1) oder ein Text aus seiner Adresse oder seinem Titel.                                                                                                     |
| **Tab schließen**                                             | Schließt den aktuellen Tab und kehrt zu dem zurück, der ihn geöffnet hat.                                                                                                                                                          |
| **Text in Variable speichern**                                | Liest den Text des Elements oder den Wert eines Felds in die Variable, die der Wert nennt, für spätere Schritte.                                                                                                                   |
| **Variable setzen**                                           | `name=wert`, für spätere Schritte. Siehe [erzeugte Werte](#generated-values).                                                                                                                                                      |
| **Auf E-Mail warten**                                         | Wartet auf die an eine Adresse gesendete E-Mail und liest ihren Code und Link in Variablen. Siehe [E-Mails](#emails).                                                                                                              |
| **Auf SMS warten**                                            | Wartet auf die an eine Testnummer gesendete SMS und liest ihren Code in eine Variable. Siehe [SMS](#sms).                                                                                                                          |
| **Datenbankabfrage**                                          | Führt eine SQL-Anweisung gegen die Datenbank der Umgebung aus und liest die erste Zeile in Variablen. Siehe [Datenbank](#database).                                                                                                |
| **Werte prüfen**                                              | Scheitert, wenn ein Vergleich nicht zutrifft: <code v-pre>{{db.value}} == 1</code>, <code v-pre>{{total}} > 0</code>, <code v-pre>{{email.subject}} contains Welcome</code>. Dieselben Vergleiche wie eine Bedingung ohne Element. |
| **Cookie setzen** / **Cookies löschen**                       | `name=wert` für die aktuelle Adresse; oder löscht alle.                                                                                                                                                                            |
| **localStorage setzen**                                       | `schlüssel=wert` im Speicher der aktuellen Seite.                                                                                                                                                                                  |
| **JavaScript ausführen**                                      | Führt den Wert in der Seite aus. Scheitert, wenn er einen Fehler wirft oder `false` zurückgibt, und kann so prüfen, was kein anderer Schritt kann.                                                                                 |
| **Anfrage simulieren**                                        | Beantwortet ab dann die Anfragen der Seite an eine Adresse statt des Servers — siehe [Das Netzwerk simulieren](#mocking-the-network).                                                                                              |
| **Anfragen blockieren**                                       | Ab dann scheitern die Anfragen der Seite an eine Adresse, als wäre das Netzwerk ausgefallen.                                                                                                                                       |
| **Simulationen entfernen**                                    | Nimmt jede Simulation und Blockierung zurück: Die Seite erreicht wieder die echten Server.                                                                                                                                         |
| **Wenn** / **Sonst** / **Ende wenn**                          | Führt Schritte nur aus, wenn eine Bedingung zutrifft. Siehe [bedingungen und Schleifen](#conditions-and-loops).                                                                                                                    |
| **Wiederholen** / **Wiederholen solange** / **Ende Schleife** | Führt Schritte eine Anzahl von Malen aus oder solange eine Bedingung zutrifft.                                                                                                                                                     |

Jede Aktion wartet bereits, bis ihr Element bereit ist, bevor sie handelt, daher ist ein festes
**Warten** selten nötig; scheitert ein Schritt, weil etwas langsam war, warten Sie auf genau das.

Ändern Sie Aktion oder Element eines Schritts am Schritt, entfernen Sie ihn mit seinem Papierkorb,
und **Leeren**, um neu anzufangen.

Ein aufgezeichnetes **Enter** wird als Schritt **Taste drücken** nach dem Wert des Felds
wiedergegeben, in dem es gedrückt wurde, sodass eine mit Enter abgeschickte Suche bei der
Wiedergabe erneut abgeschickt wird.

## Bedingungen und Schleifen {#conditions-and-loops}

**Wenn**, **Sonst** und **Ende wenn** sind Schritte wie alle anderen, um die Schritte herum
platziert, die sie steuern; ebenso **Wiederholen** oder **Wiederholen solange** und **Ende
Schleife**. Der Testbaukasten rückt ein, was in einem Block steht, und listet die Blöcke, die nicht
geschlossen sind; ein Test mit einem solchen Block scheitert, bevor ein Browser geöffnet wird, unter
Nennung des Schritts.

Eine Bedingung hat eine von zwei Formen:

- **Mit einem Element**: der Zustand, in dem es _jetzt_ ist — `visible`, `hidden`, `exists`,
  `missing`, `checked`, `unchecked`, `enabled`, `disabled` oder `contains:text` /
  `not contains:text`. Die Antwort kommt sofort: „Wenn das Cookie-Banner sichtbar ist, schließe es“
  geht sofort weiter, wenn es kein Banner gibt. Für etwas, das noch lädt, setzen Sie einen
  Warteschritt vor die Bedingung.
- **Ohne Element**: ein Vergleich von Werten — <code v-pre>{{status}} == Paid</code>,
  <code v-pre>{{count}} > 3</code>, <code v-pre>{{title}} contains Order</code>, mit `==`, `!=`,
  `>`, `<`, `>=`, `<=`, `contains`, `not contains` — oder eine Variable, die `true` oder `false`
  enthält.

**Wiederholen** nimmt eine Anzahl; darin zählt <code v-pre>{{loopIndex}}</code> ab 1.
**Wiederholen solange** prüft seine Bedingung vor jedem Durchgang. Eine Schleife stoppt den Test
nach 200 Durchgängen, damit eine Bedingung, die nie falsch wird, keinen Worker für immer belegt.
Bei visuellen Tests wird jeder Durchgang einer Schleife mit seiner eigenen Referenz verglichen.

## Ausprobieren

**Test ausführen** führt die Sequenz in einem Browser auf dem Server aus und spielt das Ergebnis
Schritt für Schritt in der Vorschau ab, mit einem Screenshot zu jedem Schritt. Ein
fehlgeschlagener Schritt sagt warum. Durch das Ausführen wird nichts gespeichert.

![Ein im Testbaukasten ausgeführter Test, alle Schritte bestanden](/screenshots/builder-passed.webp)

## Debuggen {#debugging}

**Debuggen** führt die Sequenz so aus, dass sie anhalten, korrigiert werden und weiterlaufen kann,
während der Browser noch offen ist:

- **Haltepunkte**: Klicken Sie auf den Punkt eines Schritts, um ihn rot zu machen. Der Lauf hält vor
  diesem Schritt an. Ein Haltepunkt auf einem Schrittgruppen-Aufruf hält beim ersten Schritt der
  Gruppe. Haltepunkte lassen sich setzen und entfernen, während eine Sitzung läuft.
- **Wo ein Schritt scheitert**, endet der Lauf nicht: Er hält dort an, mit dem Fehler.

Wenn er anhält, zeigt das Feld **Debugger**, warum, die Seite in diesem Moment und ihre Adresse,
die bisher ausgeführten Schritte und die Variablen (Werte aus der Umgebung sind Secrets: Nur ihre
Namen werden gezeigt). Der Schritt, an dem er angehalten hat, hat auf der Arbeitsfläche einen
farbigen Rahmen. Von dort aus:

| Befehl               | Bewirkt                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| **Fortsetzen**       | Läuft bis zum nächsten Haltepunkt, Fehlschlag oder Ende.                                    |
| **Schritt**          | Führt diesen Schritt aus und hält vor dem nächsten.                                         |
| **Erneut versuchen** | Nach einem Fehlschlag: führt den Schritt erneut aus, mit der Korrektur, falls es eine gibt. |
| **Überspringen**     | Überspringt diesen Schritt. Nicht angeboten für Wenn, Sonst, Schleifen und ihre Enden.      |
| **Stoppen**          | Beendet den Lauf und schließt den Browser.                                                  |
| **Pause**            | Während des Laufs: hält vor dem nächsten Schritt.                                           |

**Selektor** und **Wert** des Schritts lassen sich vor dem Fortsetzen, schrittweisen Ausführen
oder erneuten Versuchen korrigieren. Eine Korrektur an einem der eigenen Schritte des Tests wird
auch in die Arbeitsfläche übernommen; **speichern** Sie den Test, um sie zu behalten. Eine Korrektur
an einem Schritt innerhalb einer Schrittgruppe gilt nur für diesen Lauf.

Ein Lauf, der einen Schritt übersprungen hat, wird nie als bestanden gemeldet. Ein datengetriebener
Test wird mit einer Zeile seines Datasets gedebuggt, die neben **Debuggen** gewählt wird (die erste,
sofern Sie keine andere wählen). Eine 15 Minuten lang pausierte Sitzung schließt ihren Browser.
Jede Person hat jeweils eine Sitzung: Eine weitere zu starten, stoppt die erste.

## Aufzeichnen

Mit **Modus zur Testerstellung → Benutzeraktionen aufzeichnen** öffnet **Aufzeichnung starten** ein
Browserfenster, in dem Sie die Anwendung wie gewohnt bedienen; jeder Klick und jede Eingabe wird zu
einem Schritt. Verwenden Sie **Add assert** in der Werkzeugleiste des Rekorders, um ein erwartetes
Ergebnis aufzuzeichnen. **Aufzeichnung beenden** setzt die Schritte in die Sequenz und ersetzt, was
dort stand.

::: warning Der Rekorder öffnet sich auf dem Rechner des Servers
Das Aufzeichnungsfenster ist ein echter Browser auf dem Rechner, auf dem WebFlowMaster läuft, kein
Tab in Ihrem Browser. Es funktioniert, wenn der Server auf Ihrem eigenen Computer läuft; auf einem
geteilten Server ohne Bildschirm ist Aufzeichnen nicht verfügbar, und Sie bauen Tests, indem Sie
Schritte ziehen oder sie beschreiben.
:::

Beim Aufzeichnen eingegebene Passwörter werden nicht im Test gespeichert: Sie werden zu
Platzhaltern <code v-pre>{{secret&#95;…}}</code>, die Sie als Secrets einer Umgebung anlegen.

## Einen Test in Sätzen beschreiben

![Der Dialog Beschreiben mit einem in Sätzen geschriebenen Test](/screenshots/builder-describe.webp)

**Beschreiben** macht aus einfachen Anweisungen Schritte, eine pro Zeile, mit den Worten eines
Tickets:

```text
Go to https://example.com/login
Type "admin" into the Username field
Click the Sign in button
Check that the dashboard is visible
```

**Beschreibung lesen** zeigt jede Zeile als den Schritt, zu dem sie wurde, bevor etwas eingefügt
wird, sodass ein falsch verstandener Satz auffällt, bevor er zu einem Test wird, der aus dem
falschen Grund besteht. Elemente werden mit den erkannten Elementen abgeglichen und, wenn Sie eines
wählen, mit dem Element-Repository eines Projekts. Gängige Formulierungen werden ohne KI verstanden;
hat die Installation einen KI-Schlüssel, liest das Modell auch den Rest (Zeilen mit **KI**
markiert). Ohne KI gehören dazu Tasten (`Press Enter in the Password field`), `Double-click …` /
`Right-click …`, `Upload invoice.pdf to the Attachment field`, `Accept the dialog` /
`Accept the prompt with "42"`, Tabs, Cookies und `Save the text of … as orderNumber`.

## Variablen und Umgebungen {#variables-and-environments}

Jeder Wert in einem Schritt kann Platzhalter <code v-pre>{{name}}</code> enthalten, die beim
Ausführen des Tests gefüllt werden:

- aus der **Umgebung**, die im Testbaukasten, im Planlauf oder im Zeitplan gewählt ist: ihre
  Secrets (**Einstellungen → Umgebungen**), zum Beispiel <code v-pre>{{ADMIN&#95;PASSWORD}}</code>.
  Ein Secret namens `baseUrl` setzt <code v-pre>{{baseUrl}}</code>, sodass ein Test in jeder
  Umgebung bei <code v-pre>{{baseUrl}}/login</code> beginnen kann;
- aus einer **Dataset**-Zeile (siehe unten);
- <code v-pre>{{locale}}</code>, die Sprache, in der ein Plan den Test ausführt (siehe
  [In mehreren Sprachen testen](./running#languages));
- aus Werten, die ein API-Test früher im selben Lauf erfasst hat.

- aus Schritten **Text in Variable speichern** und **Variable setzen** früher im selben Test. Diese
  Werte gehören nur zu diesem Lauf.

Ein Platzhalter, den nichts definiert, wird nicht geleert: Der Schritt scheitert und nennt die
fehlende Variable.

### Erzeugte Werte {#generated-values}

Ein Platzhalter, der mit `$` beginnt, erfindet bei jeder Verwendung einen Wert, überall, wo
Variablen akzeptiert werden — in einem Schritt, einer URL, einem API-Test:

| Platzhalter                                                      | Wert                                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| <code v-pre>{{$randomEmail}}</code>                              | `test.k3v9…@example.com` (eine Domäne, die nirgends zustellt)                                                                        |
| <code v-pre>{{$uuid}}</code>                                     | Eine zufällige UUID                                                                                                                  |
| <code v-pre>{{$randomInt(1,100)}}</code>                         | Eine ganze Zahl zwischen den beiden, einschließlich (standardmäßig 0–1000)                                                           |
| <code v-pre>{{$randomString(8)}}</code>                          | Buchstaben und Ziffern                                                                                                               |
| <code v-pre>{{$randomDigits(6)}}</code>                          | Nur Ziffern                                                                                                                          |
| <code v-pre>{{$today}}</code>, <code v-pre>{{$today(+7)}}</code> | Ein Datum, `yyyy-mm-dd`, heute oder so viele Tage entfernt                                                                           |
| <code v-pre>{{$now}}</code>, <code v-pre>{{$timestamp}}</code>   | Die aktuelle Zeit, in ISO oder in Millisekunden                                                                                      |
| <code v-pre>{{$totp(secret&#95;mfa)}}</code>                     | Der Code, den eine Authenticator-App jetzt für den Seed in der genannten Variablen zeigt; siehe [Anmeldung in zwei Schritten](#totp) |

Jeder Platzhalter ist ein neuer Wert. Um einen zweimal zu verwenden — mit einer Adresse
registrieren, dann damit anmelden —, geben Sie ihm zuerst einen Namen: **Variable setzen**
<code v-pre>email={{$randomEmail}}</code>, dann <code v-pre>{{email}}</code>. Ein falsch
geschriebener Generator lässt den Schritt scheitern wie eine fehlende Variable.

Secret-Werte werden verschlüsselt, nach dem Speichern nie wieder angezeigt und in Protokollen
maskiert.

### Anmeldung in zwei Schritten mit einer Authenticator-App {#totp}

Fragt die Anwendung nach dem sechsstelligen Code einer Authenticator-App (Google Authenticator,
Microsoft Authenticator…), gibt <code v-pre>{{$totp(name)}}</code> den Code ein, den die App in
diesem Moment zeigen würde. Registrieren Sie das Testkonto einmal und bewahren Sie das, was die
Anwendung gezeigt hat, als Secret der Umgebung auf, etwa `secret_mfa`: den unter dem QR-Code
geschriebenen Schlüssel (`JBSW Y3DP EHPK 3PXP`, Leerzeichen und Groß-/Kleinschreibung spielen keine
Rolle) oder die Adresse im QR-Code (`otpauth://totp/…?secret=…`), die auch Stellenzahl, Periode und
Algorithmus enthält, wenn sie nicht die üblichen 6, 30 Sekunden und SHA-1 sind. Dann der Schritt
**Text eingeben** <code v-pre>{{$totp(secret&#95;mfa)}}</code> im Codefeld.

Das Argument ist der **Name** der Variablen, nie der Schlüssel selbst, sodass der Schlüssel
verschlüsselt und aus dem Test heraus bleibt. Ein Name, den die Umgebung nicht definiert, oder ein
Wert, der kein Schlüssel ist, lässt den Schritt scheitern und nennt ihn. Der Code wird aus der Uhr
des Runners berechnet, die auf wenige Sekunden genau gehen muss.

### Angemeldet starten

Um die Anmeldung in jedem Test zu überspringen: Wählen Sie die Umgebung im Testbaukasten, starten
Sie eine Aufzeichnung, melden Sie sich im Aufzeichnungsfenster an und klicken Sie auf **Save login
for this environment**. Läufe gegen diese Umgebung starten dann mit dieser Sitzung; die Umgebung
erscheint in der Auswahl als _mit gespeicherter Anmeldung_. Speichern Sie erneut, wenn die Sitzung
abläuft.

### E-Mails: Codes und Links {#emails}

Registrierung, Zurücksetzen des Passworts und Anmeldung in zwei Schritten senden eine E-Mail, die
der Test lesen muss. Der Schritt **Auf E-Mail warten** liest sie aus dem **Test-Postfach** der
Umgebung, einem [Mailpit](https://mailpit.axllent.org): ein Mail-Fänger, der alles annimmt, was die
Anwendung an seinen SMTP-Port sendet, für jede Adresse. Richten Sie den SMTP der Anwendung in der
Testumgebung darauf (Port 1025), und jede Adresse hat ein Postfach, auch erfundene.

Eine Registrierung von Anfang bis Ende:

| Aktion            | Wert                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Variable setzen   | <code v-pre>email={{$randomEmail}}</code>                                                               |
| Text eingeben     | <code v-pre>{{email}}</code> im Adressfeld, dann das Formular abschicken                                |
| Auf E-Mail warten | <code v-pre>{{email}}\|Confirm your account</code>                                                      |
| Text eingeben     | <code v-pre>{{email.otp}}</code> im Codefeld — oder **Navigieren** zu <code v-pre>{{email.link}}</code> |

Der Wert ist die Adresse, optional gefolgt von `|` und einem Text, den der Betreff enthält, und
einem zweiten `|` mit einem regulären Ausdruck für den Code:
<code v-pre>{{email}}|Your code|code: (&#91;A-Z0-9-]+)</code> liest, was seine erste Gruppe
erfasst. Der Schritt wartet bis zu 60 Sekunden auf die neueste E-Mail an genau diese Adresse (in
To, Cc oder Bcc), die **nach dem Start des Tests** angekommen ist, sodass eine feste Adresse wie die
eines vorab angelegten Benutzers nicht die E-Mail des vorigen Laufs liest. Dann setzt er:

| Variable                                                                                                   | Enthält                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <code v-pre>{{email.otp}}</code>                                                                           | Den Code: die erste 4- bis 8-stellige Zahl nach einem Wort wie _code_, _OTP_, _PIN_ oder _verification_ oder die einzige in der E-Mail; mit Muster das, was es gefunden hat |
| <code v-pre>{{email.link}}</code>                                                                          | Den ersten zu folgenden Link, ohne Abmeldelinks, Bilder und Stylesheets                                                                                                     |
| <code v-pre>{{email.subject}}</code>, <code v-pre>{{email.from}}</code>, <code v-pre>{{email.text}}</code> | Den Betreff, die Absenderadresse und den Text (eine reine HTML-E-Mail wird in Text umgewandelt)                                                                             |

Eine Variable, die die E-Mail nicht geliefert hat — kein Code, kein Link —, bleibt undefiniert,
sodass ein späterer Schritt, der sie verwendet, scheitert und sie nennt, statt einen Wert aus einer
früheren E-Mail einzugeben. Ein Muster, das nichts trifft, lässt den Schritt scheitern.

**Welches Postfach.** Die Secrets der Umgebung `mailpit.url` (zum Beispiel
`https://mail.staging.example`) und, wenn es danach fragt, `mailpit.username` und
`mailpit.password`; `mailpit.timeout` ändert die Wartezeit, in Sekunden. Ohne sie das des Servers
(`MAILPIT_URL`, das der docker-compose-Stack auf sein mitgeliefertes Mailpit setzt, erreichbar unter
http://localhost:8025). Das Postfach wird von dort gelesen, wo der Browser läuft, sodass ein Plan
auf einem lokalen Agenten ein Mailpit im Netzwerk des Agenten erreicht.

### Textnachrichten (SMS) {#sms}

**Auf SMS warten** tut für einen per SMS gesendeten Code, was **Auf E-Mail warten** für einen per
E-Mail gesendeten tut. Er liest das **SMS-Postfach** der Organisation (Einstellungen →
SMS-Postfach): Ein Eigentümer legt dort eine Empfangsadresse an, die einmal angezeigt wird, und
trägt sie beim SMS-Anbieter als Webhook für eingehende Nachrichten der Testnummern ein — _A message
comes in_ bei Twilio, die Inbound-URL bei Vonage oder jeder Anbieter, der `To` und `Body` (oder
`to` und `text`) als Formular oder JSON sendet. Jede Nachricht, die diese Nummern empfangen, wird
dort abgelegt und sieben Tage aufbewahrt; die Einstellungsseite listet die neuesten.

Der Wert des Schritts ist die Nummer oder die Nummer und ein Muster für den Code:
`+39 333 1234567` oder `+39 333 1234567|codice (\d{6})`. Leerzeichen, Bindestriche und eine
führende `00` spielen keine Rolle. Er wartet auf eine Nachricht an diese Nummer, die nach dem Start
des Tests angekommen ist — 60 Sekunden oder <code v-pre>sms.timeout</code> aus der Umgebung —, und
setzt <code v-pre>{{sms.otp}}</code> (den Code, gefunden wie in einer E-Mail),
<code v-pre>{{sms.text}}</code> und <code v-pre>{{sms.from}}</code>. Zwei gleichzeitig laufende
Tests sollten verschiedene Nummern verwenden.

Die Empfangsadresse ist das Geheimnis der Organisation: Sie zu ersetzen, stoppt die alte sofort,
und sie zu widerrufen, lehnt jede Nachricht ab. Anfragen an sie sind wie Webhooks begrenzt
(`WEBHOOK_RATE_LIMIT`).

### Datenbank: Daten prüfen und vorbereiten {#database}

Was ein Bildschirm nicht zeigt — die Zeile, die der Checkout geschrieben hat, das Kennzeichen, das
eine Admin-Seite gesetzt hat —, oder was ein Test vorbereiten muss, ohne sich durch zehn
Bildschirme zu klicken, liest oder schreibt ein Schritt **Datenbankabfrage** direkt. Sein Wert ist
eine SQL-Anweisung, mit Variablen:

| Aktion           | Wert                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| Datenbankabfrage | <code v-pre>SELECT status, total FROM orders WHERE email = '{{email}}'</code> |
| Werte prüfen     | <code v-pre>{{db.status}} == Paid</code>                                      |

Er setzt:

| Variable                           | Enthält                                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <code v-pre>{{db.value}}</code>    | Die erste Spalte der ersten Zeile (leer, wenn es keine Zeile gibt)                                                                                                                                                                          |
| <code v-pre>{{db.column}}</code>   | Jede Spalte der ersten Zeile mit ihrem Namen — <code v-pre>{{db.status}}</code>, <code v-pre>{{db.total}}</code>; andere Zeichen als Buchstaben, Ziffern, `_` und `.` werden zu `_`, benennen Sie also berechnete Spalten (`count(*) AS n`) |
| <code v-pre>{{db.rowCount}}</code> | Die zurückgegebenen Zeilen oder die von einem INSERT, UPDATE oder DELETE geänderten                                                                                                                                                         |
| <code v-pre>{{db.json}}</code>     | Die ersten 100 Zeilen als JSON                                                                                                                                                                                                              |

Datumsangaben sind ISO, leere Werte sind leerer Text. Jede Abfrage vergisst die Spalten der
vorigen, sodass eine Spalte, die diese Abfrage nicht geliefert hat, undefiniert ist statt übrig
geblieben. Eine Anweisung, die die Datenbank ablehnt, lässt den Schritt mit der Meldung der
Datenbank scheitern.

**Welche Datenbank.** Das Secret der Umgebung `db.url`, eine Adresse, deren Schema die Datenbank
wählt:

| Datenbank      | Adresse                                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL     | `postgres://user:password@host:5432/shop` (`?sslmode=require` für TLS)                                                                                                                                                        |
| MySQL, MariaDB | `mysql://user:password@host:3306/shop`                                                                                                                                                                                        |
| SQL Server     | `sqlserver://user:password@host:1433/Shop` — `sqlserver://…@host%5CSQLEXPRESS/Shop` für eine benannte Instanz; `?encrypt=false` für einen Server ohne TLS, `?trustServerCertificate=true` für ein selbstsigniertes Zertifikat |

Zeichen wie `@` oder `/` im Passwort werden als `%40` und `%2F` geschrieben. Für eine zweite
Datenbank geben Sie ihr einen Namen: `db.reporting.url` und der Wert `@reporting SELECT …`.
`db.timeout` ändert die Grenze von 30 Sekunden, in Sekunden. Höchstens 1000 Zeilen werden
behalten.

Die Anweisung läuft mit den Rechten des Benutzers in der Adresse: Verwenden Sie einen Benutzer,
der nur lesen kann, was die Tests prüfen, und nur schreiben, was sie vorbereiten, und nie eine
Produktionsdatenbank. Die Abfrage läuft vom WebFlowMaster-Runner aus, nicht vom Browser — auch auf
einem lokalen Agenten —, also muss der Runner die Datenbank erreichen. Werte werden so, wie sie
sind, ins SQL eingesetzt: Setzen Sie Text in Anführungszeichen (`'{{email}}'`) und verwenden Sie
Variablen, deren Werte der Test kontrolliert.

## Standort und Downloads {#location-and-downloads}

**Standort setzen** lässt den Browser der Seite eine Position melden: `45.4642, 9.19` oder mit einer
Genauigkeit in Metern `45.4642, 9.19, 50`. Ab diesem Schritt antwortet `navigator.geolocation`
damit in jedem Tab des Tests, und die Seite darf ohne Berechtigungsabfrage fragen — für eine
Filialsuche, Liefergebiete oder Preise nach Region. Ein späteres **Standort setzen** verschiebt
sie.

**Download prüfen** klickt auf sein Element, nimmt die Datei, die der Klick herunterlädt, bewahrt
sie mit den Nachweisen des Laufs auf und prüft sie. Der Wert listet die Prüfungen, getrennt durch
`;` (ein Text darf Kommas enthalten):

`name: invoice-*.pdf; contains: Total 1.234,50 €; pages >= 1`
`type: csv; rows >= 10; columns = 5; contains: Rossi, Mario`

- `name:` ein Muster für den Dateinamen (`*` beliebige Zeichen); `type:` `pdf`, `csv`, `xlsx`,
  `json` oder `txt`;
- `contains:` ein Text, den der Inhalt enthalten muss, ohne Beachtung von Groß-/Kleinschreibung und
  Leerraum — der Text eines PDF, die Zellen einer CSV oder eines Excel-Blatts (des ersten Blatts)
  oder die Datei als Text; wiederholen Sie es für mehrere;
- `size`, `rows`, `columns`, `pages` mit `<`, `<=`, `>`, `>=` oder `=`; Größen nehmen `KB` oder
  `MB`.

Leer prüft er nur, ob eine Datei heruntergeladen wurde. Ein Klick, der innerhalb der Wartezeit
nichts herunterlädt, lässt den Schritt scheitern. Spätere Schritte können
<code v-pre>{{download.name}}</code>, <code v-pre>{{download.size}}</code>,
<code v-pre>{{download.rows}}</code>, <code v-pre>{{download.pages}}</code> und
<code v-pre>{{download.text}}</code> (die ersten 2.000 Zeichen) verwenden — etwa in einem Schritt
**Werte prüfen**. Der Bericht verlinkt die Datei und zeigt, was sie enthielt.

## Seitengeschwindigkeit {#page-speed}

**Seitengeschwindigkeit messen** liest, was der Browser selbst über die Seite aufgezeichnet hat, auf
der der Test an dieser Stelle des Ablaufs ist, und scheitert, wenn eine Grenze verletzt ist. Sein
Wert listet die Grenzen:

`LCP < 2.5s, CLS <= 0.1, INP < 200, TTFB < 800ms, weight < 2MB`

| Metrik                       | Was sie ist                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `LCP`                        | Largest Contentful Paint: wann der Hauptinhalt erschien.                                                                                    |
| `CLS`                        | Cumulative Layout Shift: wie stark die Seite gesprungen ist (größtes 5-Sekunden-Fenster).                                                   |
| `INP`                        | Interaction to Next Paint: die bisher langsamste Reaktion auf einen Klick oder eine Taste; erst gemessen, nachdem der Test interagiert hat. |
| `FCP`, `TTFB`, `DCL`, `LOAD` | Erste Darstellung, erstes Byte, DOM bereit, Load-Ereignis.                                                                                  |
| `TBT`                        | Total Blocking Time: lange Aufgaben nach der ersten Darstellung.                                                                            |
| `REQUESTS`, `WEIGHT`         | Wie viele Anfragen und wie viele Bytes übertragen wurden (fremde Dateien ohne `Timing-Allow-Origin` zählen als 0).                          |

Zeiten nehmen `ms` oder `s`, Größen `KB` oder `MB`. Leer prüft er die _guten_ Schwellen der Core Web
Vitals: `LCP <= 2500, CLS <= 0.1, INP <= 200`. Setzen Sie ihn nach dem Laden der Seite — etwa nach
einem **Auf Element warten** auf den Hauptinhalt — und nach einer Interaktion, wenn INP zählt. Nur
Chromium misst LCP, CLS, INP und TBT; in Firefox und WebKit werden sie als — angezeigt, und eine
Grenze darauf wird als nicht gemessen gemeldet statt als gescheitert, sodass derselbe Test in jedem
Browser läuft.

**Lighthouse-Audit** führt [Lighthouse](https://developer.chrome.com/docs/lighthouse) auf der
Adresse der aktuellen Seite aus und prüft die Werte seiner Kategorien (0–100):
`performance >= 80, accessibility >= 90, best-practices >= 90, seo >= 80`, dazu `desktop` für die
Desktop-Voreinstellung (standardmäßig mobil). Leer zeichnet er die Werte auf und prüft nichts.
Lighthouse lädt die Seite in einem eigenen Chromium auf dem Runner neu und sendet dabei die Cookies
des Tests für diese Adresse, sodass eine Seite hinter einer Anmeldung angemeldet geprüft wird; das
dauert 15–60 Sekunden. Sein vollständiger HTML-Bericht wird mit den Nachweisen des Laufs
aufbewahrt. Er läuft nur auf den Runnern des Servers: Ein Plan auf lokalen Agenten oder auf einem
Browser-Grid kann nicht von dort geprüft werden, wo die Seite ist.

Die Karte **Seitengeschwindigkeit** des Laufberichts listet jede gemessene Seite — die Kennzahlen
pro Browser und die Lighthouse-Werte mit einem Link zum Bericht — mit den Grenzen, die jede verletzt
hat, und die Details jedes Schritts zeigen dieselben Zahlen.

## Das Netzwerk simulieren {#mocking-the-network}

Ein Test kann die Anfragen der Seite selbst beantworten, um die Bildschirme zu sehen, die das echte
Backend selten zeigt — einen Fehler, eine leere Liste, eine langsame Antwort —, oder um zu laufen,
während das Backend nicht bereit ist. **Anfrage simulieren** nimmt

`[METHOD] adresse | status [after 1500ms] | body`

- **adresse**: eine URL oder ein Muster, in dem `**` für beliebige Zeichen und `*` für beliebige
  außer `/` steht: `**/api/orders*`, <code v-pre>{{baseUrl}}/api/orders/42</code>. Mit einer
  Methode davor (`GET`, `POST`…) wird nur diese Methode beantwortet; andere erreichen den Server.
- **status**: `200`, wenn weggelassen; `after 1500ms` (oder `after 2s`, bis 30 s) verzögert die
  Antwort, um einen Ladezustand zu prüfen.
- **body**: alles nach dem zweiten `|`, Variablen eingeschlossen. JSON wird als `application/json`
  gesendet, alles andere als Text.

`GET **/api/orders | 200 | []` zeigt die leere Liste;
`POST **/api/orders | 500 | {"error":"out of stock"}` die gescheiterte Bestellung. Die Simulation
gilt für den Rest des Tests und in jedem Tab, den er öffnet; eine spätere Simulation derselben
Adresse ersetzt sie, sodass ein Test seine Antwort mittendrin ändern kann. **Anfragen blockieren**
nimmt eine Adresse und lässt diese Anfragen scheitern — `**/analytics/**` hält einen Drittanbieter
aus dem Lauf heraus —, und **Simulationen entfernen** nimmt alles bisher Gesetzte zurück.

Betroffen ist nur, was die Seite anfragt: Vorbedingungen, Aufräumen und API-Tests gehen an die
echten Server.

## Vorbedingungen

**Vorbedingungen** sind API-Aufrufe, die vor den Schritten laufen, um die Anwendung in den Zustand
zu bringen, den der Test braucht — einen Kunden anlegen, einen Warenkorb leeren. Wählen Sie sie aus
Ihren gespeicherten [API-Tests](./api-tests); sie laufen in der aufgeführten Reihenfolge. Ein Test,
dessen Vorbedingung scheitert, wird als blockiert gemeldet, nicht als fehlgeschlagen.

## Aufräumen {#cleanup}

**Aufräumen**-Aufrufe sind API-Aufrufe nach dem Test, ob er bestanden hat, gescheitert ist oder
von einer Vorbedingung blockiert wurde, um die Daten zu entfernen, die er angelegt hat — die
Bestellung, die er aufgegeben hat, den Kunden, den eine Vorbedingung angelegt hat —, damit der
nächste Lauf vom selben Zustand ausgeht und sich die getestete Anwendung nicht mit Testdaten füllt.
Wählen Sie sie aus Ihren gespeicherten [API-Tests](./api-tests), meist `DELETE`-Anfragen; sie
laufen in der aufgeführten Reihenfolge.

- Sie können die Werte verwenden, die die Schritte gespeichert haben:
  <code v-pre>DELETE {{baseUrl}}/orders/{{orderId}}</code> nach einem Schritt **Text in Variable
  speichern**, der die Bestellnummer als `orderId` behalten hat. Ein Aufruf, der eine Variable
  nennt, die der Lauf nie gesetzt hat — der Test scheiterte vor dem Schritt, der sie speichert —,
  wird nicht ausgeführt, und der Bericht sagt, dass er übersprungen wurde.
- Jeder Aufruf wird versucht, auch nachdem einer gescheitert ist. `404` und `410` zählen als
  **bereits entfernt**, sodass ein Aufräumen gefahrlos erneut laufen kann.
- Mit einem [Dataset](#datasets) läuft das Aufräumen einmal pro Zeile, nach allen Zeilen, mit den
  Werten dieser Zeile; was eine Vorbedingung angelegt hat, wird von der ersten Zeile gelöscht und
  ist für die anderen bereits entfernt.
- Das Aufräumen ändert nie das Ergebnis des Tests. Der Bericht zeigt es als Zeile **Aufräumen** nach
  den Schritten, fehlgeschlagen, wenn ein Aufruf gescheitert ist — Daten können zurückgeblieben
  sein —, und das Laufprotokoll nennt den Aufruf.

**Test ausführen** im Testbaukasten führt auch das Aufräumen aus. Der Debugger nicht: Eine mittendrin
pausierte Sitzung würde löschen, was Sie gerade ansehen.

## Datasets

Um denselben Test über mehrere Eingaben laufen zu lassen, geben Sie ihm ein **Dataset**: eine
Tabelle, deren Spaltennamen zu Variablen werden. Der Test läuft einmal pro Zeile. Bauen Sie es,
indem Sie Spalten und Zeilen hinzufügen, oder **Aus einer Tabelle einfügen**: Kopieren Sie den Block
aus Excel oder Google Sheets, mit Kopfzeile.

Werden die Zeilen mit anderen Tests geteilt, bewahren Sie sie in einem
[gemeinsamen Datensatz](./organizing#test-data) auf und wählen Sie ihn stattdessen unter
**Gemeinsamen Datensatz verwenden**: Der Test behält nur eine Verknüpfung, läuft über die Zeilen des
Satzes, wie sie zum Zeitpunkt des Laufs sind, und folgt dem Satz, wenn er umbenannt wird. **Eine
Kopie als eigene Zeilen dieses Tests verwenden** macht aus der Verknüpfung wieder eigene Zeilen.

## Schrittgruppen

Eine Folge, die viele Tests verwenden — anmelden, einen Kunden wählen —, kann mit **Als Gruppe
speichern** gespeichert werden. Sie erscheint dann unter **Schrittgruppen** in der Palette, und
jeder Test kann sie einbinden. Ein Test führt die Gruppe so aus, wie sie zum Zeitpunkt des Laufs
ist; eine Änderung an der Gruppe ändert also jeden Test, der sie verwendet.

Das Zahnrad neben **Schrittgruppen** in der Palette öffnet ihre Verwaltung: **Wo verwendet** nennt
die Tests, die eine Gruppe aufrufen, **Bearbeiten** ändert ihren Namen und ihre Beschreibung — und
ersetzt bei angehakter Box ihre Schritte durch die, die jetzt im Testbaukasten stehen, nachdem
**Im Builder öffnen** sie zum Ändern dorthin gesetzt hat —, und **Löschen** entfernt eine Gruppe,
die kein Test aufruft; eine noch aufgerufene wird unter Nennung der Tests abgelehnt.

## Eigene Aktionen {#custom-actions}

Wenn keine eingebaute Aktion tut, was ein Test braucht, kann ein Bearbeiter eine schreiben:
**Einstellungen → Eigene Aktionen → Neue eigene Aktion**, mit Name, Parametern und Skript. Die
Aktion erscheint unter **Eigene Aktionen** in der Palette, und ein Test verwendet sie wie jeden
anderen Schritt.

- **Parameter** werden durch Kommas getrennt aufgeführt; ein nachgestelltes `?` macht einen optional
  (`code, qty?`). Im Test liefert der Wert des Schritts die Argumente: `code=4711; qty=2`. Schreiben
  Sie `\;` für ein Semikolon innerhalb eines Werts. Argumente dürfen <code v-pre>{{variables}}</code>
  und erzeugte Werte enthalten. Ein fehlendes oder unbekanntes Argument oder ein Wert ohne `=`
  lässt den Test scheitern, bevor der Browser sich öffnet — in **Test ausführen** im Testbaukasten
  wie in einem Plan —, unter Nennung des Arguments.
- **Das Skript** ist der Rumpf einer async-Funktion, die in der getesteten Seite läuft. Es liest
  seine Argumente als `args` (`args.code`) und, wenn der Schritt ein Element hat, dieses Element als
  `element` (gefunden mit `document.querySelector`, also ein CSS-Selektor). Es lässt den Schritt
  scheitern, indem es einen Fehler wirft oder `false` zurückgibt; alles andere, was es zurückgibt,
  wird im Bericht angezeigt.

```js
const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes(args.code));
if (!row) throw new Error(`No order ${args.code}`);
row.querySelector('button.open').click();
```

Eine eigene Aktion hat die Möglichkeiten eines Schritts **JavaScript ausführen** und keine anderen:
Sie läuft in der Browserseite, nie auf dem Server oder dem Runner. Tests verweisen auf die Aktion,
statt sie zu kopieren, sodass eine Änderung jeden Test, der sie verwendet, bei seinem nächsten Lauf
ändert; eine Aktion, die noch ein Test oder eine Schrittgruppe verwendet, kann nicht gelöscht
werden, und die Meldung nennt, was sie verwendet. Anlegen, Ändern und Löschen werden im
Audit-Protokoll festgehalten, ohne das Skript.

## Element-Repository {#element-repository}

Wenn viele Tests dasselbe Element verwenden, **behalten** Sie es: Das Lesezeichen an einem erkannten
Element speichert es mit einem Namen in einem Projekt. Tests, die es verwenden, lesen seinen
Selektor aus dem Projekt, sodass bei einer Änderung der Anwendung eine einzige Korrektur des
Selektors unter **Einstellungen → Element-Repository** jeden Test repariert.

Findet ein Schritt sein Element nicht und hat die Installation einen KI-Schlüssel, kann der Lauf es
**reparieren**: Er fragt nach einem neuen Selektor, versucht es erneut und markiert den Schritt im
Bericht als _repariert_. Ein repariertes behaltenes Element zeigt im Repository den alten und den
neuen Selektor, damit Sie bestätigen.

## Speichern

**Test speichern** fragt nach einem Namen und optional einem Projekt (dort können Sie auch eines
anlegen). Erneutes Speichern unter demselben Namen bietet das Überschreiben an. Jede Speicherung ist
eine neue **Version** im Verlauf des Tests (siehe
[Verlauf und Versionen](./organizing#history-and-versions)).
