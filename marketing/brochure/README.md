# WebFlowMaster customer brochure / Brochure clienti

Two complete six-page A4 editions, Italian and English, with embedded fonts and real product
screenshots from the synthetic demonstration environment. No revenue, time-saving, performance
or compliance certification claims are made. Product capabilities were checked against the
repository on 6 October 2026; cloud providers, AI and integrations require configuration.

## Files

- `out/webflowmaster-brochure-it.pdf`: Italian client edition.
- `out/webflowmaster-brochure-en.pdf`: English client edition.
- `copy.json`: editable bilingual copy. Keep capability statements aligned between languages.
- `build.py`: layout source. Every card and paragraph checks for overflow.
- `assets/`: copies of the real demo dashboard and API tester screenshots. Values are demonstration
  data, not benchmarks. These English UI captures predate the latest product changes; neither image
  is presented as a screenshot of mobile or BDD.

## Regenerate

Use Python with `reportlab` and `Pillow` installed:

```powershell
py marketing/brochure/build.py
```

On Windows the script embeds `C:/Windows/Fonts/segoeui.ttf` and `segoeuib.ttf`. On another system,
set `WFM_BROCHURE_FONT_DIR` to a folder containing those fonts under a suitable font license, or
adapt `fonts()` to an available family. The build does not fetch anything from the internet.

Before distributing a changed brochure, render every PDF page and inspect both languages. Recheck
capabilities after product changes. Keep sample metrics labeled as demonstration values.

The call to action shows the contact in [`../contact.json`](../contact.json), with a clickable link for
each value; a value left empty (the phone, today) is omitted. The values there are placeholders
until the product has its own domain and mailbox.
The brochure is for digital distribution or ordinary A4 printing; it has no print-shop bleed or
CMYK output profile. Request a printer-specific export if those are needed.
