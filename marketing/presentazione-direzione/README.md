# Presentazione alla direzione / Management briefing

Materiale per presentare WebFlowMaster alla direzione (novembre 2026): deck, demo live, discorso e
domande, in italiano e in inglese. Sostituisce, per questo pubblico, il deck di ottobre in
[../demo-presentazione/](../demo-presentazione/).

| Cosa                  | Italiano                                                                                  | English                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Deck (15 slide)       | [artifact](https://claude.ai/artifact/PooJLVzzB945h3sSkaEkQc), sorgenti in [deck/](deck/) | [artifact](https://claude.ai/artifact/ToCa4FuyD8tLzhRn7XfPS4), sources in [deck-en/](deck-en/) |
| Copione della demo    | [demo.md](demo.md)                                                                        | [demo.en.md](demo.en.md)                                                                       |
| Discorso e domande    | [discorso.md](discorso.md)                                                                | [speech.en.md](speech.en.md)                                                                   |
| Preparazione ambiente | [prepara-demo.ps1](prepara-demo.ps1)                                                      | same script                                                                                    |

I deck sono privati: vanno condivisi dal menu _Share_ prima di mandare il link. Si esportano in
PPTX o PDF dallo stesso menu.

## Segnaposto da compilare

- Copertina: [data della presentazione] / [presentation date].
- Note della slide 3: ore di regressione manuale per rilascio del team.
- Slide 14: team, operatore, ambiente.
- Discorso: stima dell'infrastruttura, secondo referente.

## Checklist del giorno prima

1. Docker Desktop avviato, poi `pwsh marketing/presentazione-direzione/prepara-demo.ps1`
   (15–20 minuti; finisce con «PRONTO per la demo»).
2. Prova generale cronometrata con [demo.md](demo.md) o [demo.en.md](demo.en.md).
3. Chiave API per il blocco F, in una variabile d'ambiente del terminale.
4. Registrazione di riserva della demo (piano B).
5. Deck condiviso con il destinatario e segnaposto compilati.
6. CA del collaudo tra le radici attendibili di Windows (`Import-Certificate -FilePath
collaudo\collaudo-root.crt -CertStoreLocation Cert:\CurrentUser\Root`), altrimenti il browser
   mostra l'avviso di certificato.
7. Un'ora prima: `prepara-demo.ps1 -SoloVerifica` e lingua dell'interfaccia allineata a quella
   della presentazione (_Impostazioni → Lingua_).
