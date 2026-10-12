# Presentazione demo del prodotto

Materiale per presentare WebFlowMaster a colleghi e responsabili: un deck di 15 slide con note del
relatore e il discorso completo con il piano della demo live. Preparato il 12 ottobre 2026.

| File                     | Contenuto                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `discorso.md`            | Il discorso sezione per sezione, il piano della demo live e le domande probabili           |
| `deck/project/deck.json` | Indice del deck: ordine delle slide, sezioni, tipografie (DM Sans, JetBrains Mono)         |
| `deck/project/slides/`   | Una slide per file, HTML inline su canvas 1920×1080; l'`<aside>` finale è la nota relatore |

## Versioni vive

Il deck e il discorso sono stati creati come artifact Claude e si possono aggiornare e esportare da lì
(PowerPoint o PDF dal menu Share del deck):

- Deck: <https://claude.ai/artifact/F2dGfy7VtnpBcnn52csCyK>
- Discorso: <https://claude.ai/code/artifact/3b138e7c-b9a5-477c-977e-bfa9242c016d>

Questa cartella è la copia versionata: dopo una modifica all'artifact, ricopiare qui i file cambiati.

## Immagini

Le slide 6 e 9 mostrano le schermate della prima brochure (UI inglese, 30 settembre 2026); quelle
attuali della brochure sono in `../brochure/assets/<lingua>/`. Nel deck pubblicato sono caricate come asset e
referenziate con `/_blob/<id>`; i file sorgente sono in `assets/`:

| Slide                   | Asset nel deck                            | Sorgente               |
| ----------------------- | ----------------------------------------- | ---------------------- |
| `slides/dashboard.html` | `/_blob/1dd84be757eb6554578cdc8d76bf1688` | `assets/dashboard.png` |
| `slides/demo-api.html`  | `/_blob/2f2f5eebea8315dbb8e3dbee5818f1c5` | `assets/api.png`       |

## Da aggiornare prima di presentare

- Copertina e chiusura: data della presentazione e contatto sono segnaposto tra parentesi quadre.
- Slide 13: i numeri vengono da README, `MIGLIORIE-2026-10-10.md` e `collaudo/README.md` al
  12 ottobre 2026.
- Slide 14: la roadmap riflette lo stato delle PR all'11 ottobre 2026.
- La demo live è scritta sullo scenario DMO NCC (piano «DMO NCC - Collaudo automatico», agente locale
  nel pool dmo-local); i passi valgono per qualsiasi altra applicazione.
