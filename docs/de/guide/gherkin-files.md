# Gherkin-/Cucumber-Dateien

Die CLI nutzt denselben Import- und Exportablauf mit einem API-Schlüssel mit Vollzugriff:

```sh
wfm tests export --project 12 --format gherkin --out specs/shop.feature
wfm tests import specs/shop.feature --project 12 --dry-run
wfm tests import specs/shop.feature --project 12
```

Der Import erkennt Gherkin am Inhalt; `--format` ist nicht nötig. Der Export verwendet den
Dateinamen des Servers, sofern `--out` nicht angegeben ist, mit `tests.feature` als Rückfallwert.

Wählen Sie in **Tests als Dateien** **Gherkin**, um Webtests in eine `.feature`-Datei zu
exportieren. API-Tests sind ausgenommen; YAML-/JSON-Pakete enthalten weiterhin beide Arten.
Importieren Sie eine `.feature`-Datei oder wählen Sie Gherkin, bevor Sie Text einfügen, sehen Sie
sich die Änderungen in der Vorschau an und importieren Sie dann. Vorhandene Namen werden mit einer
neuen Version aktualisiert; neue Tests verwenden das ausgewählte Projekt. Der Zugriff folgt den
Rollen der Organisation und der Sichtbarkeit der Projekte.

Der offizielle Gherkin-Parser unterstützt jeden offiziellen Dialekt über `# language:`, `Rule`,
Backgrounds von Feature und Rule, Beschreibungen, getaggte Examples, Doc Strings und maskierte
DataTables. Jede Examples-Zeile erzeugt einen eigenen Test mit dem Selektor ihrer ursprünglichen
Quellposition. Strukturierte Argumente und geerbte Tags bleiben bei den Schritten.

Wählen Sie die Ausführung **Manuell**, um Prosa und Argumente für das Urteil eines Testers zu
behalten, oder **Cucumber** mit einem autorisierten Profil, um echte
JavaScript-/TypeScript-Definitionen auf dem dedizierten Agenten Ihrer Organisation auszuführen. Der
Import erzeugt weder Definitionen noch Browseraktionen. `this.parameters` der World enthält die
Variablen des Laufs. Pläne laufen einmal pro gespeichertem Szenario bzw. Dataset-Zeile, unabhängig
von der Browser-/Sprachmatrix. Undefinierte, mehrdeutige, ausstehende, übersprungene und
fehlgeschlagene Schritte und Hooks zählen nie als bestanden.

Ein Betreiber installiert Cucumber.js **12.9.0**, Support-Dateien und Abhängigkeiten und startet
dann den Agenten **1.3.0** mit `WFM_BDD_PROFILES`, das auf sein Manifest zeigt. Angekündigt werden
nur öffentliche Profil-IDs, Bezeichnungen, Revisionen und Grenzen. Ein Eigentümer der
Organisation verknüpft ein angekündigtes Profil und einen Pool mit der Organisation oder einem
Projekt. Pfade zu ausführbaren Dateien, Befehle und Loader bleiben Betreiberkonfiguration. Siehe
`deployment/bdd-agent/README.md` für Bereitstellung und Projektaufbau. Prozessgrenzen und der
mitgelieferte dedizierte Container sind betriebliche Isolation; Node ist keine Sandbox für
feindseligen Support-Code.

Portable ausführbare Importe erfordern eine ausdrückliche Bindung an ein autorisiertes Ziel. Beim
Import über die CLI fügen Sie
`--bdd-mode cucumber --bdd-profile DESTINATION_UUID --bdd-revision SUPPORT_REVISION` hinzu;
verwenden Sie eine Bindung aus `/api/bdd/profiles`, prüfen Sie mit `--dry-run` und wiederholen Sie
dann ohne. YAML-/JSON-Pakete behalten ebenfalls BDD-Definitionen. Fehlende oder widerrufene
Profile oder nicht passende Revisionen scheitern, bevor Support-Module geladen werden.
Veröffentlichte Testversionen behalten ihre Feature-Quelle und die angeheftete Support-Revision.

WebFlowMaster-Exporte enthalten `# wfm-test:`-Metadaten, die die ursprünglichen Aktionen, die
BDD-Konfiguration und die Felder bewahren, einschließlich Datasets, Vorbereitung und Aufräumen.
Lesbare Schritte, strukturierte Argumente, Tags und Rule-Kontext müssen zu den Metadaten passen.
Entfernen Sie die Metadaten eines Szenarios, bevor Sie bearbeitete Prosa ausdrücklich importieren.
Ausgewählte BDD-Exporte enthalten nur die gewählten Szenarien bzw. Examples-Zeilen; ein Outline mit
genau einer Zeile bewahrt Leerraum und mehrzeilige Argumente, die sonst nicht darstellbar wären.
Exportieren Sie einen Dialekt pro Datei. Szenarien ohne Rule stehen vor den Rules, weil Gherkin
keine Endmarke für Rule kennt.

Dateien sind auf **20 MiB**, **2.000** expandierte Tests, **100.000** Schritte und **64 MiB**
insgesamt gespeicherte Quell- und Argumentexpansion begrenzt. Zur Laufzeit gelten
**300 Sekunden**, **8 MiB** Ausgabe und **1 MiB** Anhänge insgesamt. Nur Klartext-Anhänge werden
behalten; HTML- und Binäranhänge werden weggelassen. Berichte maskieren Text und schwärzen
Zugangsdaten und Variablen. Ein Test ohne Schritte kann nicht nach Gherkin exportiert werden.
Prüfen Sie Literalwerte, bevor Sie Dateien committen; Verweise auf Element-Repository, Gruppen und
benutzerdefinierte Aktionen bleiben installationsspezifisch.
