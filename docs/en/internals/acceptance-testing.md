# Acceptance testing and versioned outcomes

The manual acceptance catalogue lives in `collaudo/casi/` (one JSON file per case, priorities P1 to P3).
Day-to-day results stay in the local collaudo application and are not tracked by git. To state that a
release passed acceptance, commit a signed outcome file in `collaudo/esiti/`.

1. Compute the catalogue fingerprint: `node scripts/collaudo-hash.mjs` (SHA-256 over the sorted case files).
2. Copy `collaudo/esiti/TEMPLATE.json` to `<release>.json` and fill in `release`, `catalogHash`, `date`,
   `tester` and one `results` entry per case (`passed`, `failed`, `blocked` or `skipped`, plus a note).
3. Validate with `npm run collaudo:verify`. Unknown IDs, missing IDs, a fingerprint that does not match the
   current catalogue or an invalid outcome make the command fail. CI runs it on every file in the folder
   and does not require any file to exist.

Pass criterion: every P1 and P2 case is `passed`. The collaudo application exports CSV and a backup with
`pass/fail/block/na` outcomes; it does not write this format yet, so convert by hand.
