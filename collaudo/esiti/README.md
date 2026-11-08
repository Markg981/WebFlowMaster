# Esiti del collaudo versionati

Questa cartella contiene gli esiti firmati di un ciclo di collaudo, uno per release (`<release>.json`),
così da poter dire "la versione X ha passato il collaudo Y".

1. Calcolare l'impronta del catalogo: `node scripts/collaudo-hash.mjs`.
2. Copiare `TEMPLATE.json` in `<release>.json`, compilare `release`, `catalogHash`, `date`, `tester` e un
   elemento in `results` per ogni caso del catalogo (`outcome`: `passed`, `failed`, `blocked`, `skipped`).
3. Validare: `npm run collaudo:verify` (ID sconosciuti o mancanti, impronta diversa, esiti non validi
   danno exit code diverso da zero). Il comando stampa il riepilogo.

Criterio di superamento: tutti i casi con priorità P1 e P2 sono `passed`. La CI valida ogni file qui
presente (`TEMPLATE.json` escluso) ma non richiede che esistano.

L'app del collaudo esporta CSV e backup con esiti `pass/fail/block/na`: non scrive ancora questo formato,
la conversione è manuale.
