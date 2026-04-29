# 🛡️ WebFlowMaster: Guida Amministratore Enterprise
> **Governance, Sicurezza e Manutenzione dell'Infrastruttura di Testing**

## 🎯 Obiettivo del Documento
Questa guida è destinata ai System Administrator, DevOps Engineer e IT Manager. Copre l'installazione avanzata, la gestione degli utenti, la sicurezza dei dati e l'integrazione con i flussi di lavoro aziendali.

---

## 📑 Sommario
1.  [Architettura di Sistema](#architettura)
2.  [Governance e RBAC (Role-Based Access Control)](#rbac)
3.  [Sicurezza e Protezione dei Dati](#sicurezza)
    *   [Crittografia AES-256](#crittografia)
    *   [Gestione Secret e API Keys](#secret)
4.  [Configurazione Worker e Scalabilità](#worker)
5.  [Integrazioni Enterprise (CI/CD, Webhooks)](#integrazioni)
6.  [Manutenzione e Disaster Recovery](#manutenzione)

---

<a name="architettura"></a>
## 1. 🏗️ Architettura di Sistema
WebFlowMaster è basato su un'architettura a micro-servizi:
- **Core Server**: Gestione API, logica di business e orchestrazione.
- **Worker Engine**: Istanze isolate per l'esecuzione dei test (basate su Playwright/Puppeteer).
- **Persistence Layer**: Database SQL per i metadati e Redis per le code di messaggi (BullMQ).
- **Storage Layer**: Sistema dedicato per la conservazione di screenshot e trace video.

---

<a name="rbac"></a>
## 2. 👥 Governance e RBAC (Role-Based Access Control)
La gestione degli accessi è granulare. Ogni utente appartiene a un ruolo con permessi predefiniti:

| Permesso | Super Admin | Manager | Tester | Viewer |
| :--- | :---: | :---: | :---: | :---: |
| Gestione Utenti | ✅ | ❌ | ❌ | ❌ |
| Configurazione System | ✅ | ❌ | ❌ | ❌ |
| Creazione Progetti | ✅ | ✅ | ❌ | ❌ |
| Creazione Test | ✅ | ✅ | ✅ | ❌ |
| Esecuzione Test | ✅ | ✅ | ✅ | ❌ |
| Visualizzazione Report | ✅ | ✅ | ✅ | ✅ |

**Best Practice:** Utilizzare il ruolo `Viewer` per gli stakeholder che devono solo monitorare i risultati senza rischiare di modificare le suite di test.

---

<a name="sicurezza"></a>
## 3. 🔐 Sicurezza e Protezione dei Dati

<a name="crittografia"></a>
### A. Crittografia AES-256
Tutte le credenziali salvate nella piattaforma (es. password degli utenti per i login dei test) vengono criptate a riposo utilizzando lo standard AES-256-GCM. La chiave di crittografia master deve essere gestita tramite variabili d'ambiente protette.

<a name="secret"></a>
### B. Gestione Secret e API Keys
Le API Keys generate per l'integrazione CI/CD devono essere ruotate ogni 90 giorni. WebFlowMaster supporta l'oscuramento automatico (masking) dei secret nei log di esecuzione per evitare fughe di dati accidentali.

---

<a name="worker"></a>
## 4. ⚙️ Configurazione Worker e Scalabilità
I Worker sono il motore computazionale. In ambienti ad alto carico, è possibile scalare orizzontalmente aggiungendo più Worker.
- **Concurrency**: Ogni worker può gestire un numero limitato di istanze browser parallele (consigliato: 2 per ogni core della CPU).
- **Sandbox**: Ogni esecuzione avviene in un contesto browser vergine per evitare contaminazioni di cache o cookie.

---

<a name="integrazioni"></a>
## 5. 🔌 Integrazioni Enterprise (CI/CD, Webhooks)

### Integrazione Pipeline (GitHub/Jenkins/GitLab)
WebFlowMaster espone un set di API RESTful per l'innesco dei test. 
**Esempio di integrazione con GitHub Actions:**
```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger WebFlowMaster Test
        run: |
          curl -X POST "https://webflow-api.company.com/v1/execute" \
          -H "Authorization: Bearer ${{ secrets.WFM_TOKEN }}" \
          -d '{"planId": "prod-smoke-test"}'
```

### Webhook Event-Driven
Configura i Webhook per notificare sistemi esterni (Slack, Microsoft Teams, Jira) al fallimento di un test critico.

---

<a name="manutenzione"></a>
## 6. 🛠️ Manutenzione e Disaster Recovery
- **Database Backups**: Si consiglia un backup giornaliero del DB SQL.
- **Log Rotation**: I log di sistema vengono ruotati quotidianamente e conservati per 30 giorni.
- **Health Checks**: Monitorare costantemente l'endpoint `/api/health` per verificare lo stato di tutti i servizi (DB, Redis, Worker).

---
© 2026 WebFlowMaster Enterprise. Documento ad uso interno.
