# Release riproducibili: design e piano

Richiesta: immagini API, worker e agent versionate, SBOM e scansioni su un nuovo
branch. Base: main `8baf3ad`. Nessuna pubblicazione di immagini o tag in questa
fase; il workflow viene predisposto per un successivo rilascio autorizzato.

## Contratto

Il lockfile principale, un lockfile separato per Lighthouse e digest verificati
delle basi costituiscono gli input. L'agent usa le dipendenze già installate dal
lockfile principale, evitando una seconda risoluzione dei transitivi. La versione
pubblica corrisponde a package.json e al tag vX.Y.Z (prerelease ammessi).

API/worker/agent eseguono come pwuser. Il controllo Docker apre Chromium e scrive
nelle directory di runtime; volumi bind preesistenti richiedono permessi adeguati.
Il container BDD di esempio conserva il proprio support environment separato.

Ogni candidato viene ricostruito senza cache di layer, con SOURCE_DATE_EPOCH dal
commit e timestamp riscritti. Devono coincidere i digest di configurazione, che
includono gli hash dei layer non compressi. Non si promette identità byte per byte
degli archivi esterni o dei risultati di scansione con database di advisory diversi.

Trivy è fissato per digest: produce SBOM CycloneDX, rapporto completo delle
vulnerabilità e metadati del database. HIGH/CRITICAL bloccano la promozione,
anche senza fix; nessuna eccezione predefinita. Nessun push su PR o dispatch.
Solo un tag valido su main, con tutti i controlli CI richiesti riusciti sul commit,
può promuovere gli archivi verificati. Il manifest finale registra i digest di
registry, input, migrazioni, SBOM e scansioni. Nessun tag latest.

## Implementazione e verifiche

1. Test del contratto Docker, manifest e guardie del rilascio (Node test runner).
2. Pin delle basi, lock Lighthouse, dipendenze agent dal lock e runtime non-root.
3. Tooling release per metadata, evidenze e manifest; workflow build/scan/promozione.
4. Build Docker e smoke reali se il daemon disponibile lo consente; nessun accesso
   a database o code di clienti. Test negativi su versioni, digest ed evidenze mancanti.
5. Guide operative IT/EN, catalogo di collaudo aggiornato con casi Da eseguire,
   controllo dei tipi, build documentazione e revisione indipendente.

Rollout API/worker/agent e upgrade database dalla release precedente richiedono
un collaudo d'installazione separato; non sono attestati dai test di packaging.
