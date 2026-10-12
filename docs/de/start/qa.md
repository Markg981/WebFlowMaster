# Ihr erster Test in 10 Minuten

Für Tester. Sie brauchen ein Konto mit der Rolle **Bearbeiter** (bitten Sie einen Eigentümer Ihrer
Organisation um eine Einladung) und die Adresse einer Webanwendung zum Testen. Für einen ersten
Versuch genügt jede öffentliche Seite.

## 1. Anmelden (1 Minute)

Öffnen Sie den Einladungslink, wählen Sie ein Passwort und melden Sie sich an. Nutzt Ihre
Organisation Single Sign-on, wählen Sie **Mit SSO anmelden** und geben Ihre geschäftliche Adresse
ein; verlangt sie Zwei-Faktor-Authentifizierung, richten Sie diese ein, wenn Sie dazu aufgefordert
werden. Details: [Anmelden](../guide/#anmelden).

## 2. Ein Projekt für den Test (1 Minute)

**Einstellungen → Projekte**: Geben Sie den Namen der Anwendung in **Name des neuen Projekts** ein
und klicken Sie auf **Projekt erstellen**. Überspringen Sie den Schritt, wenn das Projekt schon
existiert, oder legen Sie es später im Speichern-Dialog an (**Neues Projekt erstellen**). Projekte
halten die Bibliothek ordentlich und bündeln gemeinsam genutzte Elemente
([Projekte und Umgebungen](../guide/#projekte-und-umgebungen)).

## 3. Den Test bauen (4 Minuten)

1. Öffnen Sie **Test erstellen**, geben Sie die Adresse in **URL der zu testenden Website** ein und
   klicken Sie auf **Website laden**. Ein Screenshot der Seite erscheint.
2. Klicken Sie auf **Elemente erkennen**: Schaltflächen, Felder und Links der Seite werden mit ihren
   Selektoren aufgelistet.
3. Ziehen Sie **Text eingeben** aus **Verfügbare Aktionen** in die **Testsequenz**, legen Sie
   darauf ein Feld aus **Erkannte Elemente** ab und geben Sie den Wert ein.
4. Fügen Sie **Element anklicken** für die Schaltfläche hinzu, dann **Text prüfen** mit
   einem Element und dem Text, den Sie danach erwarten. Ein Test ohne Prüfung beweist nur, dass die
   Seite nicht abgestürzt ist.
5. Klicken Sie auf **Test ausführen** und sehen Sie zu, wie jeder Schritt grün wird.

Lieber aufzeichnen? **Benutzeraktionen aufzeichnen** auf derselben Seite öffnet ein Browserfenster
und macht aus Ihren Klicks und Eingaben Schritte; es braucht einen Bildschirm und funktioniert
daher, wenn WebFlowMaster auf Ihrem eigenen Rechner läuft ([Aufzeichnen](../guide/web-tests#aufzeichnen)).
Lieber in Worten? Beschreiben Sie den Test in Sätzen
([Einen Test in Sätzen beschreiben](../guide/web-tests#einen-test-in-satzen-beschreiben)).

## 4. Speichern (30 Sekunden)

**Test speichern**, geben Sie ihm einen Namen, den ein Kollege versteht („Anmeldung mit gültigem
Konto“), und wählen Sie das Projekt.

## 5. In einen Plan aufnehmen und ausführen (2 Minuten)

1. **Testpläne → + Testplan**: Benennen Sie den Plan („Smoke“), fügen Sie den Test hinzu, behalten
   Sie den Standardbrowser.
2. Klicken Sie auf **Ausführen**. Der Lauf wird in die Warteschlange gestellt, von einem Worker
   übernommen und ausgeführt.

## 6. Den Bericht lesen (1 Minute)

Öffnen Sie den Lauf, wenn er fertig ist, über den Plan oder über **Berichte**. Jeder Test zeigt
seine Schritte, einen Screenshot zu jedem, ihre Dauer und bei einem Fehler den fehlgeschlagenen
Schritt und den Grund ([Ergebnisse](../guide/results)).

## Wie es weitergeht

- Jede Nacht ausführen: **Planung → Zeitplan erstellen**
  ([Zeitplanung](../guide/running#zeitplanung)).
- Derselbe Test gegen Staging und Produktion: Legen Sie die Adresse in einer
  [Umgebung](../guide/web-tests#variables-and-environments) ab und schreiben Sie
  <code v-pre>{{baseUrl}}</code>.
- Viele Datenzeilen: [Datasets](../guide/web-tests#datasets).
- Ihre API, Ihre mobile App: [API-Tests](../guide/api-tests), [Mobile Apps](../guide/mobile-apps).
- An die Pipeline übergeben: [Ihr erster Lauf aus einer Pipeline](./devops).
