# Mobile Apps

**Mobile Apps** testet eine native Android- oder iOS-App auf einem **echten Gerät** eines
Cloud-Grids — BrowserStack App Automate oder LambdaTest Real Devices — über Appium. Es ist eine
eigene Testart neben Web- und API-Tests: Ein nativer Bildschirm hat keine Webseite, also nennen
seine Schritte die Elemente so, wie die App sie kennt.

Für eine responsive **Website** auf einem Telefon brauchen Sie das nicht: Emulieren Sie das Gerät
stattdessen in den Browsern des Plans ([Telefone und Tablets](./running#mobile-devices)).

## Bevor Sie beginnen

- Ein **BrowserStack**- oder **LambdaTest**-Grid unter **Einstellungen → Browser-Grids**, mit
  Benutzername und Zugriffsschlüssel des Kontos. Dasselbe Grid bedient Browser und Geräte; ein
  eigener Playwright-Server führt nur Browser aus.
- Oder Ihre eigenen Geräte: ein [lokales Appium](#local-appium) neben einem lokalen Agenten —
  Emulatoren, Simulatoren, Telefone per USB.
- Die App: eine **.apk** oder **.aab** für Android, eine für echte Geräte gebaute **.ipa** für iOS.

### Auf eigenen Geräten (lokales Appium) {#local-appium}

Emulatoren, Simulatoren und die Telefone auf Ihrem Schreibtisch laufen über einen
**Appium**-Server auf einem Rechner mit einem [lokalen Agenten](/en/integrations/local-agents) (auf
Englisch). Der Agent transportiert die Anfragen, sodass der Server keinen Weg in dieses Netzwerk
braucht und außer Appium selbst nichts Neues installiert wird.

1. Auf dem Rechner des Agenten: Installieren Sie Appium und seine Treiber (`npm i -g appium`,
   `appium driver install uiautomator2`, `xcuitest` auf einem Mac), starten Sie den Emulator oder
   schließen Sie das Telefon an, und starten Sie `appium`.
2. **Einstellungen → Browser-Grids → Grid hinzufügen**, Anbieter **Lokales Appium (Agent)**: der
   **Pool** dieses Agenten und, wenn Appium nicht auf `http://127.0.0.1:4723` lauscht, seine
   **Adresse**, wie der Rechner des Agenten sie erreicht. Kein Schlüssel. **Verbindung testen**
   fragt Appium über einen Agenten des Pools nach seinem `/status` und antwortet mit seiner
   Version.
3. In einem mobilen Test: **Gerät** ist der Gerätename von Appium (`emulator-5554`, die UDID des
   Telefons oder `iPhone 15` für einen Simulator), und **App** ist der Pfad der Datei auf dem
   Rechner des Agenten (`/home/qa/shop.apk`, `C:\apps\shop.apk`) oder eine `http(s)://`-Adresse,
   von der Appium sie herunterlädt. Es gibt nichts hochzuladen.

Läufe, Pläne, der Inspector und alles andere funktionieren wie in den Clouds. Es gibt kein
Dashboard und kein Video: Der Bericht enthält die Schritte und den letzten Screenshot. Ein lokales
Appium führt nur Mobile-App-Tests aus; die Browser eines Plans können nicht darauf laufen.

## Einen Test schreiben

**Mobile Apps** im Menü → **Neuer mobiler Test**:

| Feld                        | Was es ist                                                                                                                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                    | Eindeutig in der Organisation.                                                                                                                                                                                                                                                                        |
| **Plattform**               | Android oder iOS.                                                                                                                                                                                                                                                                                     |
| **App**                     | Wo das Grid sie findet: **.apk / .ipa hochladen** sendet die Datei an das daneben gewählte Grid und trägt ihre Adresse ein (`bs://…` oder `lt://…`); oder fügen Sie eine früher hochgeladene ein oder eine https://-Adresse, von der das Grid sie herunterlädt. WebFlowMaster behält die Datei nicht. |
| **Gerät**                   | So, wie das Grid es nennt: `Google Pixel 8`, `Samsung Galaxy S24`, `iPhone 15` — siehe die Geräteliste des Grids.                                                                                                                                                                                     |
| **OS-Version**              | Optional: `14.0`, `17`. Leer: die Wahl des Grids für dieses Gerät.                                                                                                                                                                                                                                    |
| **Projekt**                 | Wie bei einem Webtest: In einem [eingeschränkten Projekt](./organizing) sehen nur seine Mitglieder den Test und seine Läufe, und ein Betrachter kann ihn weder ändern noch ausführen.                                                                                                                 |
| **Läuft in Testplänen auf** | Das Grid, auf dem ein [Testplan](#in-einem-testplan) ihn ausführt. Ein neuer Test beginnt mit dem ersten BrowserStack- oder LambdaTest-Grid; **Kein Grid** hält ihn aus Planläufen heraus (ein Plan, der ihn enthält, meldet für ihn einen Fehler).                                                   |

Jeder Schritt ist eine Aktion und bei den meisten ein Element:

| Aktion                                       | Was sie bewirkt                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Tippen**                                   | Tippt auf das Element.                                                                        |
| **Eingeben**                                 | Leert das Feld und gibt den Wert ein.                                                         |
| **Leeren**                                   | Leert das Feld.                                                                               |
| **Auf Element warten** / **Sichtbar prüfen** | Wartet, bis das Element auf dem Bildschirm ist (bis zu 15 Sekunden).                          |
| **Nicht sichtbar prüfen**                    | Scheitert, wenn das Element nach bis zu 5 Sekunden noch auf dem Bildschirm ist.               |
| **Text enthält prüfen**                      | Der Text des Elements enthält den Wert.                                                       |
| **Wischen**                                  | `up`, `down`, `left` oder `right`: wie sich der Finger über die Mitte des Bildschirms bewegt. |
| **Zurück**                                   | Das Zurück des Systems (Android) oder die Zurück-Navigation der App.                          |
| **Tastatur ausblenden**                      | Schließt die Bildschirmtastatur, wenn sie verdeckt, was als Nächstes kommt.                   |
| **Warten (Sekunden)**                        | Bis zu 60 Sekunden. Auf das Element zu warten ist besser.                                     |

**Ein Element benennen:**

| Schreiben Sie                                         | Findet                                                                                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~login`                                              | Die **Accessibility-ID**: `content-desc` unter Android, `accessibilityIdentifier` unter iOS. Die, nach der Sie die Entwickler fragen sollten: Sie übersteht Redesigns und Übersetzungen. |
| `id=com.shop:id/login`                                | Die Resource-ID (Android) bzw. den Namen (iOS).                                                                                                                                          |
| `text=Sign in`                                        | Ein Element, das genau diesen Text zeigt.                                                                                                                                                |
| `//android.widget.Button[@text='OK']`                 | XPath durch den View-Baum der App.                                                                                                                                                       |
| `android=new UiSelector().text("OK")`                 | UiAutomator von Android.                                                                                                                                                                 |
| `ios=label == "OK"`, `chain=**/XCUIElementTypeButton` | Predicate Strings und Class Chains von iOS.                                                                                                                                              |

Ein Schritt, den die Plattform nicht lesen kann — ein CSS-Selektor, `android=…` in einem iOS-Test —,
wird rot markiert, und der Test kann erst nach der Korrektur gespeichert werden. Werte können die
<code v-pre>{{variables}}</code> der Umgebung und [erzeugte Werte](./web-tests#generated-values)
verwenden, einschließlich <code v-pre>{{$totp(secret_mfa)}}</code>.

## Der Inspector {#inspector}

Herauszufinden, wie ein Element heißt, ist der schwierige Teil eines mobilen Tests. **Inspector**
unter den Schritten des Testdialogs öffnet die App auf einem echten Gerät des Grids — dem, auf dem
der Test in Plänen läuft, sonst dem, an das Uploads gehen — und zeigt seinen Bildschirm neben der
Liste seiner Elemente. App und Gerät müssen ausgefüllt sein; das Grid braucht ein bis zwei Minuten,
um das Gerät zu finden.

- **Klicken Sie auf den Bildschirm** (oder auf ein Element der Liste): Das Element unter dem Zeiger
  wird umrandet, mit seinen Attributen und den Locators, die ein Schritt dafür verwenden kann —
  Accessibility-ID, Resource-ID, Text, XPath —, als **eindeutig** markiert, wenn sie auf diesem
  Bildschirm nur dieses Element finden, eindeutige zuerst. Ist sonst nichts eindeutig, wird ein
  XPath nach Position angeboten; er funktioniert, bricht aber, sobald sich das Layout ändert.
- **+** neben einem Locator fügt am Ende des Tests einen Schritt hinzu, mit der unter
  **Hinzufügen als** gewählten Aktion (standardmäßig Tippen; Sichtbar prüfen, Auf Element warten,
  Nicht sichtbar prüfen, Leeren).
- Um den nächsten Bildschirm zu erreichen, steuern Sie das Gerät von hier aus: **Auf dem Gerät
  antippen** und **Eingeben** am ausgewählten Element, **Auf dem Gerät tippen**, um dort zu tippen,
  wo Sie auf den Bildschirm klicken, die Zurück- und Wisch-Schaltflächen und ↻, um den Bildschirm
  neu zu lesen. Ein Schritt, der scheitert, sagt warum, wie in einem Lauf.

### Einen Test aufzeichnen {#recording}

**Aufzeichnen** macht aus dem Durchlaufen der App Schritte. Jede Berührung des Bildschirms wird
zuerst auf dem Gerät ausgeführt und wird nur dann zu einem Schritt, wenn sie funktioniert hat:

- **Ein Klick** tippt auf das Element unter dem Zeiger, benannt mit seinem robustesten Locator (dem
  ersten, den das Elementfeld anbieten würde). Wo sich nichts benennen lässt, wird getippt, aber
  nicht aufgezeichnet, und der Inspector sagt das.
- **Ein Klick auf ein Textfeld** fragt dann, was eingegeben werden soll; **Eingeben** (oder Enter)
  zeichnet einen Eingabe-Schritt auf. In einem Passwortfeld wird der Text maskiert und der Schritt
  als **Passwort** markiert.
- **Ein Ziehen** auf dem Bildschirm zeichnet ein Wischen in seine Richtung auf (oben, unten, links
  oder rechts). Die Schaltflächen Zurück, Wischen und Tastatur ausblenden werden ebenfalls
  aufgezeichnet.
- **Prüfen, ob sichtbar** oder **Text prüfen**, dann ein Klick auf ein Element, zeichnet eine
  Assertion auf — die Textprüfung mit dem Text, den das Element jetzt zeigt. Beide werden auch am
  ausgewählten Element angeboten.

Aufgezeichnete Schritte warten in **Aufgezeichnete Schritte**, nicht im Test. Dort können Sie ein
Element oder einen Wert korrigieren, einen Schritt nach oben oder unten verschieben oder ihn
entfernen; **N Schritt(e) zum Test hinzufügen** setzt sie in dieser Reihenfolge ans Ende des Tests,
und **Verwerfen** verwirft sie. Wird der Inspector mit nicht hinzugefügten Schritten geschlossen,
fragt er zuerst nach. Zwei Abzeichen verlangen einen Blick vor dem Hinzufügen:

- **fragil** — nur seine Position auf dem Bildschirm benennt das Element (ein XPath nach Position):
  Der Schritt bricht, wenn sich das Layout ändert. Geben Sie dem Element in der App eine
  Accessibility-ID, oder schreiben Sie einen robusteren Locator.
- **Passwort** — ein in den Test geschriebenes Passwort kann jeder lesen, der ihn öffnen kann.
  Ersetzen Sie es durch <code v-pre>{{password}}</code> und legen Sie den Wert in der Umgebung an.

Ein Wischen wird als Richtung über den Bildschirm aufgezeichnet, nicht als genauer Pfad des
Ziehens; langes Drücken, Pinch-Gesten oder ein Tippen auf feste Koordinaten werden nicht
aufgezeichnet.

Der Inspector hat keine Umgebung: Ein Wert mit einer <code v-pre>{{variable}}</code> wird unter
Nennung ihres Namens abgelehnt. Geben Sie den Wert selbst ein und ändern Sie ihn dann im Schritt (in
der aufgezeichneten Liste, vor dem Hinzufügen).

Das Gerät gehört Ihnen, solange der Inspector offen ist, und es kostet Grid-Minuten: Das Schließen
des Inspectors gibt es zurück, ebenso fünf Minuten ohne Nutzung. Ein Inspector pro Person
gleichzeitig: Einen weiteren zu öffnen, schließt den ersten. Das Öffnen wird im Audit-Protokoll
festgehalten.

## Ausführen

**Ausführen** (▶) in der Zeile eines Tests: Wählen Sie das Grid und für seine Variablen die
Umgebung. Das Grid findet das Gerät und installiert die App — ein bis zwei Minuten —, dann erscheint
jeder Schritt, während er läuft, mit dem Grund, wenn einer scheitert; die Schritte nach einem
fehlgeschlagenen werden übersprungen. Am Ende kommen der Screenshot des Geräts und bei BrowserStack
**Video und Logs im Grid**, die Seite der Sitzung mit ihrem Video. Das Dashboard des Grids zeigt die
nach dem Test benannte Sitzung, als bestanden oder fehlgeschlagen markiert.

Die Liste zeigt den letzten Lauf jedes Tests. Betrachter sehen die Tests und ihre Läufe; Bearbeiter
schreiben, starten und löschen sie.

## In einem Testplan

Ein Plan kann mobile Tests neben seinen Web- und API-Tests enthalten: Im Plan-Assistenten listet
**Suiten hinzufügen** sie mit der Kennzeichnung **mobile**, und sein Tag-Filter grenzt sie wie die
anderen ein. Die Seite des Plans listet sie mit _(mobile App)_.

In einem Lauf des Plans wird ein mobiler Test:

- **einmal** ausgeführt, auf dem Gerät, das er nennt, und dem Grid, das unter **Läuft in Testplänen
  auf** gewählt ist — nicht einmal pro Browser oder Sprache des Plans, dessen Browser und
  „ausführen auf“ für ein Gerät nicht gelten;
- mit den Variablen der Umgebung des Laufs ausgeführt, wie die anderen Tests des Plans;
- nach **Erneut ausführen bei Fehlschlag** des Plans wiederholt (die Versuche erscheinen am
  Ergebnis) und unterliegt seiner Fehlerrichtlinie: Ein fehlgeschlagener mobiler Test lässt den
  Lauf scheitern und kann ihn stoppen;
- zu einer Zeile des [Berichts](./results#der-bericht-eines-laufs) wie jede andere: das Gerät
  (`Google Pixel 8 · 14.0`) in der Spalte _Browser_, seine Schritte unter der Schritt-Schaltfläche
  mit dem Grund des fehlgeschlagenen, der letzte Bildschirm des Geräts als Screenshot und bei
  BrowserStack **Sitzung im Grid öffnen** für Video und Logs.

Da er Teil des Plans ist, läuft er auch in den [Zeitplänen](./running#zeitplanung) und
[Pipelines](./running#aus-einer-pipeline) des Plans, und sein Ergebnis erreicht mit dem Rest die
Benachrichtigungen, JUnit und das Testmanagement-Werkzeug.

Ein mobiler Test ohne Grid wird im Lauf als Fehler gemeldet, mit Grund, ohne irgendein Grid nach
einem Gerät zu fragen.

## Suiten, Anforderungen und Testmanagement

Ein mobiler Test geht überall hin, wo ein Web- oder API-Test hingeht:

- in eine **Suite** ([Suiten](./organizing#suites)) und damit in jeden Plan, der sie einbindet:
  eine statische Suite durch Auswahl, eine dynamische durch die Tags, die der Test trägt;
- als Abdeckung einer **Anforderung** ([Anforderungen](./organizing#requirements)): Sein letztes
  Ergebnis in einem Planlauf zählt wie jedes andere, und der Matrix-Export sagt `mobile`;
- verknüpft mit einem Fall in **TestRail, Xray oder Zephyr Scale**
  ([Testmanagement](./results#test-management)): Sein Ergebnis in einem Lauf wird zu diesem Fall
  veröffentlicht, mit dem Gerät im Kommentar. Ein `[C123]` am Anfang seines Namens funktioniert wie
  bei einem Webtest.

In jeder Liste trägt er die Kennzeichnung **Mobile**.

## Tags {#tags}

Die Spalte **Tags** von **Mobile Apps** vergibt die Tags der Organisation an einen mobilen Test, so
wie die Testbibliothek es für Webtests tut (Betrachter sehen sie). Ein Tag wird von jeder Testart
geteilt: Eine dynamische Suite mit _smoke_ führt die Web-, API- und mobilen Tests aus, die es
tragen.

## Quarantäne {#quarantine}

Ein mobiler Test, der aus Gründen außerhalb der App scheitert (eine Gerätefarm, die die Sitzung
verliert, ein langsamer Emulator), kann mit der Schild-Schaltfläche seiner Zeile mit Begründung
beiseitegestellt werden, wie ein Web- oder API-Test
([instabile Tests und Quarantäne](./results#instabile-tests-und-quarantane)). Er läuft in Plänen
weiter, und seine Ergebnisse werden aufbewahrt, aber seine Fehlschläge lassen den Lauf nicht mehr
scheitern. Die Zeile zeigt **In Quarantäne** (fahren Sie für den Grund darüber); entlassen wird er
unter **Tests in Quarantäne** in **Berichte**, wo er die Kennzeichnung **Mobile** trägt. In einem
eingeschränkten Projekt dürfen ihn nur diejenigen in Quarantäne stellen oder entlassen, die den
Test bearbeiten dürfen.

## Instabile Tests {#unstable}

Mobile Tests gehören zu **Tests, die sich widersprechen** unter **Berichte**
([instabile Tests und Quarantäne](./results#instabile-tests-und-quarantane)), mit der Kennzeichnung
**Mobile**. Jedes Gerät zählt für sich: Ein Test, der auf einem Telefon scheitert und auf einem
anderen besteht, ist eine Tatsache über die App, keine Unentschlossenheit. Von dort aus kann er wie
jeder andere Test in Quarantäne gestellt werden.

Unter **Mobile Apps** trägt ein Test, der in den letzten 30 Tagen als instabil erkannt wurde, das
Abzeichen **Instabil**; fahren Sie darüber, um zu sehen, auf welchem Gerät und wie oft sich sein
Urteil geändert hat. Mobile Tests haben keine Versionen, daher zählt jeder Urteilswechsel, wie bei
API-Tests.

## Versionen und Veröffentlichung

Gespeicherte Tests haben [Verlauf, Vergleich und Wiederherstellung](./organizing#history-and-versions).
[Veröffentlichung und Prüfungen](./organizing#publishing-and-reviews) wählen die Revision, die Pläne
ausführen; das Speichern oder Wiederherstellen einer Arbeitskopie lässt eine bestehende
Veröffentlichung bestehen. Ein Debug-Lauf verwendet die gespeicherte mobile Arbeitskopie, die bei
der Anforderung des Laufs erfasst wird.

## Bedingungen, Schleifen und wiederverwendbare Gruppen

Der native Schritt-Editor unterstützt `if` / `else` / `endIf`, `repeat` / `repeatWhile` /
`endLoop` und `assertCondition`. Jeder Block muss geschlossen sein, bevor der Test gespeichert
werden kann. Mit einem Element liest eine Bedingung `visible`, `hidden`, `contains:text` oder
`text:text` sofort. Setzen Sie `waitFor` an den Anfang, wenn der Bildschirm noch lädt. Ohne Element
verwenden Sie einen Wertevergleich wie `{{status}} == Paid`, `{{total}} > 0`, `contains` oder
`not contains`.

`repeat` nimmt 1–200 Iterationen, auch eine Anzahl aus einer Umgebungsvariablen. `{{loopIndex}}`
beginnt bei 1; verschachtelte Schleifen stellen den äußeren Index wieder her, wenn sie enden. Ein
endloses `repeatWhile` scheitert nach 200 Iterationen. Der Runner begrenzt außerdem expandierte
Schritte auf 2.000 und die insgesamt ausgeführten Schrittbesuche auf 10.000 pro Gerät. Berichte
nennen Gruppe und Iteration, wenn sich ein Schritt wiederholt.

**Wiederverwendbare mobile Gruppen** auf der Seite Mobile Apps enthält benannte native Abläufe für
eine Plattform. Legen Sie eine Gruppe an und wählen Sie dann **Mobile Gruppe aufrufen** in einem
Test. Gruppen können vollständige Ablaufblöcke enthalten, aber keine anderen Gruppen aufrufen. Das
Projekt bestimmt, wer eine Gruppe sehen und bearbeiten darf. Eine referenzierte Gruppe kann weder
gelöscht noch auf eine andere Plattform umgestellt werden. Fehlende oder unzugängliche
Abhängigkeiten führen zu einem ausdrücklichen Fehler. Änderungen gelten für folgende Läufe; bereits
eingereihte Läufe und Wiederholungen behalten den aufgelösten Gruppeninhalt aus ihrem Snapshot.

## Geräte-/OS-Matrix

Fügen Sie im Testeditor unter **Gerätematrix** bis zu 20 verschiedene Paare hinzu. Eine leere
Matrix verwendet das bestehende Standardgerät und -betriebssystem. Eine nicht leere Matrix ist die
vollständige Zielliste; der Standard wird nicht angehängt. App, Plattform und Grid sind gemeinsam.
Verwenden Sie getrennte Android- und iOS-Tests für unterschiedliche App-Binärdateien oder native
Locators.

**Ausführen** verwendet das Standardgerät; **Gerätematrix ausführen** reiht alle konfigurierten
Ziele ein und verfolgt jedes Ergebnis getrennt. Eigenständige Ziele laufen nacheinander; ein
fehlgeschlagenes Ziel hindert die folgenden nicht am Laufen. Ein aufgebrauchtes Ausführungsbudget
lehnt die Annahme ab, bevor ein Ziel eingereiht wird. Ein während der Ausführung erschöpftes Budget
wird als Ausführungsfehler gemeldet.

Testpläne verwenden die Matrix automatisch. Jedes Ziel hat sein eigenes Ergebnis, eigene
Wiederholungen, einen eigenen Screenshot und Sitzungslink, unabhängig von
Webbrowser-/Sprachkombinationen. Bestehende Parallelität, Quarantäne und Stopp-Richtlinien des Plans
gelten weiterhin.

## Mobile Katalogdateien

**Tests als Dateien** exportiert Web-, API- und native Tests in einem YAML-/JSON-Paket der
Version 2. Mobile Exporte enthalten die Gerätematrix und die referenzierten nativen Gruppen.
Gruppenaufrufe verwenden Schlüssel aus Plattform und Name und werden beim Import auf die Ziel-IDs
umgeschrieben. Die Vorschau prüft Abhängigkeiten, ohne Tests, Gruppen, Versionen oder
Audit-Einträge anzulegen. Geänderte native Definitionen erzeugen eine neue Testversion;
unveränderte Importe nicht. Pakete der Version 1 bleiben lesbar. Gherkin exportiert nur Webtests.

Neue Importe gehen in das ausgewählte bearbeitbare Projekt; bestehende Tests und Gruppen behalten
ihre Projekte, und bestehende Tests behalten ihr Grid. Konfigurieren Sie nach dem Import ein Grid
für neue native Tests. App-Referenzen bleiben so erhalten, wie sie geschrieben sind:
Cloud-Upload-Kennungen und lokale Pfade können erfordern, dass die App am Ziel hochgeladen oder
konfiguriert wird. Der Katalog enthält Definitionen, keine App-Binärdateien oder
Ausführungsartefakte.
