# Ihr erster Lauf aus einer Pipeline

Für DevOps- und Release-Engineers. Am Ende startet ein CI-Job einen WebFlowMaster-Testplan, wartet
auf ihn, lässt den Build scheitern, wenn der Plan scheitert, und veröffentlicht die Ergebnisse im
Testbericht des CI-Systems. Sie brauchen einen Plan, der von Hand gestartet bereits besteht
([Ihr erster Test in 10 Minuten](./qa)), und einen **Eigentümer**, der das Dienstkonto anlegt, oder
die Eigentümerrolle selbst.

## 1. Ein Dienstkonto und sein Schlüssel (5 Minuten)

Eine Pipeline darf nicht vom Konto einer einzelnen Person abhängen.

1. **Einstellungen → API-Schlüssel**, Karte **Dienstkonten**: ein Name nach der Pipeline
   („ci-shop“), Rolle **Bearbeiter** (Läufe starten erfordert mindestens diese), **Konto
   erstellen**.
2. In der Karte **API-Schlüssel** darüber: ein Name, **Ausgestellt für** das Dienstkonto, was der
   Schlüssel darf → _nur, was ich auswähle, über /api/v1_ mit **Ausführungen starten und
   abbrechen** (`runs:write`) und **Ausführungen, ihren Status und ihre JUnit-Berichte lesen**
   (`runs:read`); fügen Sie **Testpläne auflisten** (`plans:read`) hinzu, wenn der Job Pläne
   nachschlägt. Setzen Sie **Läuft ab in (Tagen)** auf das, was Ihre Rotationsrichtlinie zulässt,
   dann **Schlüssel erstellen**.
3. Kopieren Sie den Schlüssel unter **Kopieren Sie diesen Schlüssel jetzt**: Er wird **nur einmal**
   angezeigt und nur als Hash gespeichert.

Hinterlegen Sie ihn als Secret in Ihrem CI-System (`WFM_API_KEY`), niemals im Repository.
Hinterlegen Sie die Adresse des Servers als `WFM_URL` und die ID des Plans — auf der Seite des
Plans oder über `GET /api/v1/plans` — als `WFM_PLAN_ID`. Details:
[API keys and service accounts](/en/admin/administration#api-keys-and-service-accounts) (auf
Englisch).

## 2. Vom eigenen Rechner ausprobieren (3 Minuten)

Der Server liefert eine CLI aus, die immer zu seiner Version passt:

```bash
curl -fsSL "$WFM_URL/cli/wfm.mjs" -o wfm.mjs
node wfm.mjs run "$WFM_PLAN_ID" --wait --junit junit.xml
echo $?
```

**Der Exit-Code ist der Vertrag:** `0` der Plan ist bestanden, `1` er ist gescheitert (Fehler,
Abbruch und Zeitüberschreitung eingeschlossen), `2` der Schritt selbst konnte nicht ausgeführt
werden — falsche Adresse, ungültiger Schlüssel, Server nicht erreichbar. Fehlschläge von Tests in
Quarantäne lassen den Lauf nicht scheitern. Details: [The CLI](/en/integrations/ci#_2-the-cli) (auf
Englisch).

## 3. In die Pipeline aufnehmen (10 Minuten)

GitHub Actions, mit der Action aus dem Repository:

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: Markg981/WebFlowMaster/integrations/github-action@main
        with:
          url: ${{ vars.WFM_URL }}
          api-key: ${{ secrets.WFM_API_KEY }}
          plan: ${{ vars.WFM_PLAN_ID }}
          idempotency-key: ${{ github.run_id }}-${{ github.run_attempt }}
```

Sobald es funktioniert, heften Sie die Action an einen Release-Tag oder einen Commit statt an
`@main`. Für GitLab CI, Jenkins, Azure Pipelines, Bitbucket Pipelines und CircleCI gibt es fertige
Vorlagen, die genauso funktionieren:
[Running test plans from CI](/en/integrations/ci) (auf Englisch).

Der **Idempotenzschlüssel** sorgt dafür, dass ein wiederholter CI-Schritt dem bereits gestarteten
Lauf folgt, statt einen zweiten zu starten.

## 4. Das Ergebnis prüfen (2 Minuten)

Pushen Sie einen Commit. Der Job führt den Plan aus und:

- besteht oder scheitert mit dem Plan;
- schreibt `webflowmaster-junit.xml`, das der Testbericht des CI-Systems liest;
- sendet Repository, Commit, Branch und Build-Link mit dem Lauf, sodass der WebFlowMaster-Bericht
  auf den Build zurückverweist.

## Wie es weitergeht

- Nur die Tests, die eine Änderung betrifft: `changed-since` und die
  [Auswirkungskarte](../guide/running#impact).
- Ein Status am Commit oder Pull Request:
  [Commit status on GitHub and GitLab](/en/integrations/ci#_10-commit-status-on-github-and-gitlab)
  (auf Englisch).
- HTML-, PDF- oder Allure-Berichte als Build-Artefakte: die Eingaben `html`, `pdf` und `allure`.
- Anwendungen, die nur in Ihrem Netzwerk erreichbar sind:
  [Local agents](/en/integrations/local-agents) (auf Englisch).
- Alles Weitere, was die API kann: [REST API](/en/reference/api) (auf Englisch).
