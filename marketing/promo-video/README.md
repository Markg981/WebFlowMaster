# WebFlowMaster promo video

A 60-second, 16:9 promo (1920×1080, 30 fps, English on-screen text) made with
[Remotion](https://www.remotion.dev): the video is React code in `video/`, rendered to MP4.
Every screen in it is the real product, filmed in a demo organization on the collaudo stack.

| Scene | Seconds | Shows |
|---|---|---|
| Hook | 0–5 | "Every release. Every browser. Every click, by hand?" |
| Logo | 5–8.5 | The mark and the tagline |
| Build | 8.5–20.5 | A test described in sentences, checked line by line, run and passing |
| APIs | 20.5–25.5 | The API tester: request, assertions, captures |
| Run | 25.5–33.5 | A plan on three browsers, with its live log |
| Understand | 33.5–41.5 | The evidence of a failed step: video, trace, network, the error |
| Measure | 41.5–47.5 | The dashboard: success rate, 30-day trend, schedules |
| Connect | 47.5–53.5 | CI/CD, GitHub/GitLab, Jira/Azure DevOps, webhooks, agents, SSO/MFA/audit |
| Call to action | 53.5–60 | "Ship every release with confidence." + button |

## Render

```bash
cd marketing/promo-video/video
npm install
npm run studio            # preview and scrub in the browser
npm run render            # out/webflowmaster-promo.mp4
```

The call to action is a prop: `npx remotion render Promo out/promo.mp4 --props='{"cta":"Book a demo"}'`.

**Music.** The video is cut for a track but ships without one: a licensed track is needed.
Put it at `video/public/music.mp3` (it is not committed) and run `npm run render:music`; it
fades in and out on its own.

## Filming the screens again

Needed after a UI change. The screenshots (`video/public/shots/`, not committed) come from
the collaudo stack (`collaudo/README.md`), in an organization of its own.

```bash
# 1. The demo storefront the tests run against, inside the stack
docker compose -p wfm-collaudo -f docker-compose.yml -f collaudo/docker-compose.collaudo.yml \
  -f marketing/promo-video/docker-compose.demo.yml up -d shop

# 2. The organization "Northwind Commerce", owner maya / Demo.Video.2026!
docker compose -p wfm-collaudo -f docker-compose.yml -f collaudo/docker-compose.collaudo.yml \
  exec -T api node --input-type=module < marketing/promo-video/demo/seed-org.mjs

# 3. Tests, plans, a schedule and ~40 real runs, through the product's API (15–20 minutes)
export NODE_EXTRA_CA_CERTS=collaudo/collaudo-root.crt
node marketing/promo-video/demo/build-data.mjs
ONLY_PLANS="Nightly regression,Checkout smoke,Orders API contract" node marketing/promo-video/demo/build-data.mjs

# 4. Spread the runs over the last two weeks, for the dashboard's trend
docker compose -p wfm-collaudo -f docker-compose.yml -f collaudo/docker-compose.collaudo.yml \
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
