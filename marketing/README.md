# Product and technical handoff / Consegna prodotto e tecnica

The product documentation is bilingual, with a complete suite reading path and practical
implementation walkthrough. Customer materials are separate Italian and English editions.

## For colleagues / Per i colleghi

- Complete suite handbook: [IT](../docs/it/internals/suite-handbook.md) / [EN](../docs/en/internals/suite-handbook.md).
- Implementation walkthrough: [IT](../docs/it/internals/contributing-guide.md) / [EN](../docs/en/internals/contributing-guide.md).
- Product and documentation audit: [IT](../docs/it/internals/product-audit.md) / [EN](../docs/en/internals/product-audit.md).
- Generated schema catalog, with the current table and column counts: [IT](../docs/it/internals/schema-catalog.md) / [EN](../docs/en/internals/schema-catalog.md).
- [Demo presentation](./demo-presentazione/README.md): 15-slide deck with speaker notes and the
  full Italian speech with the live-demo plan, for presenting the product to colleagues and managers.

`npm run docs:pdf` builds the site and exports every documentation section. It also writes
`docs/pdf/it/suite-handbook.pdf` and `docs/pdf/en/suite-handbook.pdf`, containing the overview,
handbook, contribution guide and audit. After building the site, the shorter export can be run
alone with `node scripts/generate-docs-pdf.js --handbook`.

The complete internals export also contains the structural schema catalog. SQL migrations,
not a generated Drizzle listing, remain authoritative for policies, grants and live constraints.

## For customers / Per i clienti

- [Brochure](./brochure/README.md): six-page A4 PDF in each language, editable copy and renderer.
- [Presentation video](./promo-video/README.md): 60-second Full HD MP4 in each language with a
  neural voice-over, the product's UI in that language and live recordings of the recorder, a run
  and the mobile inspector; 30 and 15-second cuts in 16:9, 1:1 and 9:16, a thumbnail, SRT captions
  transcribing the voice, and editable Remotion source.
- [Demo request page](./landing/index.html): the static page the video and the brochure point to
  (`demoUrl`), English and Italian, with tracked links.

`npm run marketing:refresh` films the product again and rebuilds the video and the brochure from
it: run it before each release, on the collaudo stack with the demo organization loaded.

The commercial contact lives in [`contact.json`](./contact.json), read by both the brochure and the
video: `marco.oliva@aveva.com` and `www.aveva.com`, no phone. `demoUrl`, the address of the demo
request page, stays empty until that page is hosted. After changing a value, update the email in
`landing/index.html` too, then regenerate the PDFs and MP4s before distributing anything.

Generated PDFs, MP4 files and demo video inputs are local outputs, ignored by Git. The brochure
contains its own two demonstration screenshots in `brochure/assets/`. The video README explains
how to capture its full demonstration set again. No customer production data is used.

## Verification boundary

Documentation build, PDF generation, catalog regeneration, brochure layout/contact links,
video TypeScript, MP4 codecs/duration and representative frames were checked locally.
The original instrumental has no external samples and was checked for clipping; it has no
professional listening-review claim. Application code was not changed. This delivery does
not represent a rerun of the full product test suite or every live integration/provider.
