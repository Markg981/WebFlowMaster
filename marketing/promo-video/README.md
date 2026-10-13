# WebFlowMaster promo video

The promo in **English and Italian**, made with [Remotion](https://www.remotion.dev): the video
is React code in `video/`, rendered to MP4. Every screen in it is the real product, filmed in a
demo organization on the collaudo stack, **in the edition's own language**: the Italian edition
shows the product's Italian UI. Three moments are live recordings rather than stills: the
recorder capturing clicks in the shop, a plan run streaming its log, and the mobile inspector
tapping an Android emulator.

## Deliverables / Consegna

`npm run render` (in `video/`) writes, for `en` and `it`, into `video/out/`:

| File                                         | Length | Shape    | For                                  |
| -------------------------------------------- | ------ | -------- | ------------------------------------ |
| `webflowmaster-promo-<lang>.mp4`             | 60 s   | 16:9     | site, YouTube, presentations         |
| `webflowmaster-promo-<lang>-silent.mp4`      | 60 s   | 16:9     | the picture only, to re-voice        |
| `webflowmaster-promo-<lang>-30s.mp4`         | 30 s   | 16:9     | pre-roll, email                      |
| `webflowmaster-promo-<lang>-15s.mp4`         | 15 s   | 16:9     | bumper                               |
| `…-30s-square.mp4`, `…-15s-square.mp4`       | 30/15  | 1:1      | LinkedIn and feeds (captions burned) |
| `…-30s-vertical.mp4`, `…-15s-vertical.mp4`   | 30/15  | 9:16     | stories, shorts (captions burned)    |
| `webflowmaster-promo-<lang>-thumbnail.png`   |        | 1280×720 | cover before playback                |
| `webflowmaster-promo-<lang>-description.txt` |        |          | post text with tracked demo links    |

Captions are in `video/captions/` (`webflowmaster-promo-<lang>[-30s|-15s].srt`): they are the
**transcript of the voice-over**, timed on the spoken audio, so they serve as accessibility
captions. Video outputs and their inputs (screens, clips, voice, music) are ignored by Git.

Ogni edizione ha la voce narrante nella propria lingua, i sottotitoli sono la trascrizione di
quello che dice la voce, e le schermate del prodotto sono nella lingua dell'edizione. I tagli da
30 e 15 secondi esistono anche quadrati e verticali, con i sottotitoli impressi nell'immagine
perché i feed partono senza audio.

## The story

[`narration.json`](narration.json) tells every cut: its scenes, how long each lasts, and the
line the voice says over it, in both languages. The video, the voice-over and the captions all
read it. The 60-second cut:

| Scene      | Seconds   | Shows                                                                          |
| ---------- | --------- | ------------------------------------------------------------------------------ |
| Hook       | 0–4.5     | "Every release. Every browser. Every click, by hand?"                          |
| Logo       | 4.5–7.5   | The mark and the tagline                                                       |
| Build      | 7.5–18.5  | Live: the recorder capturing a sign-in; steps from a description; pass         |
| Beyond     | 18.5–25.5 | A Gherkin feature; live: the mobile inspector on the Android emulator          |
| APIs       | 25.5–30   | The API tester: request, assertions, captures                                  |
| Run        | 30–37     | Live: a plan running on Chromium, Firefox and WebKit, log streaming            |
| Understand | 37–44     | The evidence of a failed step: video, trace, network, the error                |
| Measure    | 44–49     | The dashboard: success rate, trend, schedules                                  |
| Connect    | 49–54     | CI/CD, GitHub/GitLab, Jira/Azure DevOps, Slack/Teams/webhooks, agents, SSO/MFA |
| CTA        | 54–60     | "Request a demo", the demo page address, the contact                           |

The 30-second cut keeps hook, build, beyond, run, report and CTA; the 15-second one hook, build,
report and CTA. Each scene lays out its shots in proportion to its length, so a cut is only a
list of scenes and seconds. The on-screen copy is in `video/src/Promo.tsx`, its Italian in
`video/src/copy.tsx`; `scripts/promo-video.test.ts` fails if an overlay has no Italian, a cut
does not last what its name says, or the committed captions no longer match the narration.
The capabilities the overlays and the voice name are listed in `../claims.json`.

## Render

`video/` has its own `package.json` and lockfile and is not one of the root npm workspaces, so the
root `npm ci`, `npm audit` and Dependabot do not cover it. It is a local authoring tool that never
ships in the product images; run `npm audit` inside `video/` before rendering a release cut.

```bash
npm run marketing:refresh            # from the repository root: film, voice, music, render, brochure

cd marketing/promo-video/video       # or step by step
npm ci
npm run voice                        # voice-over and captions (audio/narrate.mjs)
npm run music                        # the music track (audio/fetch-music.mjs)
npm run render                       # the release set above (../render.mjs)
node ../render.mjs it short-vertical # one language, some editions
npm run studio                       # preview and scrub: Promo-<lang>-<cut>-<format>
```

Run `npm run marketing:refresh` before each release, so the materials show the release being
sold. `-- --skip-capture` rebuilds from the screens already filmed.

### Voice-over

[`audio/narrate.mjs`](audio/narrate.mjs) speaks each line with [Piper](https://github.com/OHF-Voice/piper1-gpl),
a neural text-to-speech that runs offline. The first run creates a Python virtual environment in
`.local/piper` (Python 3.10+ needed; `PIPER_PYTHON` points at another interpreter) and downloads
the voices `en_US-joe-medium` and `it_IT-paola-medium`, both trained on **CC0** recordings, so
the audio can be used commercially. (Avoid `en_US-ryan`: its dataset is CC BY-NC-SA.) A line that
would still be speaking when its scene ends stops the script: shorten it in `narration.json`, or
lower the voice's `lengthScale`. While the voice speaks, the music dips to 40%.

This is a first pass, as the improvement plan allows. For the final version, record a real voice:
one WAV per line, named `voice/<lang>/<cut>-<scene>.wav` under `video/public/`, then
`npm run captions` after updating `voice/timing.json` with their lengths.

### Music

The music is a published track, [`audio/music.json`](audio/music.json): **"Inspired" by Kevin
MacLeod** (incompetech.com), under **CC BY 4.0**, so it can be used commercially as long as the
credit goes with the video. `npm run music` downloads it into `video/public/` (not committed);
the render plays it at the `volume` of `music.json`, halved while the voice speaks, and appends
the credit line to every `description.txt`. Keep that line wherever the video is published.

To change it, edit `music.json` (source, credit, level) and delete `video/public/music.mp3`.
Without the track, the render falls back to the original procedural bed of
`audio/synthesize.mjs` (`npm run audio:generate`), which needs no credit but sounds synthetic.
`PROMO_MUSIC_FILE` names any other file under `video/public/`. The render trims the AAC padding
to the last frame and writes the 60-second silent master.

### Call to action

The closing card shows "Request a demo" over the contact of [`../contact.json`](../contact.json),
which the brochure reads too (aveva.com). `demoUrl` there is the address of the demo request page
once it is hosted: the card then shows it instead of the email, and the `description.txt` files
link to it with `utm_source`/`utm_medium`/`utm_campaign` per channel, which the page's form sends
along, so a request says which video brought it. Until then they link to a pre-filled email.
The page is [`../landing/index.html`](../landing/index.html): static, English and Italian, with a
form that posts to a form service once one is configured and opens an email until then.

## Filming the screens again

The screens (`video/public/shots/<lang>/`) and clips (`video/public/clips/<lang>/`) come from the
collaudo stack (`collaudo/README.md`), in an organization of their own.

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

# 5. The screens and clips, in both languages
npm run collaudo:mobile                              # the Android emulator, for the mobile clip
node marketing/promo-video/demo/capture.mjs          # LANGS=it SHOTS=recorder,run for a few
```

The recorder clip needs the stack's virtual screen (the `display` service: noVNC on
`localhost:6080`), where the recording window opens; the script clicks there and films the
screen and the builder together. The mobile clip needs the emulator and the "Lab" local Appium
grid of organization Acme (collaudo area MOB). The clips are filmed from Chromium's screencast
(and the noVNC canvas) and encoded with the FFmpeg that Remotion bundles; `PROMO_FFMPEG_PATH`
points at another one.

To start over: delete the organization as maya (`DELETE /api/organization` with
`{"confirmName":"Northwind Commerce"}`) and repeat from step 2.

**What is staged, and what is not.** The storefront (`client/public/demo-shop`, also the sample project's) is a demo app built for the
video; one of its tests fails on purpose (the promo banner) so there is a failure to explain.
Every test, run, result, log, video and trace on screen is real, and the live clips are real
sessions, sped up to fit their scene. Only the dates of the runs are moved (step 4), so the trend
covers two weeks instead of one afternoon. The address in the browser bar is a generic one
(`webflowmaster.your-company.com`): the product is self-hosted. The pointer in the recorder clip
is drawn by the video where the script clicked: noVNC does not show the remote cursor.
