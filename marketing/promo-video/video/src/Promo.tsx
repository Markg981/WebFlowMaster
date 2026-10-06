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
  SceneFade,
  Screen,
  type Camera,
} from './components';
import { colors, fontFamily, s } from './theme';
import { LanguageContext, useCopy, type Language } from './copy';

export type PromoProps = {
  /** Plays the original procedural public/music.wav instrumental quietly under the video. */
  music: boolean;
  /** Optional licensed replacement supplied by the owner; a filename under public/. */
  musicFile?: string;
  lang?: Language;
  /** The call to action on the closing card. */
  cta: string;
};

// Self-hosted: the address is the customer's own, so the bar shows a generic one.
const URL = 'webflowmaster.your-company.com';

/** The scenes, in order, with their length in seconds. */
const SCENES = [
  ['hook', 5],
  ['logo', 3.5],
  ['build', 12],
  ['api', 5],
  ['run', 8],
  ['report', 8],
  ['dashboard', 6],
  ['integrations', 6],
  ['cta', 6.5],
] as const;

type SceneId = (typeof SCENES)[number][0];
const starts = SCENES.reduce<Record<string, [number, number]>>((acc, [id, sec], i) => {
  const from = i === 0 ? 0 : acc[SCENES[i - 1][0]][0] + acc[SCENES[i - 1][0]][1];
  acc[id] = [from, s(sec)];
  return acc;
}, {});
export const PROMO_FRAMES = Object.values(starts).reduce(
  (end, [from, len]) => Math.max(end, from + len),
  0,
);

const Scene: React.FC<{ id: SceneId; children: React.ReactNode }> = ({ id, children }) => {
  const [from, duration] = starts[id];
  return (
    <Sequence from={from} durationInFrames={duration} premountFor={30}>
      <SceneFade duration={duration}>{children}</SceneFade>
    </Sequence>
  );
};

/** Text on the left, the product on the right, whole: the camera can frame any part of it. */
const Split: React.FC<{ text: React.ReactNode; children: React.ReactNode }> = ({
  text,
  children,
}) => (
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

const Sub: React.FC<{ text: string; delay?: number }> = ({ text, delay = 10 }) => {
  const copy = useCopy();
  const frame = useCurrentFrame();
  const o = interpolate(frame - delay, [0, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        fontFamily,
        fontSize: 30,
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

const SCREEN_W = 1160;

/** A camera position; the point is kept inside what the zoom can show, so no edge ever appears. */
const cam = (at: number, zoom: number, x: number, y: number): Camera => {
  const lo = 0.5 / zoom;
  const fit = (v: number) => Math.min(1 - lo, Math.max(lo, v));
  return { at, zoom, x: fit(x), y: fit(y) };
};

const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const strike = interpolate(frame, [95, 115], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 18 }}>
      <Headline text="Every release." size={120} align="center" />
      <Headline text="Every browser." size={120} align="center" delay={22} />
      <div style={{ position: 'relative' }}>
        <Headline
          text="Every click, by hand?"
          size={120}
          align="center"
          delay={44}
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

const Logo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const name = spring({ frame: frame - 14, fps, config: { damping: 18 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
        <LogoMark size={190} />
        <div
          style={{
            fontFamily,
            fontSize: 132,
            fontWeight: 800,
            letterSpacing: '-0.045em',
            color: colors.white,
            opacity: name,
            transform: `translateX(${(1 - name) * -40}px)`,
          }}
        >
          WebFlow<span style={{ color: colors.sky }}>Master</span>
        </div>
      </div>
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
};

const Build: React.FC = () => (
  <Split
    text={
      <>
        <Eyebrow text="Build" />
        <Sequence durationInFrames={s(8)} layout="none">
          <Headline text="Describe it. It becomes a test." accent={['test']} size={76} delay={6} />
          <Sub
            text="Describe the steps. Validate them against the page. Or bring your Gherkin scenarios with BDD."
            delay={30}
          />
        </Sequence>
        <Sequence from={s(8)} layout="none">
          <Headline text="Run it. Watch it pass." accent={['pass']} size={76} />
          <Sub text="No code, no recorder scripts to maintain." delay={20} />
        </Sequence>
      </>
    }
  >
    <div style={{ position: 'relative', width: SCREEN_W, height: 720 }}>
      <Shot from={0} duration={s(4)}>
        <Screen
          width={SCREEN_W}
          src="builder-describe.png"
          url={`${URL}/create-test`}
          cameras={[cam(0, 1.05, 0.5, 0.48), cam(s(4), 1.55, 0.5, 0.33)]}
        />
      </Shot>
      <Shot from={s(4) - 10} duration={s(4) + 10}>
        <Screen
          width={SCREEN_W}
          src="builder-proposed.png"
          url={`${URL}/create-test`}
          enter={-100}
          cameras={[cam(0, 1.5, 0.5, 0.56), cam(s(4), 1.55, 0.5, 0.7)]}
        />
      </Shot>
      <Shot from={s(8) - 10} duration={s(4) + 10}>
        <Screen
          width={SCREEN_W}
          src="builder-passed.png"
          url={`${URL}/create-test`}
          enter={-100}
          cameras={[cam(0, 1, 0.5, 0.5), cam(s(1.2), 1, 0.5, 0.5), cam(s(4), 1.8, 0.47, 0.13)]}
        />
      </Shot>
    </div>
  </Split>
);

const Api: React.FC = () => (
  <Split
    text={
      <>
        <Eyebrow text="APIs too" />
        <Headline
          text="Assert, capture, chain."
          accent={['chain', 'Collega']}
          size={76}
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
      width={SCREEN_W}
      src="api.png"
      url={`${URL}/api-tester`}
      cameras={[cam(0, 1.5, 0.62, 0.2), cam(s(1.5), 1.5, 0.62, 0.2), cam(s(4.5), 1.5, 0.45, 0.9)]}
    />
  </Split>
);

const Run: React.FC = () => (
  <Split
    text={
      <>
        <Eyebrow text="Run" />
        <Headline
          text="Every browser. In parallel."
          accent={['parallel', 'parallelo']}
          size={76}
          delay={6}
        />
        <Sub
          text="Chromium, Firefox and WebKit. Native mobile with Appium. Dedicated runners for web, mobile and BDD."
          delay={26}
        />
      </>
    }
  >
    <div style={{ position: 'relative', width: SCREEN_W, height: 720 }}>
      <Shot from={0} duration={s(4)}>
        <Screen
          width={SCREEN_W}
          src="run-2.png"
          url={`${URL}/test-plan/nightly/run`}
          cameras={[cam(0, 1, 0.5, 0.5), cam(s(4), 1.35, 0.7, 0.45)]}
        />
      </Shot>
      <Shot from={s(4) - 10} duration={s(4) + 10}>
        <Screen
          width={SCREEN_W}
          src="run-4.png"
          url={`${URL}/test-plan/nightly/run`}
          enter={-100}
          cameras={[cam(0, 1.35, 0.7, 0.45), cam(s(4), 1.4, 0.7, 0.7)]}
        />
      </Shot>
    </div>
  </Split>
);

const Report: React.FC = () => (
  <Split
    text={
      <>
        <Eyebrow text="Understand" />
        <Headline
          text="Know exactly why it failed."
          accent={['why', 'perché']}
          size={76}
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
      width={SCREEN_W}
      src="report-log.png"
      url={`${URL}/reports/catalog-checks`}
      cameras={[
        cam(0, 2.25, 0.5, 0.32),
        cam(s(2.8), 2.25, 0.5, 0.32),
        cam(s(4.2), 2.25, 0.5, 0.53),
        cam(s(7), 2.25, 0.5, 0.7),
      ]}
    />
  </Split>
);

const Dashboard: React.FC = () => (
  <Split
    text={
      <>
        <Eyebrow text="Measure" />
        <Headline text="Quality, at a glance." accent={['glance', 'qualità']} size={76} delay={6} />
        <Sub
          text="Success rate, trends, what runs next and what just failed — for the whole team."
          delay={26}
        />
      </>
    }
  >
    <Screen
      width={SCREEN_W}
      src="dashboard.png"
      url={`${URL}/dashboard`}
      cameras={[
        cam(0, 1.6, 0.35, 0.2),
        cam(s(1.5), 1.6, 0.35, 0.2),
        cam(s(4), 1.6, 0.78, 0.42),
        cam(s(6), 1.05, 0.5, 0.5),
      ]}
    />
  </Split>
);

const CHIPS: Array<
  [React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>, string]
> = [
  [Terminal, 'CI/CD, CLI & REST API'],
  [GitBranch, 'GitHub & GitLab checks'],
  [Ticket, 'Jira & Azure DevOps issues'],
  [BellRing, 'Webhook notifications'],
  [Radar, 'Agents for private networks'],
  [ShieldCheck, 'SSO, MFA & audit log'],
];

const Integrations: React.FC = () => (
  <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 70 }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
      <Eyebrow text="Connect" />
      <Headline
        text="Fits the way your team ships."
        accent={['ships', 'team']}
        size={88}
        align="center"
        delay={6}
      />
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 540px)', gap: 26 }}>
      {CHIPS.map(([icon, label], i) => (
        <Chip key={label} icon={icon} label={label} delay={22 + i * 6} />
      ))}
    </div>
  </AbsoluteFill>
);

const Cta: React.FC<{ cta: string }> = ({ cta }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const button = spring({ frame: frame - 40, fps, config: { damping: 14 } });
  const glow = 0.5 + Math.sin(frame / 8) * 0.25;
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 44 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 34 }}>
        <LogoMark size={130} />
        <div
          style={{
            fontFamily,
            fontSize: 96,
            fontWeight: 800,
            letterSpacing: '-0.045em',
            color: colors.white,
          }}
        >
          WebFlow<span style={{ color: colors.sky }}>Master</span>
        </div>
      </div>
      <Headline
        text="Ship every release with confidence."
        accent={['confidence', 'fiducia']}
        size={70}
        align="center"
        delay={14}
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
          Marco Oliva · marco.oliva@aveva.com · www.aveva.com
        </div>
        <div>+39 3473495072</div>
      </div>
    </AbsoluteFill>
  );
};

export const Promo: React.FC<PromoProps> = ({
  music,
  cta,
  lang = 'en',
  musicFile = 'music.wav',
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <LanguageContext.Provider value={lang}>
      <AbsoluteFill style={{ background: colors.night }}>
        <Backdrop />
        {music && (
          <Audio
            src={staticFile(musicFile)}
            volume={(f) =>
              interpolate(f, [0, 30, durationInFrames - 60, durationInFrames], [0, 0.3, 0.3, 0], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              })
            }
          />
        )}
        <Scene id="hook">
          <Hook />
        </Scene>
        <Scene id="logo">
          <Logo />
        </Scene>
        <Scene id="build">
          <Build />
        </Scene>
        <Scene id="api">
          <Api />
        </Scene>
        <Scene id="run">
          <Run />
        </Scene>
        <Scene id="report">
          <Report />
        </Scene>
        <Scene id="dashboard">
          <Dashboard />
        </Scene>
        <Scene id="integrations">
          <Integrations />
        </Scene>
        <Scene id="cta">
          <Cta cta={cta} />
        </Scene>
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
  );
};
