# Protocollo 28 — Correzione vulnerabilità delle release

Il catalogo contiene 527 casi. OPS-26 verifica aggiornamenti, mitigazione braces e
gate di pubblicazione. OPS-24 usa Lighthouse 13.5.0 e verifica Chromium, Firefox e
WebKit. I 520 casi storici e i cicli salvati restano invariati; il nuovo caso è
**Da eseguire**. La verifica su dispositivi fisici resta rinviata.

## Correzioni

- Nodemailer 10.0.15 con tipi inclusi, proxy-addr 2.0.8, undici 6.29.0 e
  source-map-js 1.2.2; VitePress usa una versione Vite corretta.
- Lock client rigenerato dal manifest corrente; lock degli strumenti video
  aggiornato. Il lock principale resta l'autorità delle workspace.
- Lighthouse 13.5.0 elimina la catena abbandonata di extract-zip.
- Playwright 1.63.0 su base ufficiale Ubuntu 26.04 (Resolute), fissata per digest,
  mantiene le librerie necessarie ai tre browser.
- OpenSSL e i due pacchetti collegati sono fissati a 3.5.5-1ubuntu3.7; Pebble,
  inutilizzato, è rimosso. Tutti gli stage conservano UID/GID 1000 di pwuser.
- npm globale è rimosso dalle immagini finali. Un controllo della raggiungibilità
  delle dipendenze elimina solo fast-glob/micromatch/braces orfani dal runtime;
  richieste effettive, dipendenze mancanti e percorsi esterni bloccano la build.
- La patch temporanea braces è verificata per hash e applicata via postinstall;
  limita il nesting a 100. Mantiene identità/versione upstream e non sopprime CVE.

## Prove automatiche

Passano 31 test release, 3 test di sicurezza, 54 regressioni applicative
(architettura, email, configurazione provider/egress e misure browser), 13 test
Collaudo e un test browser del catalogo: **102 test selezionati**, senza casi
saltati nell'esecuzione finale. Passano compilazione TypeScript, build applicativa
e documentazione. La composizione MIME usa Nodemailer reale con allegati in
memoria; le prove applicative email non certificano consegna SMTP esterna.

Il test della protezione braces falliva prima della patch e passa dopo. I test di
pruning rifiutano la rimozione di dipendenze necessarie, inclusi peer/optional.
La verifica del grafo è passata anche sulle dipendenze installate in un container
API reale. La revisione ha corretto la copia della patch nello stage finale del
fixture agente prima del relativo npm install.

## Immagini e runtime reali

| Ruolo | HIGH/CRITICAL prima | Dopo | Componenti SBOM | Configurazione SHA-256 |
| --- | ---: | ---: | ---: | --- |
| API | 31 | 0 | 1375 | `ddfb81a5fd9a466f4af12e7a678e49341e5165446e6ddb05a5153ffb8a581299` |
| Worker | 31 | 0 | 1375 | `1747a423af777b674e94d27ba4d0f251066bfdf462a74e603f9bc128e12a33dd` |
| Agent | 28 | 0 | 1257 | `4c8ae404751abd8ddea353402d61fce0835626842a7f1ecf5dfbe681efa8f3ba` |

Per ogni ruolo le due build senza cache producono configurazioni e layer
decompressi identici. Gli smoke test eseguono Chromium, Firefox e WebKit reali,
scrivono nelle directory runtime e verificano UID/GID 1000. API supera anche la
prova con volumi anonimi temporanei. Lighthouse 13.5.0 esegue un audit HTTP locale
completo e produce JSON/HTML validi; i punteggi della pagina di prova non misurano
le prestazioni dell'applicazione. Il fixture AGT-05 compila e carica Playwright
1.60.0 intenzionalmente incompatibile, senza npm globale nel runtime; non è una
immagine di release.

Il gate accetta i tre rapporti immagine e rifiuta il rapporto sorgenti con due
HIGH, come previsto. Hash, database scanner e riepilogo sono in
`deployment/releases/remediation-2026-10-06.json`; i rapporti completi in
`outputs/security-remediation-2026-10-06/` sono locali ed esclusi da Git.

## Sorgenti e limite residuo

La scansione Trivy 0.75.0 dei cinque lockfile passa da 36 a **2 occorrenze HIGH**:
CVE-2026-93687 per braces 3.0.3 nei lock principale e client. Lighthouse, video e
sample BDD non hanno HIGH/CRITICAL nel rapporto successivo agli aggiornamenti.
La mitigazione locale impedisce il nesting eccessivo nelle installazioni standard,
ma non equivale a una release upstream corretta. `--ignore-scripts` la salta.

Il gate rifiuta ancora il rapporto sorgenti. **La release resta bloccata**, senza
ignore, eccezioni o attestazioni VEX automatiche. I conteggi di sorgenti e immagini
non si sommano, perché gli stessi rilievi possono ripetersi.

Le prove locali usano snapshot immutabili del candidato, epoch 1700000000,
piattaforma linux/amd64 e BuildKit v0.33.1 fissato per digest. Buildx locale è
v0.37.1; CI usa v0.37.2. Non sono prove sul tag finale né su GitHub Actions.
I rapporti completi sono conservati localmente e restano esclusi da Git.
Installazione, backup/upgrade completo, SMTP esterno e dispositivi fisici non
sono certificati da queste verifiche.
