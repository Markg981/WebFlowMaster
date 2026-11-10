# Discorso e domande probabili

Traccia per la presentazione alla direzione (circa 30 minuti). Il testo completo di ogni slide è
nelle note del relatore del deck; qui ci sono i tempi, la frase da non perdere per ogni slide e le
risposte alle domande più probabili. Versione inglese: [speech.en.md](speech.en.md).

## Tempi

| Parte                          | Slide | Minuti |
| ------------------------------ | ----- | ------ |
| Apertura e richiesta           | 1–2   | 2      |
| Problema, cos'è, ciclo         | 3–6   | 5      |
| Demo live ([demo.md](demo.md)) | 7     | 15     |
| Manutenzione → numeri          | 8–12  | 4      |
| Pilot e prossimi passi         | 13–14 | 2      |
| Domande                        | 15    | resto  |

Se il tempo stringe: nella demo salta G e H; delle slide 8–12 tieni solo 9 (manutenzione) e 12
(numeri).

## Slide per slide: la frase da non perdere

1. **Copertina** — «Ti dico subito cosa ti chiedo, così guardi la demo sapendo cosa decidere.»
2. **Richiesta** — «Un pilot di due settimane, un team, uno-tre flussi, misurato con i numeri del
   team, non con i miei.»
3. **Problema** — «Ogni rilascio costa ore di regressione manuale e lascia prove sparse.» Qui va il
   numero del team: [ore di regressione manuale per rilascio].
4. **Cos'è** — «Una piattaforma sola, installata da noi, per tutti i tipi di test.»
5. **Ciclo** — «Crea, organizza, esegui, leggi, agisci: la demo segue questi cinque passi.»
6. **Dashboard** — «Nessuno deve chiedere a che punto è la regressione.»
7. **Demo** — passa al copione [demo.md](demo.md). Regola: niente debug in diretta.
8. **Fallimento** — «Chi corregge non deve riprodurre nulla.»
9. **Manutenzione** — «La riparazione la propone il run, la approva una persona.»
10. **Integrazioni** — «Non chiede di cambiare strumenti.»
11. **Sicurezza** — «I dati non escono, e l'AI è spenta finché non la accendiamo noi.»
12. **Numeri** — «Non è un prototipo: manca solo la prova con un team vero.»
13. **Pilot** — «Un solo verde falso tiene chiuso il gate.»
14. **Prossimi passi** — «Mi servono un team, un operatore, un ambiente e il tuo via.»
15. **Domande** — ripeti la richiesta in una frase e taci.

## Domande probabili

**Quanto costa?**
Nessuna licenza: il codice è nostro. Il costo è l'infrastruttura (un server o una VM con Docker,
PostgreSQL, spazio per le evidenze) e il tempo delle persone. Per il pilot basta una VM; la stima
precisa dipende dall'ambiente scelto: [stima infrastruttura]. Non fare confronti con prezzi di
fornitori che non hai verificato.

**Quanto tempo ci vuole per mantenerla?**
La piattaforma è in esercizio dal giugno 2025, con CI, due audit indipendenti e un manuale
completo. Il pilot misura proprio questo: quanti locator vanno riparati e quante correzioni servono
dopo la registrazione. Prima del pilot non do numeri inventati.

**Chi la supporta se tu non ci sei?**
Il codice è documentato (manuale IT/EN, guida amministratore, runbook), ogni modifica è una pull
request piccola e tracciata, e la CI blocca le regressioni. Fa parte del pilot decidere chi è il
secondo referente: [nome del secondo referente].

**Perché non uno strumento commerciale?**
Perché questa è installata da noi, i dati non escono, copre web, API, mobile, BDD e carico in un
posto solo, e si adatta ai nostri casi (come DMO su rete chiusa). Il pilot serve proprio a
confrontarla con quello che il team usa oggi, sui suoi numeri.

**È sicura? Chi può vedere i dati?**
Organizzazioni isolate dal database stesso, SSO aziendale (OIDC o SAML), SCIM, ruoli, chiavi API
con scope, audit log in sola aggiunta. L'assistenza AI è spenta finché un owner non dà il consenso.

**Funziona con le nostre applicazioni dietro VPN?**
Sì: un agente gira dentro quella rete e si collega in uscita alla piattaforma. È il caso DMO della
demo (blocco H).

**Cosa succede se il pilot va male?**
Il report dice perché, con i dati. Se il gate resta chiuso ci fermiamo, o correggiamo e ripetiamo
il pilot sullo stesso flusso. La decisione è tua e resta scritta nel report.

**Quanto tempo chiede al team?**
Un operatore per due settimane su uno-tre flussi, più la misura iniziale dei tempi attuali. Io
installo, preparo e osservo.

## Segnaposto da compilare prima

- [data della presentazione] — copertina.
- [ore di regressione manuale per rilascio] — note della slide 3.
- [nome del team], [nome dell'operatore], [server o VM] — slide 14.
- [stima infrastruttura], [nome del secondo referente] — risposte qui sopra.
