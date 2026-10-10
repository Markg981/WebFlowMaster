# WebFlowMaster promo video

A 60-second, 16:9 promo (1920×1080, 30 fps), in **English and Italian editions**, made with
[Remotion](https://www.remotion.dev): the video is React code in `video/`, rendered to MP4.
Every screen in it is the real product, captured in a demo organization on the collaudo stack.
The editions use separate localized editorial overlays and calls to action; the captured
product UI remains English in both. The animations pan and zoom real screenshots, rather
than presenting a newly recorded live product session.

## Deliverables / Consegna

| Edition  | Video                                  | Optional captions                           |
| -------- | -------------------------------------- | ------------------------------------------- |
| English  | `video/out/webflowmaster-promo-en.mp4` | `video/captions/webflowmaster-promo-en.srt` |
| Italiano | `video/out/webflowmaster-promo-it.mp4` | `video/captions/webflowmaster-promo-it.srt` |

Both MP4 files include a quiet, original procedural instrumental and animated text.
Matching silent versions are `video/out/webflowmaster-promo-en-silent.mp4` and
`video/out/webflowmaster-promo-it-silent.mp4`. No voice-over is included.
SRT files provide timed summaries of the on-screen story, not a
transcript of spoken narration. Video outputs and screenshot inputs remain ignored by Git.

Entrambe le edizioni durano 60 secondi, con testi animati nella rispettiva lingua.
Le schermate del prodotto restano in inglese. I video hanno una base strumentale
originale generata, senza voce narrante; sono disponibili anche le versioni senza musica.
i file SRT contengono il riepilogo temporizzato dei messaggi a schermo.

### Capture provenance and scope

Reused local assets in `video/public/shots/` from **30 September 2026**, from the
Northwind Commerce demo on the collaudo stack. This refresh does **not** claim a new
live capture or a current full acceptance run. The storefront is staged, the banner
assertion fails intentionally, and the historical dates were spread in the original
demo dataset. The generic browser address is an editorial overlay for a self-hosted product.

Native mobile through Appium and Gherkin/BDD are mentioned in the editorial copy.
Their runners are separate from browser execution; the video does not show or imply
new captures of an Appium device or BDD editor. The evidence scene frames the actual
trace, HAR and assertion-error modal, excluding the old report's background chart placeholders.

| Scene          | Seconds   | Shows                                                                                  |
| -------------- | --------- | -------------------------------------------------------------------------------------- |
| Hook           | 0–5       | "Every release. Every browser. Every click, by hand?"                                  |
| Logo           | 5–8.5     | The mark and the tagline                                                               |
| Build          | 8.5–20.5  | Plain-language test creation and validation; editorial mention of Gherkin/BDD          |
| APIs           | 20.5–25.5 | The API tester: request, assertions, captures                                          |
| Run            | 25.5–33.5 | Browser execution log; editorial mention of native mobile/Appium and dedicated runners |
| Understand     | 33.5–41.5 | The evidence of a failed step: video, trace, network, the error                        |
| Measure        | 41.5–47.5 | The dashboard: success rate, 30-day trend, schedules                                   |
| Connect        | 47.5–53.5 | CI/CD, GitHub/GitLab, Jira/Azure DevOps, webhooks, agents, SSO/MFA/audit               |
| Call to action | 53.5–60   | Localized CTA, Marco Oliva and the supplied commercial contacts                        |

## Render

```bash
cd marketing/promo-video/video
npm install
npm run studio            # preview and scrub in the browser
npm run render:all:music  # generate original WAV and render both editions with music
npm run render:all        # both localized editions without audio
npm run render:en         # out/webflowmaster-promo-en-silent.mp4
npm run render:it         # out/webflowmaster-promo-it-silent.mp4
```

The call to action is a prop: `npx remotion render PromoEN out/promo.mp4 --props='{"cta":"Book a demo"}'`.
`PromoEN` and `PromoIT` use the same scene timing and camera moves. `Promo` remains a
compatible English default. Change localized copy in `video/src/copy.tsx` and the matching
SRT file when changing the story. `npm run render` still produces the legacy English filename.

### Verification (6 October 2026)

Both compositions rendered successfully. Bundled FFprobe confirmed H.264 video,
1920×1080, 30 fps, exactly 1,800 frames / 60.000 seconds. Representative frames
from both editions were visually inspected, including Italian build/integrations copy,
the mobile/BDD overlay, the real assertion error and the closing English CTA.
`tsc --noEmit` passed; both SRT files contain eleven sequential cues covering the full minute.
Final music editions contain AAC stereo at 48 kHz; both video and audio streams and
the MP4 container are exactly 60.000 seconds. Decoding the final English audio confirmed
zero clipped samples and a peak of -15.00 dBFS. Both closing cards were visually checked
with the supplied email, website and telephone. Matching silent masters have no audio stream.

### Original instrumental and optional replacement

`audio/synthesize.mjs` composes a reproducible 60-second stereo WAV at 48 kHz,
16-bit PCM: original sine-based pad voicings and arpeggio, a subtle pulse at 96 BPM,
and smooth attacks/fades. All notes and oscillators are generated procedurally.
There are no downloaded tracks, third-party samples, or sampled melodies requiring
a third-party track license. The generated `video/public/music.wav` is ignored by Git.
Regenerate it with `npm run audio:generate`, then run `npm run render:en:music` and
`npm run render:it:music`. The source WAV has peak 0.60 (-4.44 dBFS) and no clipping;
the promo mixes it at 30% with additional entrance/exit fades. This is an automatically
generated bed; no professional listening review is claimed. Silent masters remain available.
The music render scripts call `audio/finalize.mjs`: it trims AAC encoder padding to
60 seconds, preserves the video stream without re-encoding, enables fast-start playback
and exports matching silent masters. It uses the bundled Windows FFmpeg, or `ffmpeg`
on PATH elsewhere; set `PROMO_FFMPEG_PATH` to override the executable location.

For an owner-supplied **licensed replacement**, place the track at `video/public/music.mp3`
and render with `--props='{"music":true,"musicFile":"music.mp3"}'`.
That override is distinct from the included original procedural music.

The closing contact card uses the user-supplied details: **Marco Oliva**,
`marco.oliva@aveva.com`, `www.aveva.com`, `+39 3473495072`. The contact card does not
assert corporate ownership of, or endorsement for, WebFlowMaster.

## Filming the screens again

Needed after a UI change. The screenshots (`video/public/shots/`, not committed) come from
the collaudo stack (`collaudo/README.md`), in an organization of its own.

```bash
# 1. The demo storefront the tests run against, inside the stack
docker compose -p wfm-collaudo --env-file collaudo/collaudo.env -f docker-compose.yml -f collaudo/docker-compose.collaudo.yml \
  -f marketing/promo-video/docker-compose.demo.yml up -d shop

# 2. The organization "Northwind Commerce", owner maya / Demo.Video.2026!
docker compose -p wfm-collaudo --env-file collaudo/collaudo.env -f docker-compose.yml -f collaudo/docker-compose.collaudo.yml \
  exec -T api node --input-type=module < marketing/promo-video/demo/seed-org.mjs

# 3. Tests, plans, a schedule and ~40 real runs, through the product's API (15–20 minutes)
export NODE_EXTRA_CA_CERTS=collaudo/collaudo-root.crt
node marketing/promo-video/demo/build-data.mjs
ONLY_PLANS="Nightly regression,Checkout smoke,Orders API contract" node marketing/promo-video/demo/build-data.mjs

# 4. Spread the runs over the last two weeks, for the dashboard's trend
docker compose -p wfm-collaudo --env-file collaudo/collaudo.env -f docker-compose.yml -f collaudo/docker-compose.collaudo.yml \
  exec -T api node --input-type=module < marketing/promo-video/demo/spread-history.mjs

# 5. The screenshots, at 2x
node marketing/promo-video/demo/capture.mjs           # SHOTS=builder,report for a few
```

To start over: delete the organization as maya (`DELETE /api/organization` with
`{"confirmName":"Northwind Commerce"}`) and repeat from step 2.

**What is staged, and what is not.** The storefront (`demo/shop`) is a demo app built for the
video; one of its tests fails on purpose (the promo banner) so there is a failure to explain.
Every test, run, result, log, video and trace on screen is real. Only the dates of the runs are
moved (step 4), so the trend covers two weeks instead of one afternoon. The address in the
browser bar is a generic one (`webflowmaster.your-company.com`): the product is self-hosted.
