# WebFlowMaster customer brochure / Brochure clienti

Two complete six-page A4 editions, Italian and English, with embedded fonts and real product
screenshots from the synthetic demonstration environment, each in the edition's own language.
No revenue, time-saving, performance or compliance certification claims are made. Product
capabilities were checked against the product on 12 October 2026; cloud providers, AI and
integrations require configuration.

## Files

- `out/webflowmaster-brochure-it.pdf`: Italian client edition.
- `out/webflowmaster-brochure-en.pdf`: English client edition.
- `copy.json`: editable bilingual copy. Keep capability statements aligned between languages.
- `build.py`: layout source. Every card and paragraph checks for overflow; `CROPS` says which part
  of each screenshot a page shows.
- `capture.mjs`: films the screenshots, once per language.
- `assets/it/`, `assets/en/`: the screenshots, JPEG at 2x: dashboard (cover), builder, API tester,
  mobile inspector and Gherkin editor (page 3), the failed tests of a run (page 4). Values are
  demonstration data, not benchmarks.
- `fonts/`: Inter Regular and Bold, under the SIL Open Font License (`fonts/OFL.txt`).

## Regenerate the screenshots

After a UI change on a screen the brochure shows. The screens come from the Northwind Commerce demo
on the collaudo stack (steps 1–4 of [`../promo-video/README.md`](../promo-video/README.md)); the
mobile inspector comes from the collaudo Android emulator (`npm run collaudo:mobile`) through the
"Lab" local Appium grid of organization Acme (`collaudo/README.md`, area MOB), whose agent must run
the server's Playwright version.

```powershell
$env:NODE_EXTRA_CA_CERTS = 'collaudo/collaudo-root.crt'
node marketing/brochure/capture.mjs                  # both languages, every screen
$env:LANGS = 'it'; $env:SHOTS = 'mobile,bdd'; node marketing/brochure/capture.mjs
```

The script switches the demo users to the edition's language for the capture and puts their
preference back afterwards. It adds what the screens need and the demo lacks: the Gherkin scenario
"Checkout" / "Pagamento" in Northwind and the mobile test "Wikipedia search" in Acme. On the
emulator it dismisses Android's warning about the old sample app and opens the app's search
screen, so the home feed's daily news never ends up in a brochure. A shot that cannot be taken is
reported and leaves `assets/<lang>/_failed-<shot>.png` (ignored by Git) showing where it stopped.

## Regenerate the PDFs

Use Python with `reportlab` and `Pillow` installed:

```powershell
py marketing/brochure/build.py
```

The fonts ship with the brochure, so the build is the same on Windows, Linux and CI;
`WFM_BROCHURE_FONT_DIR` still points it at another folder with `Inter-Regular.ttf` and
`Inter-Bold.ttf`. The build does not fetch anything from the internet.

Before distributing a changed brochure, render every PDF page and inspect both languages. Recheck
capabilities after product changes. Keep sample metrics labeled as demonstration values.

## Commercial terms, contact and distribution

Page 6 states the licence model: an annual licence per installation, support included, with a
30-day pilot. Change the `licence` line in `copy.json` if the terms change.

The call to action shows the contact in [`../contact.json`](../contact.json), with a clickable link for
each value; a value left empty (the phone, today) is omitted. The values there are placeholders
until the product has its own domain and mailbox.

The brochure is for digital distribution or ordinary A4 printing, and says so on page 6; it has no
print-shop bleed or CMYK output profile. Request a printer-specific export if those are needed.
