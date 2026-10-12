# BDD-Tests mit Gherkin und Cucumber

Gherkin ist eine lesbare Beschreibung von Verhalten. WebFlowMaster speichert seine Quelle und die
Szenarioauswahl zusammen mit einem Test, mit zwei Ausführungsarten: **Manuell**, bei der eine
Person die Ergebnisse festhält, und **Cucumber**, die ein vom Betreiber bereitgestelltes
Support-Projekt auf einem lokalen Agenten ausführt. Der Import einer `.feature`-Datei implementiert
ihre Schritte nicht automatisch.

## Die Ausführungsart vor dem Import wählen

Verwenden Sie die manuelle Art, wenn das Szenario ein menschliches Abnahmeverfahren beschreibt oder
die Step-Definitionen noch nicht implementiert sind. Verwenden Sie Cucumber, wenn das Team bereits
ausführbare Step-Definitionen besitzt und ein Plattformbetreiber deren fixierte Abhängigkeiten auf
einem Agenten installieren kann.

BDD-Definitionen nutzen intern die Test- und Versionsbibliothek der Oberfläche. Zu ihrer Identität
gehören Quelle, Dialekt, logischer `.feature`-Dateiname, Szenariozeile und bei einem Outline die
ausgewählte Examples-Zeile. Backgrounds, Rules, Tags, DocStrings und DataTables werden als Gherkin
geparst, statt zu Browser-Selektoren abgeflacht zu werden. Halten Sie Quelle und Auswahl beim
Bearbeiten konsistent.

## Cucumber-Ausführung vorbereiten

1. Der Betreiber stellt einen autorisierten lokalen Agenten mit einem Support-Projekt und einem
   `WFM_BDD_PROFILES`-Manifest bereit. Installieren Sie das BDD-Child-Bundle neben dem Agenten. Die
   gepflegten JS-/TS-Beispiele und der isolierte Container liegen in `deployment/bdd-agent/`.
2. Der Agent kündigt einen Pool, eine Betreiber-Profil-ID und eine exakte Revision an. Eine
   Revision kennzeichnet die installierte Support-Implementierung; einen Dateinamen im Feature zu
   ändern, installiert keinen Code.
3. Ein Eigentümer öffnet **Einstellungen → Lokale Agenten** und legt aus einem angekündigten Ziel
   ein **Cucumber-Ausführungsprofil** an. Wählen Sie organisationsweiten oder projektspezifischen
   Zugriff und das Zeitlimit. Profil-Zeitlimits werden zwischen 1 und 300 Sekunden geprüft. Pool
   und Identität des Betreiberprofils sind bei einer Aktualisierung unveränderlich; legen Sie für
   ein anderes Ziel eine neue Bindung an.
4. Der Bearbeiter wählt beim Importieren oder Bearbeiten des BDD-Tests ein autorisiertes Profil und
   seine Revision. Veröffentlichen Sie über den normalen Prüf- und Versionsablauf, wenn der Plan
   veröffentlichte Tests verwendet.

Siehe [Einrichtung lokaler Agenten](/en/integrations/local-agents) (auf Englisch). Den Step-Code
eines Kunden bereitzustellen, ist Aufgabe des Betreibers; der Feature-Import überträgt Quelltext,
keine beliebige ausführbare Support-Datei.

## Importieren, bearbeiten und teilen

Wählen Sie in **Testbibliothek → Dateien** die Gherkin-Eingabe und prüfen Sie die Vorschau vor dem
Import. Ein Outline kann mehrere ausgewählte Szenario- bzw. Beispieldefinitionen erzeugen. Prüfen
Sie Projekt, Ausführungsart und Bindung, statt anzunehmen, dass eine Bindung aus einer anderen
Installation hier weiterhin autorisiert ist. Der Import verlangt für die Cucumber-Ausführung eine
Zielbindung.

Bei einem gespeicherten BDD-Test öffnet **Gherkin bearbeiten** den Quelltext-Editor. Ändern Sie
Quelle und Szenario- bzw. Beispielzeile gemeinsam; beim Speichern wird die Quelle neu geparst und
ihre Schritte werden neu erzeugt. Wählen Sie dort die manuelle oder die Cucumber-Ausführung.
BDD-Schritte werden innerhalb der Definition von der Quelle gesteuert: Der gewöhnliche
Schritt-Editor kann sie nicht unabhängig ändern. Die Umwandlung in gewöhnliche manuelle Schritte ist
eine eigene, bewusste Aktion; speichern Sie zuerst die Quelländerungen, wenn diese Umwandlung nötig
ist.

Die CLI kann Gherkin mit einem ausdrücklichen Cucumber-Ziel importieren:

```sh
npm run cli -- tests import scenarios.feature --dry-run --bdd-mode cucumber --bdd-profile DESTINATION_UUID --bdd-revision SUPPORT_REVISION
```

Prüfen Sie den Probelauf, bevor Sie `--dry-run` entfernen. Siehe
[CLI-Referenz](/en/reference/cli) (auf Englisch) und [Tests als Dateien](./organizing).
Gherkin-Export ist für Oberflächen- und BDD-Tests gedacht, nicht für API- oder
Mobile-Definitionen; exportieren Sie jeweils einen Dialekt. Quellbewahrende WebFlowMaster-Metadaten
und Zielbindung sind verschiedene Verträge: Metadaten autorisieren nicht das Ausführungsziel der
Quellinstallation.

## Ausführen und den Bericht deuten

Fügen Sie den Test wie gewohnt einem Plan oder einer Suite hinzu. Cucumber-Einheiten laufen
unabhängig von der Browser-Matrix des Plans; Dataset-Zeilen können eigene Einheiten erzeugen. Der
Worker löst die exakte autorisierte Bindung auf, führt die Vorbedingungen über den Agenten aus,
ruft Cucumber auf und versucht danach aufzuräumen. Eine fehlgeschlagene Vorbedingung kann die
Ausführung je nach Plan-Richtlinie blockieren oder überspringen. Das Aufräumen wird trotzdem
berichtet.

Der Bericht enthält die Status der Cucumber-Schritte und -Hooks, Dauer, Fehler und begrenzte
Textanhänge. Undefinierte, ausstehende oder fehlgeschlagene Schritte ergeben kein bestandenes
Szenario. Die manuelle Art verlangt stattdessen, dass ein Mensch das Ergebnis einträgt. Keine der
beiden Arten verspricht Browser-Video oder Trace für beliebigen Support-Code; wählen Sie den
Nachweismechanismus, den Ihr Support-Projekt und der Plattformvertrag tatsächlich bieten.

Secrets werden aus den normalisierten Nachweisen geschwärzt, und die Ausgabe ist begrenzt.
Quellimporte sind auf 20 MiB begrenzt, mit weiteren Budgets für Tests, Schritte und gespeicherte
Ausgabe. Zu große Ausführungsnachweise können zu einem Fehler mit verworfenen Nachweisen führen
statt zu einem unbegrenzten Bericht.

## Fehlerbehebung

| Symptom                                                         | Zu prüfen                                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Kein Profil verfügbar                                           | Agent ist verbunden, Manifest ist gültig, Pool- und Organisationszugangsdaten stimmen                |
| Bindung abgelehnt                                               | Zielprojekt bzw. -organisation erlaubt sie und die exakte Profilrevision passt noch                  |
| Szenario nicht gefunden                                         | Szenariozeile und Examples-Zeile passen zur bearbeiteten Quelle und zum Dialekt                      |
| Undefinierte Schritte                                           | Der Betreiber hat das vorgesehene Support-Projekt und die Abhängigkeiten dieser Revision installiert |
| Lauf scheitert vor Cucumber                                     | Vorbedingungen, freie Agenten-Slots, Konnektivität und Zeitlimit                                     |
| Profil aktualisiert, aber alter veröffentlichter Test scheitert | Definition an die neue Revision binden und neu veröffentlichen                                       |

Zu den Grenzen der Implementierung lesen Sie das [Suite handbook](/en/internals/suite-handbook)
(auf Englisch). Halten Sie bei der Abnahme einer Integration Profil und Revision, Agentenumgebung
und den tatsächlichen Bericht fest.
