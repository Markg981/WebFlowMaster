# Einstieg

WebFlowMaster testet Webanwendungen, HTTP- und native API-Protokolle, mobile Apps und
BDD-Szenarien. Sie bauen einen Test, indem Sie ihn aufzeichnen, Schritte ziehen oder ihn in Sätzen
beschreiben; Sie fassen Tests in **Plänen** zusammen; Pläne laufen auf Abruf, nach Zeitplan oder aus
einer CI-Pipeline, in einem oder mehreren Browsern; und jeder Lauf hinterlässt einen **Bericht** mit
Screenshots, Zeiten und, wenn gewünscht, einem Video, einem Playwright-Trace und dem
Netzwerkverkehr.

Eilig? [Ihr erster Test in 10 Minuten](../start/qa) ist der kurze Weg; diese Seite ist der
vollständige.

Dieses Handbuch richtet sich an alle, die Tests schreiben und ausführen. Wie man eine Installation
einrichtet und eine Organisation verwaltet, steht unter [Administration](/en/admin/administration)
(auf Englisch). Für die Ausführung auf Geräten lesen Sie [Mobile Apps](./mobile-apps); für manuelle
Szenarien oder dediziertes Cucumber lesen Sie [BDD tests](./bdd-tests). Mobile und Cucumber nutzen
eigene Ausführungsziele statt der Browser-Matrix.

## Anmelden

Melden Sie sich mit dem Benutzernamen und Passwort an, die Ihnen der Eigentümer Ihrer Organisation
gegeben hat, meist über einen Einladungslink. Je nachdem, wie Ihre Organisation eingerichtet ist:

- **Zwei-Faktor-Authentifizierung**: Nach dem Passwort werden Sie nach einem sechsstelligen Code aus
  Ihrer Authenticator-App gefragt. Verlangt Ihre Organisation sie und haben Sie sie noch nicht
  eingerichtet, fordert die Anwendung Sie zuerst dazu auf (**Einstellungen → Sicherheit**).
- **Single Sign-on**: Wählen Sie **Mit SSO anmelden**, geben Sie Ihre geschäftliche E-Mail-Adresse
  ein und melden Sie sich beim Identitätsanbieter Ihres Unternehmens an. Steht auf der
  Anmeldeseite, dass sich Ihre Organisation per Single Sign-on anmeldet, funktioniert Ihr Passwort
  dort nicht mehr: Verwenden Sie diese Schaltfläche.

Passwort vergessen? Bitten Sie einen Eigentümer Ihrer Organisation um einen Link zum Zurücksetzen.

**Mehr als eine Organisation?** Der Eigentümer einer anderen Organisation kann Ihren bestehenden
Benutzernamen einladen; öffnen Sie den Einladungslink, während Sie angemeldet sind, und nehmen Sie
an — die Organisation wird Ihrem Konto hinzugefügt. In der Kopfzeile erscheint dann neben der Suche
ein Organisationsmenü: Wählen Sie eine aus, und die ganze Anwendung zeigt diese Organisation — ihre
Tests, Pläne, Läufe und Einstellungen, mit der Rolle, die Sie dort haben — und nichts von den
anderen. Wo Single Sign-on auf einer verifizierten Domäne eingerichtet ist, werden Sie durch die
Anmeldung über den Anbieter dieser Organisation ebenfalls Mitglied.

## Sich zurechtfinden

![Das Dashboard: Läufe, Trends und Zeitpläne, links die Seitenleiste](/screenshots/dashboard.webp)

Die Seitenleiste enthält alles:

| Bereich            | Wofür er da ist                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Übersicht**      | Private und geteilte Ansichten von Läufen, Trends und Zeitplänen. Siehe [Gespräche und Dashboards](./collaboration). |
| **API-Tester**     | API-Tests bauen und speichern. Siehe [API-Tests](./api-tests).                                                       |
| **Mobile Apps**    | Definitionen nativer Apps, Inspector und Ausführung auf Geräten. Siehe [Mobile Apps](./mobile-apps).                 |
| **Test erstellen** | Der Testbaukasten für Webtests. Siehe [Webtests](./web-tests).                                                       |
| **Testbibliothek** | Jeder gespeicherte Test, mit Tags und Verlauf. Siehe [Tests organisieren](./organizing).                             |
| **Testmanager**    | Testfälle aus Excel importieren und gespeicherten Tests zuordnen.                                                    |
| **Suiten**         | Listen von Tests, die mehrere Pläne gemeinsam nutzen.                                                                |
| **Testpläne**      | Was wo und wie ausgeführt wird; die Schaltfläche **Ausführen**. Siehe [Tests ausführen](./running).                  |
| **Prüfungen**      | Änderungen, die auf Freigabe warten, wenn Ihre Organisation Tests vor dem Ausführen prüft.                           |
| **Planung**        | Pläne, die von selbst laufen.                                                                                        |
| **Berichte**       | Jeder abgeschlossene Lauf, instabile Tests und die Quarantäne. Siehe [Ergebnisse](./results).                        |
| **Einstellungen**  | Ihre Vorlieben und Ihr Passwort und, je nach Rolle, Umgebungen, Projekte, Mitglieder, Schlüssel und der Rest.        |

**Strg+K** (**⌘K** auf dem Mac) oder **Suchen** in der oberen Leiste öffnet von jeder Seite aus die
Befehlspalette: Tippen Sie einen Teil eines Namens, um zu einer Seite zu gehen, einen Testplan
auszuführen, zwischen hellem und dunklem Design zu wechseln oder sich abzumelden. Pläne werden nur
Bearbeitern und Eigentümern angeboten, die einen Lauf starten können.

**Neuigkeiten** im Kontomenü (der Kreis mit Ihren Initialen oben rechts) und in der Befehlspalette
listet, was sich in dieser Installation geändert hat, neueste zuerst, mit einem Link zum Pull
Request jeder Änderung: Es ist die `CHANGELOG.md`, die die Installation enthält, und beschreibt also
die Version, die Sie verwenden. Ein Punkt auf dem Kreis zeigt Änderungen, die Sie noch nicht gelesen
haben; das Öffnen der Seite entfernt ihn, in diesem Browser.

Das **?** in der oberen Leiste öffnet dieses Handbuch in einem neuen Tab bei dem Abschnitt über die
Seite, auf der Sie sind (**Hilfe zu dieser Seite** in der Befehlspalette tut dasselbe). Das Handbuch
ist in Ihrer Sprache, wo es übersetzt ist, sonst auf Englisch; die Installation liefert es selbst
aus, es beschreibt also die Version, die Sie verwenden, und funktioniert ohne Internetzugang.

Auf einem Telefon ist die Seitenleiste ausgeblendet: Die Schaltfläche **Menü** (☰) links in der
oberen Leiste öffnet sie als Schublade, die sich schließt, sobald Sie eine Seite wählen oder **Esc**
drücken. Die Seiten zum Lesen — das Dashboard, **Berichte** und der Bericht eines Laufs — passen in
die Breite eines Telefons oder Tablets; breite Tabellen scrollen seitlich in ihrem eigenen Rahmen.
Tests und Pläne bauen ist für einen Computer gedacht.

Was Sie tun können, hängt von Ihrer **Rolle** ab: Betrachter lesen Tests und Ergebnisse; Bearbeiter
können sie außerdem erstellen, ändern und ausführen; Eigentümer verwalten zusätzlich die
Organisation. Schaltflächen, die Sie nicht verwenden können, sind ausgeblendet oder deaktiviert.

## Projekte und Umgebungen

Zwei Dinge lohnen sich vor dem ersten Test, unter **Einstellungen**:

- Ein **Projekt** fasst die Tests einer Anwendung zusammen. Es hält die Testbibliothek ordentlich,
  und dort bewahrt das [Element-Repository](./web-tests#element-repository) gemeinsam genutzte
  Elemente auf. Ein Eigentümer kann ein Projekt auf einige Mitglieder beschränken.
- Eine **Umgebung** (Staging, Produktion…) enthält die Werte, die ein Test auf diesem Ziel braucht —
  seine Adresse, Benutzernamen, Passwörter — als verschlüsselte **Geheimnisse**. Tests verweisen
  darauf mit <code v-pre>{{name}}</code>, sodass derselbe Test je nach gewählter Umgebung gegen
  Staging oder Produktion läuft. Siehe
  [Variablen und Umgebungen](./web-tests#variables-and-environments).

## Mit einem Beispielprojekt beginnen

Das Dashboard einer neuen Organisation bietet Editoren und Ownern **Mit einem Beispielprojekt
beginnen** an, solange die Organisation keine eigenen Tests hat. **Beispielprojekt anlegen** fügt
das Projekt _Northwind Shop (sample)_ hinzu: fünf Web-Tests und drei API-Tests gegen einen kleinen
Kaffeeshop, den diese Installation selbst unter `/demo-shop` bereitstellt, und vier Pläne, die sie
ausführen. Der erste Plan, _Sample · Checkout smoke_, startet sofort, und der Bericht dieses Laufs
öffnet sich: Nach einer Minute sehen Sie einen echten Lauf. Die übrigen stehen unter
**Test plans**: _Storefront regression_ führt alle Abläufe in Chromium, Firefox und WebKit aus,
_Orders API contract_ legt eine Bestellung an und liest sie mit der Nummer aus dem ersten Aufruf
wieder, und _Catalog checks (fails on purpose)_ scheitert an der Banner-Prüfung, um zu zeigen, wie
ein Fehlschlag aussieht: der Schritt, der Screenshot, das Video und der Trace.

Alles daran ist gewöhnlich: Ändern Sie die Tests, führen Sie die Pläne aus, löschen Sie Projekt und
Tests, wenn Sie sie nicht mehr brauchen. **Später** blendet das Angebot aus, in diesem Browser. Wenn
Ihre Organisation Tests vor der Ausführung prüft, startet der erste Lauf nicht: Veröffentlichen Sie
die Beispieltests und führen Sie dann die Pläne aus. Erreichen die Läufe den Shop nicht, setzt ein
Administrator `DEMO_SHOP_URL` ([Konfiguration](/en/admin/configuration)).

## Ihr erster Test, von Anfang bis Ende

1. **Test erstellen**: Geben Sie die Adresse der Anwendung ein, **Website laden**, dann **Elemente
   erkennen**.
2. Ziehen Sie Aktionen in die **Testsequenz** und geben Sie jeder ihr Element, oder zeichnen Sie sie
   auf. Klicken Sie auf **Test ausführen**, um ihm zuzusehen.
3. **Test speichern**, in einem Projekt.
4. **Testpläne → + Testplan**: Benennen Sie den Plan und fügen Sie den Test hinzu.
5. **Ausführen** Sie den Plan und öffnen Sie den Bericht, wenn er fertig ist.
6. Wenn er zuverlässig besteht, **Planung → Zeitplan erstellen**, um ihn jede Nacht auszuführen,
   oder führen Sie ihn aus Ihrer Pipeline aus ([CI integration](/en/integrations/ci), auf
   Englisch).

## Persönliche Einstellungen

**Einstellungen → Einstellungen** enthält die Sprache der Oberfläche (English, Italiano, Français,
Deutsch) und das Design; **Einstellungen → Standardwerte** den Browser und die Zeitlimits, die der
Testbaukasten verwendet. **Einstellungen → Sicherheit** enthält Ihren zweiten Faktor und
**Einstellungen → Konto** Ihr Passwort.
