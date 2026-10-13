import React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  spring,
} from 'remotion';
import { BellRing, GitBranch, Radar, ShieldCheck, Terminal, Ticket } from 'lucide-react';
import {
  Backdrop,
  Chip,
  Eyebrow,
  Headline,
  LogoMark,
  Pointer,
  SceneFade,
  Screen,
  type Camera,
} from './components';
import { colors, fontFamily, s } from './theme';
// The brochure reads the same file: one place to change the commercial contact.
import contact from '../../../contact.json';
import { LanguageContext, useCopy, type Language } from './copy';
import {
  FormatContext,
  placeScenes,
  useFormat,
  VOICE_LEAD,
  type CutId,
  type FormatId,
  type SceneId,
} from './cuts';
import { useClip, useVoiceover, type Cue } from './media';

export type PromoProps = {
  /** Plays music under the video: `musicFile`, at `musicVolume`. */
  music: boolean;
  /** The track under public/: the published one of audio/music.json, or music.wav. */
  musicFile?: string;
  /** Its level under the picture; the voice-over takes it down further while it speaks. */
  musicVolume?: number;
  /** The voice-over of public/voice/ (audio/narrate.mjs). */
  voice?: boolean;
  /** Captions burned into the picture; on by default in the square and vertical formats. */
  captions?: boolean;
  lang?: Language;
  cut?: CutId;
  format?: FormatId;
  /** The call to action on the closing card. */
  cta: string;
};

// Self-hosted: the address is the customer's own, so the bar shows a generic one.
const URL = 'webflowmaster.your-company.com';

/** Sizes that change with the format: the product is narrower when the text sits above it. */
const useLayout = () => {
  const { format, stacked, width } = useFormat();
  return {
    format,
    stacked,
    screen: stacked ? width - 100 : 1160,
    headline: format === 'square' ? 60 : 76,
    sub: format === 'square' ? 0 : format === 'vertical' ? 32 : 30,
  };
};

/** A still of the product, filmed in the edition's language (demo/capture.mjs). */
const useShot = () => {
  const lang = React.useContext(LanguageContext);
  return (name: string) => `shots/${lang}/${name}.png`;
};

/** Text and the product: side by side in 16:9, the text above the product otherwise. */
const Split: React.FC<{ text: React.ReactNode; children: React.ReactNode }> = ({
  text,
  children,
}) => {
  const { format, stacked, screen } = useLayout();
  if (stacked) {
    const top = format === 'vertical' ? 230 : 56;
    return (
      <AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            left: 50,
            right: 50,
            top,
            height: format === 'vertical' ? 470 : 330,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            gap: 22,
          }}
        >
          {text}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 50,
            top: top + (format === 'vertical' ? 520 : 370),
            width: screen,
          }}
        >
          {children}
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: 110,
          top: 0,
          bottom: 0,
          width: 540,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 28,
        }}
      >
        {text}
      </div>
      <div style={{ position: 'absolute', left: 690, top: 186 }}>{children}</div>
    </AbsoluteFill>
  );
};

const Sub: React.FC<{ text: string; delay?: number }> = ({ text, delay = 10 }) => {
  const copy = useCopy();
  const frame = useCurrentFrame();
  const { sub } = useLayout();
  const o = interpolate(frame - delay, [0, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // The square format has no room for a second line of text: the voice and captions carry it.
  if (!sub) return null;
  return (
    <div
      style={{
        fontFamily,
        fontSize: sub,
        lineHeight: 1.4,
        color: colors.muted,
        opacity: o,
        transform: `translateY(${(1 - o) * 16}px)`,
      }}
    >
      {copy(text)}
    </div>
  );
};

/** One shot of a multi-shot scene, cross-fading into the next. */
const Shot: React.FC<{ from: number; duration: number; children: React.ReactNode }> = ({
  from,
  duration,
  children,
}) => (
  <Sequence from={from} durationInFrames={duration} layout="none">
    <FadeBox duration={duration}>{children}</FadeBox>
  </Sequence>
);
const FadeBox: React.FC<{ duration: number; children: React.ReactNode }> = ({
  duration,
  children,
}) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 10, duration - 10, duration], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return <div style={{ opacity: o, position: 'absolute', inset: 0 }}>{children}</div>;
};

/** A camera position; the point is kept inside what the zoom can show, so no edge ever appears. */
const cam = (at: number, zoom: number, x: number, y: number): Camera => {
  const lo = 0.5 / zoom;
  const fit = (v: number) => Math.min(1 - lo, Math.max(lo, v));
  return { at, zoom, x: fit(x), y: fit(y) };
};

type SceneProps = { d: number };

const Hook: React.FC<SceneProps> = ({ d }) => {
  const frame = useCurrentFrame();
  const { stacked } = useLayout();
  // Timed for 4.5 seconds, and squeezed to fit a shorter cut.
  const k = Math.min(1, d / s(4.5));
  const size = stacked ? 92 : 120;
  const strike = interpolate(frame, [95 * k, 115 * k], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill
      style={{ justifyContent: 'center', alignItems: 'center', gap: 18, padding: '0 50px' }}
    >
      <Headline text="Every release." size={size} align="center" />
      <Headline text="Every browser." size={size} align="center" delay={22 * k} />
      <div style={{ position: 'relative' }}>
        <Headline
          text="Every click, by hand?"
          size={size}
          align="center"
          delay={44 * k}
          color={colors.muted}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: '52%',
            height: 10,
            borderRadius: 5,
            width: `${strike * 100}%`,
            background: colors.red,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

/** The mark and the name: side by side, or stacked where the frame is narrow. */
const Brand: React.FC<{ mark: number; name: number; delay?: number }> = ({
  mark,
  name,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { stacked } = useLayout();
  const p = spring({ frame: frame - delay, fps, config: { damping: 18 } });
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: stacked ? 'column' : 'row',
        alignItems: 'center',
        gap: stacked ? 24 : 40,
      }}
    >
      <LogoMark size={stacked ? mark * 0.8 : mark} />
      <div
        style={{
          fontFamily,
          fontSize: stacked ? Math.min(name, 118) : name,
          fontWeight: 800,
          letterSpacing: '-0.045em',
          color: colors.white,
          opacity: p,
          transform: `translateX(${(1 - p) * -40}px)`,
        }}
      >
        WebFlow<span style={{ color: colors.sky }}>Master</span>
      </div>
    </div>
  );
};

const Logo: React.FC<SceneProps> = () => (
  <AbsoluteFill
    style={{ justifyContent: 'center', alignItems: 'center', gap: 40, padding: '0 50px' }}
  >
    <Brand mark={190} name={132} delay={14} />
    <Headline
      text="End-to-end testing your whole team can run."
      size={46}
      weight={500}
      align="center"
      delay={30}
      color={colors.muted}
    />
  </AbsoluteFill>
);

// Where the recorder clicked in the shop's login form, on the 1440x900 recording screen.
const SITE_CLICKS = { username: [493, 395], password: [493, 480], signIn: [328, 547] } as const;

/**
 * The recorder at work, filmed live: the shop in the recording window, a pointer filling its
 * login form, and the builder listing each action as it is captured.
 */
const Recorder: React.FC<{ duration: number }> = ({ duration }) => {
  const lang = React.useContext(LanguageContext);
  const { fps } = useVideoConfig();
  const { format, screen, stacked } = useLayout();
  const steps = useClip(lang, 'recorder-steps');
  const site = useClip(lang, 'recorder-site');
  if (!steps || !site) return null;
  const from = Math.max(0, site.marks.username - 0.4);
  const until = site.marks.captured + 0.6;
  // The whole recording, whatever the length of the shot: faster in a short cut.
  const rate = Math.min(3, Math.max(1, (until - from) / (duration / fps)));
  const footage = (src: string) => ({ src, from, rate });
  const siteWidth = Math.round(screen * (stacked ? 0.62 : 0.56));
  const siteHeight = (siteWidth * 900) / 1440;
  const clicks = (Object.keys(SITE_CLICKS) as Array<keyof typeof SITE_CLICKS>).map((mark) => ({
    at: Math.round(((site.marks[mark] - from) / rate) * fps) + 4,
    x: SITE_CLICKS[mark][0] / 1440,
    y: SITE_CLICKS[mark][1] / 900,
  }));
  return (
    <div style={{ position: 'relative', width: screen, height: screen * 0.6 }}>
      <Screen
        width={screen}
        footage={footage(steps.src)}
        url={`${URL}/create-test`}
        cameras={[cam(0, 1.6, 0.42, 0.6)]}
      />
      {/* The recording window on the right: the captured actions are listed on the left. */}
      <div
        style={{
          position: 'absolute',
          left: screen - siteWidth + (stacked ? 20 : 40),
          top: screen * (format === 'square' ? 0.14 : stacked ? 0.3 : 0.26),
        }}
      >
        <Screen
          width={siteWidth}
          aspect={900 / 1440}
          footage={footage(site.src)}
          url="shop.northwind.test/login/"
          enter={6}
          cameras={[cam(0, 1, 0.5, 0.5)]}
        >
          <Pointer width={siteWidth} height={siteHeight} clicks={clicks} />
        </Screen>
      </div>
    </div>
  );
};

const Build: React.FC<SceneProps> = ({ d }) => {
  const shot = useShot();
  const { screen, headline } = useLayout();
  const short = d < s(6);
  // The recording, then (in the longer cuts) the steps proposed from a description, then the
  // test passing.
  const recorded = Math.round(d * (short ? 0.6 : 0.48));
  const described = short ? recorded : Math.round(d * 0.74);
  return (
    <Split
      text={
        <>
          <Eyebrow text="Build" />
          <Sequence durationInFrames={described} layout="none">
            <Headline
              text="Record it, or describe it."
              accent={['Record', 'describe', 'Registralo', 'descrivilo']}
              size={headline}
              delay={6}
            />
            <Sub
              text="Click through your site and every action becomes a step. Or write the steps in plain words."
              delay={24}
            />
          </Sequence>
          <Sequence from={described} layout="none">
            <Headline text="Run it. Watch it pass." accent={['pass', 'passare']} size={headline} />
            <Sub text="No code to maintain." delay={16} />
          </Sequence>
        </>
      }
    >
      <div style={{ position: 'relative', width: screen, height: screen * 0.6 }}>
        <Shot from={0} duration={recorded}>
          <Recorder duration={recorded} />
        </Shot>
        {!short && (
          <Shot from={recorded - 10} duration={described - recorded + 10}>
            <Screen
              width={screen}
              src={shot('builder-proposed')}
              url={`${URL}/create-test`}
              enter={-100}
              cameras={[cam(0, 1.5, 0.5, 0.56), cam(described - recorded, 1.55, 0.5, 0.7)]}
            />
          </Shot>
        )}
        <Shot from={described - 10} duration={d - described + 10}>
          <Screen
            width={screen}
            src={shot('builder-passed')}
            url={`${URL}/create-test`}
            enter={-100}
            cameras={[
              cam(0, 1, 0.5, 0.5),
              cam(s(0.8), 1, 0.5, 0.5),
              cam(d - described, 1.8, 0.47, 0.13),
            ]}
          />
        </Shot>
      </div>
    </Split>
  );
};

/** BDD and native mobile, the two runners beyond the browser, shown rather than named. */
const Beyond: React.FC<SceneProps> = ({ d }) => {
  const lang = React.useContext(LanguageContext);
  const shot = useShot();
  const { screen, headline } = useLayout();
  const mobile = useClip(lang, 'mobile');
  const half = Math.round(d * 0.45);
  return (
    <Split
      text={
        <>
          <Eyebrow text="Beyond the browser" />
          <Headline
            text="Gherkin scenarios. Native apps."
            accent={['Gherkin', 'Native', 'native']}
            size={headline}
            delay={6}
          />
          <Sub
            text="Run BDD features, and test Android and iOS apps with Appium: inspector, recorder, device matrices."
            delay={24}
          />
        </>
      }
    >
      <div style={{ position: 'relative', width: screen, height: screen * 0.6 }}>
        <Shot from={0} duration={half}>
          <Screen
            width={screen}
            src={shot('bdd')}
            url={`${URL}/tests`}
            cameras={[cam(0, 1.6, 0.5, 0.36), cam(half, 1.7, 0.5, 0.5)]}
          />
        </Shot>
        <Shot from={half - 10} duration={d - half + 10}>
          <Screen
            width={screen}
            footage={
              mobile && { src: mobile.src, from: Math.max(0, mobile.marks.tap - 0.3), rate: 1.4 }
            }
            url={`${URL}/mobile-tests`}
            enter={-100}
            cameras={[cam(0, 1.35, 0.5, 0.5), cam(d - half, 1.45, 0.48, 0.45)]}
          />
        </Shot>
      </div>
    </Split>
  );
};

const Api: React.FC<SceneProps> = ({ d }) => {
  const shot = useShot();
  const { screen, headline } = useLayout();
  return (
    <Split
      text={
        <>
          <Eyebrow text="APIs too" />
          <Headline
            text="Assert, capture, chain."
            accent={['chain', 'Collega']}
            size={headline}
            delay={6}
          />
          <Sub
            text="Test the services behind the screens, and pass values from one request to the next."
            delay={26}
          />
        </>
      }
    >
      <Screen
        width={screen}
        src={shot('api')}
        url={`${URL}/api-tester`}
        cameras={[cam(0, 1.5, 0.62, 0.2), cam(d * 0.3, 1.5, 0.62, 0.2), cam(d, 1.5, 0.45, 0.9)]}
      />
    </Split>
  );
};

const Run: React.FC<SceneProps> = ({ d }) => {
  const lang = React.useContext(LanguageContext);
  const { screen, headline } = useLayout();
  const run = useClip(lang, 'run');
  return (
    <Split
      text={
        <>
          <Eyebrow text="Run" />
          <Headline
            text="Every browser. In parallel."
            accent={['parallel', 'parallelo']}
            size={headline}
            delay={6}
          />
          <Sub
            text="Chromium, Firefox and WebKit. Dedicated runners for web, mobile and BDD."
            delay={26}
          />
        </>
      }
    >
      <Screen
        width={screen}
        footage={run && { src: run.src, from: Math.max(0, run.marks.start - 0.3), rate: 1.25 }}
        url={`${URL}/test-plan/nightly/run`}
        cameras={[cam(0, 1, 0.5, 0.5), cam(d * 0.25, 1, 0.5, 0.5), cam(d, 1.45, 0.7, 0.55)]}
      />
    </Split>
  );
};

const Report: React.FC<SceneProps> = ({ d }) => {
  const shot = useShot();
  const { screen, headline } = useLayout();
  return (
    <Split
      text={
        <>
          <Eyebrow text="Understand" />
          <Headline
            text="Know exactly why it failed."
            accent={['why', 'perché']}
            size={headline}
            delay={6}
          />
          <Sub
            text="The failing step, its screenshot, the video, the Playwright trace and the network log — one click away."
            delay={26}
          />
        </>
      }
    >
      {/* The failed test's evidence, opened from its report: video, trace, network, and the step
          that failed with what it expected and what it found. */}
      <Screen
        width={screen}
        src={shot('report-log')}
        url={`${URL}/reports/catalog-checks`}
        cameras={[
          cam(0, 2.25, 0.5, 0.32),
          cam(d * 0.35, 2.25, 0.5, 0.32),
          cam(d * 0.55, 2.25, 0.5, 0.53),
          cam(d * 0.9, 2.25, 0.5, 0.7),
        ]}
      />
    </Split>
  );
};

const Dashboard: React.FC<SceneProps> = ({ d }) => {
  const shot = useShot();
  const { screen, headline } = useLayout();
  return (
    <Split
      text={
        <>
          <Eyebrow text="Measure" />
          <Headline
            text="Quality, at a glance."
            accent={['glance', 'qualità']}
            size={headline}
            delay={6}
          />
          <Sub
            text="Success rate, trends, what runs next and what just failed — for the whole team."
            delay={26}
          />
        </>
      }
    >
      <Screen
        width={screen}
        src={shot('dashboard')}
        url={`${URL}/dashboard`}
        cameras={[
          cam(0, 1.6, 0.35, 0.2),
          cam(d * 0.25, 1.6, 0.35, 0.2),
          cam(d * 0.65, 1.6, 0.78, 0.42),
          cam(d, 1.05, 0.5, 0.5),
        ]}
      />
    </Split>
  );
};

const CHIPS: Array<
  [React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>, string]
> = [
  [Terminal, 'CI/CD, CLI & REST API'],
  [GitBranch, 'GitHub & GitLab checks'],
  [Ticket, 'Jira & Azure DevOps issues'],
  [BellRing, 'Slack, Teams & webhook alerts'],
  [Radar, 'Agents for private networks'],
  [ShieldCheck, 'SSO, MFA & audit log'],
];

const Integrations: React.FC<SceneProps> = () => {
  const { format, stacked } = useLayout();
  const columns = format === 'vertical' ? 1 : format === 'square' ? 2 : 3;
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        gap: stacked ? 50 : 70,
        padding: '0 50px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
        <Eyebrow text="Connect" />
        <Headline
          text="Fits the way your team ships."
          accent={['ships', 'team']}
          size={stacked ? 72 : 88}
          align="center"
          delay={6}
        />
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 540px)`,
          gap: 26,
          transform: format === 'square' ? 'scale(0.86)' : undefined,
        }}
      >
        {CHIPS.map(([icon, label], i) => (
          <Chip key={label} icon={icon} label={label} delay={22 + i * 6} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Cta: React.FC<SceneProps & { cta: string }> = ({ cta }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { stacked } = useLayout();
  const button = spring({ frame: frame - 34, fps, config: { damping: 14 } });
  const glow = 0.5 + Math.sin(frame / 8) * 0.25;
  return (
    <AbsoluteFill
      style={{ justifyContent: 'center', alignItems: 'center', gap: 40, padding: '0 50px' }}
    >
      <Brand mark={130} name={96} />
      <Headline
        text="Ship every release with confidence."
        accent={['confidence', 'fiducia']}
        size={stacked ? 60 : 70}
        align="center"
        delay={10}
      />
      <div
        style={{
          marginTop: 10,
          fontFamily,
          fontSize: 38,
          fontWeight: 700,
          color: colors.white,
          padding: '24px 56px',
          borderRadius: 999,
          background: `linear-gradient(135deg, ${colors.blue}, ${colors.blueDeep})`,
          boxShadow: `0 0 ${60 * glow}px ${colors.blue}AA, 0 20px 50px ${colors.night}`,
          opacity: button,
          transform: `scale(${0.8 + button * 0.2})`,
        }}
      >
        {cta} →
      </div>
      {/* The demo request page, short so it can be read and typed; until there is one, the email. */}
      <div
        style={{
          fontFamily,
          fontSize: 44,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          color: colors.sky,
          opacity: button,
        }}
      >
        {contact.demoUrl || contact.email}
      </div>
      <div
        style={{
          fontFamily,
          fontSize: 27,
          lineHeight: 1.5,
          textAlign: 'center',
          color: colors.muted,
          opacity: button,
        }}
      >
        <div style={{ color: colors.white }}>
          {[contact.name, contact.demoUrl ? contact.email : contact.website].join(' · ')}
        </div>
        {contact.phone ? <div>{contact.phone}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

const SCENES: Record<SceneId, React.FC<SceneProps & { cta: string }>> = {
  hook: Hook,
  logo: Logo,
  build: Build,
  beyond: Beyond,
  api: Api,
  run: Run,
  report: Report,
  dashboard: Dashboard,
  integrations: Integrations,
  cta: Cta,
};

/** The line being spoken, burned into the picture: feeds play videos muted until tapped. */
const Captions: React.FC<{ cues: Cue[] }> = ({ cues }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { format } = useFormat();
  const t = frame / fps;
  const cue = cues.find((c) => t >= c.start && t < c.end + 0.15);
  if (!cue) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 40,
        right: 40,
        bottom: format === 'vertical' ? 250 : 36,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          fontFamily,
          fontSize: format === 'vertical' ? 44 : 36,
          fontWeight: 600,
          lineHeight: 1.3,
          textAlign: 'center',
          whiteSpace: 'pre-line',
          color: colors.white,
          background: `${colors.night}D9`,
          borderRadius: 14,
          padding: '12px 24px',
        }}
      >
        {cue.text}
      </div>
    </div>
  );
};

export const Promo: React.FC<PromoProps> = ({
  music,
  cta,
  voice = false,
  captions,
  lang = 'en',
  cut = 'full',
  format = 'landscape',
  musicFile = 'music.wav',
  musicVolume = 0.3,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const burn = captions ?? format !== 'landscape';
  const { timing, captions: cues } = useVoiceover(voice || burn);
  const scenes = placeScenes(cut);
  const lead = s(VOICE_LEAD);
  // While the voice speaks, the music steps back.
  const spoken = scenes.flatMap(({ id, from }) => {
    const seconds = timing?.[lang]?.[cut]?.[id];
    return voice && seconds ? [[from + lead, from + lead + s(seconds)]] : [];
  });
  const musicLevel = (f: number) => {
    const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
    const duck = Math.max(
      0,
      ...spoken.map(([a, b]) => interpolate(f, [a - 8, a, b, b + 8], [0, 1, 1, 0], clamp)),
    );
    const edges = interpolate(
      f,
      [0, 30, durationInFrames - 60, durationInFrames],
      [0, 1, 1, 0],
      clamp,
    );
    return musicVolume * edges * (1 - 0.6 * duck);
  };
  return (
    <FormatContext.Provider value={format}>
      <LanguageContext.Provider value={lang}>
        <AbsoluteFill style={{ background: colors.night }}>
          <Backdrop />
          {music && <Audio src={staticFile(musicFile)} volume={musicLevel} />}
          {scenes.map(({ id, from, duration, voice: line }) => {
            const Scene = SCENES[id];
            return (
              <React.Fragment key={id}>
                <Sequence from={from} durationInFrames={duration} premountFor={30}>
                  <SceneFade duration={duration}>
                    <Scene d={duration} cta={cta} />
                  </SceneFade>
                </Sequence>
                {voice && line?.[lang] && (
                  <Sequence from={from + lead} durationInFrames={duration - lead}>
                    <Audio src={staticFile(`voice/${lang}/${cut}-${id}.wav`)} />
                  </Sequence>
                )}
              </React.Fragment>
            );
          })}
          {burn && cues?.[lang]?.[cut] && <Captions cues={cues[lang][cut]} />}
          {/* A thin progress line along the bottom, the one element present from start to end. */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              bottom: 0,
              height: 4,
              width: `${(frame / durationInFrames) * 100}%`,
              background: `linear-gradient(90deg, ${colors.blueDeep}, ${colors.sky})`,
            }}
          />
        </AbsoluteFill>
      </LanguageContext.Provider>
    </FormatContext.Provider>
  );
};
