# Collaudo ed esiti versionati

Il catalogo dei casi manuali di collaudo è in `collaudo/casi/` (un file JSON per caso, priorità da P1 a P3).
I risultati quotidiani restano nell'applicazione locale del collaudo e non sono tracciati da git. Per
dichiarare che una release ha superato il collaudo, si versiona un file di esiti firmato in `collaudo/esiti/`.

1. Calcolare l'impronta del catalogo: `node scripts/collaudo-hash.mjs` (SHA-256 dei file dei casi ordinati).
2. Copiare `collaudo/esiti/TEMPLATE.json` in `<release>.json` e compilare `release`, `catalogHash`, `date`,
   `tester` e un elemento di `results` per ogni caso (`passed`, `failed`, `blocked` o `skipped`, più una nota).
3. Validare con `npm run collaudo:verify`. ID sconosciuti o mancanti, impronta diversa dal catalogo attuale
   o esiti non validi fanno fallire il comando. La CI lo esegue su ogni file della cartella e non richiede
   che ne esista alcuno.

Criterio di superamento: tutti i casi P1 e P2 sono `passed`. L'applicazione del collaudo esporta CSV e backup
con esiti `pass/fail/block/na`; non scrive ancora questo formato, quindi la conversione è manuale.
