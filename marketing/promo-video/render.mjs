/**
 * Renders the release set of the promo, with voice-over and music, into video/out/:
 *
 *   webflowmaster-promo-<lang>.mp4                 60 s, 16:9      (+ -silent: picture only)
 *   webflowmaster-promo-<lang>-30s.mp4             30 s, 16:9      (+ -square, -vertical)
 *   webflowmaster-promo-<lang>-15s.mp4             15 s, 16:9      (+ -square, -vertical)
 *   webflowmaster-promo-<lang>-thumbnail.png       1280x720 cover
 *   webflowmaster-promo-<lang>-description.txt     text and tracked links to post with them
 *
 *   node marketing/promo-video/render.mjs                    # everything, en and it
 *   node marketing/promo-video/render.mjs it short-vertical  # a language, and some editions
 *
 * Needs the screens (demo/capture.mjs), the voice-over (audio/narrate.mjs) and the music
 * (audio/fetch-music.mjs: the track of audio/music.json; without it, audio/synthesize.mjs).
 * The 16:9 editions carry captions as SRT files beside them (video/captions/); the square and
 * vertical ones, made for feeds that play muted, have them burned in.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ffmpeg } from './ffmpeg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIDEO = path.join(HERE, 'video');
const OUT = path.join(VIDEO, 'out');
const story = JSON.parse(readFileSync(path.join(HERE, 'narration.json'), 'utf8'));
const contact = JSON.parse(readFileSync(path.join(HERE, '..', 'contact.json'), 'utf8'));

const FORMAT_SUFFIX = { landscape: '', square: '-square', vertical: '-vertical' };
// What goes out: every cut in 16:9, and the two short ones for social feeds.
export const RELEASE = [
  ['full', 'landscape'],
  ['short', 'landscape'],
  ['teaser', 'landscape'],
  ['short', 'square'],
  ['short', 'vertical'],
  ['teaser', 'square'],
  ['teaser', 'vertical'],
];

const args = process.argv.slice(2);
const languages = args.filter((a) => a in story.voices);
const only = args.filter((a) => !(a in story.voices));
const editions = RELEASE.filter(
  ([cut, format]) => !only.length || only.includes(`${cut}-${format}`),
);

const remotion = (command, id, file, props) => {
  // Props through a file: the Windows shell strips the quotes of inline JSON.
  const propsFile = path.join(tmpdir(), `wfm-promo-props-${id}.json`);
  writeFileSync(propsFile, JSON.stringify(props));
  const result = spawnSync('npx', ['remotion', command, id, file, `--props=${propsFile}`], {
    cwd: VIDEO,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  rmSync(propsFile, { force: true });
  if (result.status !== 0) throw new Error(`remotion ${command} ${id} failed`);
};

const music = JSON.parse(readFileSync(path.join(HERE, 'audio', 'music.json'), 'utf8'));

/**
 * Tracked link to the demo page, so a request says which video and which channel it came from;
 * until there is a page, an email to the contact.
 */
const link = (lang, source, medium = 'video') =>
  contact.demoUrl
    ? `https://${contact.demoUrl}?utm_source=${source}&utm_medium=${medium}&utm_campaign=promo-${lang}`
    : `mailto:${contact.email}?subject=WebFlowMaster%20demo%20(${source})`;

const DESCRIPTION = {
  en: (lang) => `WebFlowMaster: end-to-end testing your whole team can run.

Record a flow by clicking through your site, or describe it in plain words. Run it on Chromium, Firefox and WebKit, test APIs, Gherkin scenarios and native Android and iOS apps, and see exactly why a test failed: the step, the video, the Playwright trace and the network log. Self-hosted, with CI/CD, GitHub, GitLab, Jira, Azure DevOps, SSO and MFA.

Request a demo: ${link(lang, 'youtube')}

LinkedIn: ${link(lang, 'linkedin', 'social')}
Email signature / newsletter: ${link(lang, 'email', 'email')}
`,
  it: (lang) => `WebFlowMaster: test end-to-end per tutto il team.

Registra un flusso cliccando sul sito, oppure descrivilo a parole. Eseguilo su Chromium, Firefox e WebKit, testa API, scenari Gherkin e app native Android e iOS, e scopri esattamente perché un test è fallito: il passo, il video, la traccia Playwright e il log di rete. Nella vostra infrastruttura, con CI/CD, GitHub, GitLab, Jira, Azure DevOps, SSO e MFA.

Richiedi una demo: ${link(lang, 'youtube')}

LinkedIn: ${link(lang, 'linkedin', 'social')}
Firma email / newsletter: ${link(lang, 'email', 'email')}
`,
};

mkdirSync(OUT, { recursive: true });
// The published track of music.json when it has been downloaded, the procedural bed otherwise.
const track = existsSync(path.join(VIDEO, 'public', music.file));
const musicFile = process.env.PROMO_MUSIC_FILE || (track ? music.file : 'music.wav');
const credit =
  musicFile === music.file
    ? `
${music.attribution}
`
    : '';
for (const lang of languages.length ? languages : Object.keys(story.voices)) {
  for (const [cut, format] of editions) {
    const name = `webflowmaster-promo-${lang}${story.cuts[cut].suffix}${FORMAT_SUFFIX[format]}`;
    const file = path.join(OUT, `${name}.mp4`);
    console.log(`\n${name}`);
    remotion('render', `Promo-${lang}-${cut}-${format}`, file, {
      music: true,
      voice: true,
      musicFile,
      musicVolume: musicFile === music.file ? music.volume : 0.3,
      lang,
      cut,
      format,
      cta: lang === 'it' ? 'Richiedi una demo' : 'Request a demo',
    });
    // The picture as rendered; the audio cut to the last frame (AAC pads its end), and the
    // index at the front so a browser starts playing before the whole file has arrived.
    const seconds = story.cuts[cut].scenes.reduce((sum, scene) => sum + scene.seconds, 0);
    const final = file.replace(/\.mp4$/, '.final.mp4');
    // prettier-ignore
    ffmpeg(['-i', file, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-t', String(seconds), '-movflags', '+faststart', final]);
    renameSync(final, file);
    if (cut === 'full' && format === 'landscape') {
      // prettier-ignore
      ffmpeg(['-i', file, '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart',
        path.join(OUT, `${name}-silent.mp4`)]);
    }
  }
  if (!only.length) {
    remotion(
      'still',
      `Thumbnail-${lang}`,
      path.join(OUT, `webflowmaster-promo-${lang}-thumbnail.png`),
      {
        lang,
      },
    );
    writeFileSync(
      path.join(OUT, `webflowmaster-promo-${lang}-description.txt`),
      DESCRIPTION[lang](lang) + credit,
    );
  }
}
