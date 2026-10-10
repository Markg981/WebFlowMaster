# Certificazione delle matrici reali

AUT-10…AUT-12, protocollo 36. I nuovi casi manuali rimangono **Da eseguire**; gli esiti automatici non modificano i cicli storici.

## Percorso locale e UI

La suite `npm run test:e2e` esegue tutti i percorsi UI su Chromium, Firefox e WebKit. `matrix-browser.spec.ts` salva e pubblica un test, avvia un piano dalla UI con tre motori, attende il worker e verifica i risultati persistiti, il report e le esportazioni HTML/JUnit. L'allegato `runtime-matrix` contiene i dati osservati.

Prerequisiti: `npm run build`, `npx playwright install chromium firefox webkit`, PostgreSQL dedicato `wfm_ci_e2e` su porta 5438, Redis dedicato `redis://127.0.0.1:6388`, migrazioni applicate e variabili SESSION_SECRET/ENCRYPTION_KEY. Usare `docker compose -p wfm-matrix-e2e -f e2e/docker-compose.yml up -d --wait` per gli store sacrificabili. Il ruolo applicativo deve essere non-superuser con CREATEROLE e BYPASSRLS per migrazione/worker; le richieste tenant usano app_user.

Avvio da PowerShell, nel repository. Creare ruolo/database soltanto alla prima preparazione degli store:

```powershell
docker compose -p wfm-matrix-e2e -f e2e/docker-compose.yml up -d --wait
docker exec wfm-matrix-e2e-postgres-1 psql -U postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE wfm_e2e LOGIN PASSWORD 'wfm_e2e' CREATEROLE BYPASSRLS;" -c "CREATE DATABASE wfm_ci_e2e OWNER wfm_e2e;"
$env:DATABASE_URL = 'postgresql://wfm_e2e:wfm_e2e@127.0.0.1:5438/wfm_ci_e2e'
$env:REDIS_URL = 'redis://127.0.0.1:6388'
$env:SESSION_SECRET = 'matrix-e2e-local-secret'
$env:ENCRYPTION_KEY = 'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1'
npm run build
node dist/apply-migrations.js
npx playwright install chromium firefox webkit
npm run test:e2e
```

Queste credenziali sono esclusivamente per la fixture sacrificabile. I processi E2E usano UTC per allineare i timestamp PostgreSQL e il recovery anche su Windows. Il report Playwright e gli allegati sono in `e2e-artifacts/report`; i log dei servizi in `e2e-artifacts/services`. Per arrestare gli store conservando i dati: `docker compose -p wfm-matrix-e2e -f e2e/docker-compose.yml stop`.

Il report distingue esito funzionale e corrispondenza della configurazione: `matched`, `mismatch`, `unverified`. OS/versioni locali descrivono l'host del runner; OS release è la versione del kernel, non un nome commerciale. Safari richiesto ed eseguito con WebKit è una sostituzione dichiarata. Un telefono emulato nel browser non certifica un dispositivo nativo.

## Percorso reale griglia e Appium

Preparare un JSON privato fuori dal repository e impostare `WFM_MATRIX_CERTIFICATION_FILE` al suo percorso assoluto. Eseguire `npm run test:matrix:certify` con gli stessi store e bundle. Il comando richiede entrambe le configurazioni: senza file o infrastruttura reale fallisce; non salta i test. Non usare credenziali produttive. Le tracce di questo percorso sono disattivate perché la creazione della griglia invia credenziali.

Esempio da completare con una fixture pubblica raggiungibile dalla griglia e un'app reale installabile:

```json
{
  "web": {
    "grid": { "provider": "browserstack", "username": "YOUR_USER", "key": "YOUR_KEY" },
    "url": "https://your-fixture.example/matrix",
    "selector": "#matrix-title", "expected": "Matrix fixture",
    "machines": [
      { "browserName": "firefox", "os": "Windows", "osVersion": "11", "headless": true },
      { "browserName": "webkit", "os": "OS X", "osVersion": "Sonoma", "headless": true }
    ]
  },
  "mobile": {
    "grid": { "provider": "local_appium", "endpoint": "http://127.0.0.1:4723" },
    "test": {
      "platform": "android", "app": "C:\\apps\\fixture.apk",
      "deviceName": "Pixel 8", "osVersion": "14",
      "deviceMatrix": [
        { "deviceName": "Pixel 8", "osVersion": "14" },
        { "deviceName": "Pixel 9", "osVersion": "15" }
      ],
      "steps": [{ "id": "login", "action": "tap", "target": "~Login" }]
    }
  }
}
```

Per Chrome/Edge aggiungere `browserVersion` alla riga macchina; i motori Playwright bundled dipendono dalla versione supportata dal provider. Per LambdaTest cambiare provider e valori di OS secondo il catalogo disponibile. Per Appium cloud usare una griglia BrowserStack/LambdaTest e un'app `bs://…`/`lt://…`. Il percorso locale crea un agente effimero nel tenant della prova, lo avvia sul computer che esegue la suite e lo termina dopo il test: Appium, driver e dispositivi devono essere raggiungibili da quel computer. I nomi dei device devono corrispondere alle capabilities osservate.

Il percorso controlla risultato funzionale e `matched` per ogni target, configurazione effettiva, report UI, HTML e JUnit; produce allegati `grid-matrix`/`appium-matrix`. Allure allega un JSON per risultato; PDF usa lo stesso modello HTML. BrowserStack/LambdaTest restituiscono metadati della sessione, Appium restituisce capabilities W3C. Credenziali, payload completi e URL firmati non sono copiati nell'evidenza.

Un Playwright server remoto o un agente non espone automaticamente il proprio OS: la sua versione browser è osservabile, ma richieste OS non verificabili rimangono `unverified`. Metadati mancanti, sessioni rifiutate e target sostituiti impediscono la certificazione. I dati vecchi senza evidenza non vengono certificati retroattivamente. L'esecuzione di questa procedura su hardware reale resta necessaria prima di dichiarare certificata quella matrice.

Riferimenti provider: [BrowserStack session details](https://www.browserstack.com/docs/automate/playwright/get-session-details), [BrowserStack browser/OS support](https://www.browserstack.com/docs/automate/playwright/browsers-and-os), [LambdaTest hooks](https://www.testmuai.com/support/docs/lambda-hooks/).
