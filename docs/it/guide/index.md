# Primi passi

WebFlowMaster testa applicazioni web e API HTTP. Un test si costruisce registrandolo,
trascinando gli step o descrivendolo a frasi; i test si raggruppano in **piani**; i piani girano
su richiesta, con una pianificazione o da una pipeline di CI, in uno o più browser; e ogni run
lascia un **report** con screenshot, tempi e, quando servono, un video, una trace di Playwright e
il traffico di rete.

Questa guida è per chi scrive ed esegue i test. L'installazione e la gestione di
un'organizzazione sono in [Amministrazione](../admin/administration).

## Accesso

Accedete con il nome utente e la password che vi ha dato un owner della vostra organizzazione,
di solito tramite un link di invito. A seconda di come è configurata l'organizzazione:

- **Autenticazione a due fattori**: dopo la password viene chiesto un codice a sei cifre
  dall'app di autenticazione. Se l'organizzazione la richiede e non l'avete ancora configurata,
  l'applicazione vi chiede di farlo prima di tutto (**Impostazioni → Sicurezza**).
- **Single sign-on**: scegliete **Accedi con SSO**, scrivete il vostro indirizzo e-mail di
  lavoro e accedete presso l'identity provider dell'azienda. Se la pagina di accesso dice che la
  vostra organizzazione accede con il single sign-on, la password lì non funziona più: usate
  quel pulsante.

Password dimenticata? Chiedete un link di reset a un owner della vostra organizzazione.

## Orientarsi

La barra laterale contiene tutto:

| Sezione | A cosa serve |
|---|---|
| **Dashboard** | Com'è andato l'ultimo periodo, gli ultimi 30 giorni, i prossimi run pianificati. |
| **Tester API** | Costruire e salvare test API. Vedi [Test API](./api-tests). |
| **Crea Test** | Il costruttore dei test web. Vedi [Test web](./web-tests). |
| **Libreria dei test** | Ogni test salvato, con tag e cronologia. Vedi [Organizzare i test](./organizing). |
| **Test Manager** | Importare casi di test da Excel e associarli ai test salvati. |
| **Suite** | Elenchi di test condivisi da più piani. |
| **Piani di test** | Cosa eseguire, dove e come; il pulsante **Esegui**. Vedi [Eseguire i test](./running). |
| **Revisioni** | Le modifiche in attesa di approvazione, se l'organizzazione revisiona i test prima che girino. |
| **Schedulazione** | I piani che girano da soli. |
| **Report** | Ogni run concluso, i test instabili e la quarantena. Vedi [Risultati](./results). |
| **Impostazioni** | Preferenze e password e, a seconda del ruolo, ambienti, progetti, membri, chiavi e il resto. |

Cosa potete fare dipende dal **ruolo**: i viewer leggono test e risultati; gli editor li creano
anche, li modificano e li eseguono; gli owner gestiscono anche l'organizzazione. I pulsanti che
non potete usare sono nascosti o disattivati.

## Progetti e ambienti

Due cose conviene prepararle prima del primo test, in **Impostazioni**:

- Un **progetto** raggruppa i test di un'applicazione. Tiene in ordine la libreria dei test ed è
  dove il [repository degli elementi](./web-tests#repository-degli-elementi) conserva gli
  elementi condivisi. Un owner può riservare un progetto ad alcuni membri.
- Un **ambiente** (Staging, Produzione…) contiene i valori che un test usa su quel sistema —
  l'indirizzo, i nomi utente, le password — come **segreti** cifrati. I test li richiamano come
  <code v-pre>{{nome}}</code>, così lo stesso test gira su Staging o su Produzione scegliendo
  l'ambiente. Vedi [Variabili e ambienti](./web-tests#variabili-e-ambienti).

## Il primo test, dall'inizio alla fine

1. **Crea Test**: inserite l'indirizzo dell'applicazione e **Carica Sito**, poi **Rileva
   Elementi**.
2. Trascinate le azioni nella **Sequenza del test** e date a ognuna il suo elemento, oppure
   registratele. Premete **Esegui test** per vederlo girare.
3. **Salva test**, in un progetto.
4. **Piani di test → + Piano di test**: date un nome al piano e aggiungetegli il test.
5. **Esegui** il piano, e aprite il report quando finisce.
6. Quando passa in modo affidabile, **Schedulazione → Crea pianificazione** per eseguirlo ogni
   notte, oppure eseguitelo dalla vostra pipeline ([Integrazione CI](../CI_INTEGRATION)).

## Impostazioni personali

**Impostazioni → Preferenze** contiene la lingua dell'interfaccia (English, Italiano, Français,
Deutsch) e il tema; **Impostazioni → Valori predefiniti** il browser e i timeout usati dal
costruttore. **Impostazioni → Sicurezza** contiene il vostro secondo fattore, e **Impostazioni →
Account** la password.
