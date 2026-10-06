import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { colors, fontFamily } from './theme';
import { useCopy } from './copy';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.22, 1, 0.36, 1);

/** A deep navy field with a slow drifting glow and a faint grid: the stage every scene sits on. */
export const Backdrop: React.FC<{ tint?: string }> = ({ tint = colors.blue }) => {
  const frame = useCurrentFrame();
  const x = 50 + Math.sin(frame / 90) * 18;
  const y = 40 + Math.cos(frame / 110) * 14;
  return (
    <AbsoluteFill style={{ background: colors.night, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(60% 55% at ${x}% ${y}%, ${tint}55 0%, ${colors.navy}00 70%), radial-gradient(45% 40% at ${100 - x}% ${100 - y}%, #7C4DFF33 0%, transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${colors.white}0A 1px, transparent 1px), linear-gradient(90deg, ${colors.white}0A 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(70% 70% at 50% 50%, black 30%, transparent 100%)',
          transform: `translateY(${-(frame % 64) * 0.25}px)`,
        }}
      />
    </AbsoluteFill>
  );
};

/** The product mark (client/public/favicon.svg), drawn in: the needle swings up to the dial. */
export const LogoMark: React.FC<{ size: number; delay?: number }> = ({ size, delay = 0 }) => {
  const frame = useCurrentFrame() - delay;
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 14, mass: 0.8 } });
  const arc = interpolate(frame, [4, 26], [1, 0], { ...clamp, easing: ease });
  const needle = interpolate(frame, [10, 34], [-70, 0], {
    ...clamp,
    easing: Easing.out(Easing.back(2)),
  });
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      style={{
        transform: `scale(${pop})`,
        filter: `drop-shadow(0 ${size / 12}px ${size / 5}px ${colors.blue}88)`,
      }}
    >
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={colors.blue} />
          <stop offset="1" stopColor={colors.blueDeep} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#lg)" />
      <path
        d="M7 21a9 9 0 0 1 18 0"
        fill="none"
        stroke="#fff"
        strokeOpacity={0.5}
        strokeWidth={2.1}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={arc}
      />
      <g transform={`rotate(${needle} 16 21)`}>
        <path
          d="M16 21 21.5 12.8"
          fill="none"
          stroke="#fff"
          strokeWidth={2.6}
          strokeLinecap="round"
        />
      </g>
      <circle cx="16" cy="21" r="2.4" fill="#fff" />
    </svg>
  );
};

/** A headline that arrives word by word, rising and unblurring. `accent` words are in blue. */
export const Headline: React.FC<{
  text: string;
  accent?: string[];
  size?: number;
  delay?: number;
  align?: 'left' | 'center';
  color?: string;
  weight?: number;
}> = ({
  text,
  accent = [],
  size = 84,
  delay = 0,
  align = 'left',
  color = colors.white,
  weight = 700,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const copy = useCopy();
  const words = copy(text).split(' ');
  return (
    <div
      style={{
        fontFamily,
        fontSize: size,
        fontWeight: weight,
        lineHeight: 1.08,
        letterSpacing: '-0.035em',
        color,
        textAlign: align,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: align === 'center' ? 'center' : 'flex-start',
        gap: `0 ${size * 0.26}px`,
      }}
    >
      {words.map((word, i) => {
        const p = spring({ frame: frame - delay - i * 3, fps, config: { damping: 18, mass: 0.7 } });
        const clean = word.replace(/[.,!?]/g, '');
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              opacity: p,
              transform: `translateY(${(1 - p) * size * 0.5}px)`,
              filter: `blur(${(1 - p) * 10}px)`,
              color: accent.includes(clean) ? colors.sky : undefined,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};

/** A small line above a headline: what the scene is about. */
export const Eyebrow: React.FC<{ text: string; delay?: number }> = ({ text, delay = 0 }) => {
  const copy = useCopy();
  const frame = useCurrentFrame();
  const o = interpolate(frame - delay, [0, 14], [0, 1], clamp);
  const w = interpolate(frame - delay, [0, 20], [0, 56], { ...clamp, easing: ease });
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        opacity: o,
        fontFamily,
        fontSize: 24,
        fontWeight: 600,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: colors.sky,
      }}
    >
      <div style={{ width: w, height: 3, borderRadius: 2, background: colors.blue }} />
      {copy(text)}
    </div>
  );
};

export interface Camera {
  /** Frame (relative to the Screen) at which this position is reached. */
  at: number;
  /** Zoom factor on the screenshot. */
  zoom: number;
  /** Point of the screenshot kept at the centre, as fractions of its width and height. */
  x: number;
  y: number;
}

/**
 * A real screen of the product in a browser window, filmed by a camera that eases between
 * positions — the moves that make a screenshot read as a product being used.
 */
export const Screen: React.FC<{
  src: string;
  url: string;
  cameras: Camera[];
  width?: number;
  enter?: number;
  tilt?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ src, url, cameras, width = 1500, enter = 0, tilt = true, style, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const height = (width * 9) / 16;
  const inP = spring({ frame: frame - enter, fps, config: { damping: 20, mass: 0.9 } });

  const at = (key: 'zoom' | 'x' | 'y') =>
    cameras.length === 1
      ? cameras[0][key]
      : interpolate(
          frame,
          cameras.map((c) => c.at),
          cameras.map((c) => c[key]),
          { ...clamp, easing: Easing.inOut(Easing.cubic) },
        );
  const zoom = at('zoom');
  const cx = at('x');
  const cy = at('y');
  const tx = (0.5 - cx) * width * zoom;
  const ty = (0.5 - cy) * height * zoom;
  const rotateX = tilt ? interpolate(inP, [0, 1], [18, 4]) : 0;

  return (
    <div
      style={{
        width,
        borderRadius: 18,
        overflow: 'hidden',
        background: colors.white,
        boxShadow: `0 40px 120px ${colors.night}CC, 0 0 0 1px ${colors.white}22, 0 0 80px ${colors.blue}33`,
        transform: `perspective(2200px) rotateX(${rotateX}deg) translateY(${(1 - inP) * 160}px) scale(${0.92 + inP * 0.08})`,
        opacity: inP,
        ...style,
      }}
    >
      <div
        style={{
          height: 44,
          background: '#EEF1F7',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 18px',
          borderBottom: '1px solid #DDE3EE',
        }}
      >
        {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
          <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />
        ))}
        <div
          style={{
            marginLeft: 18,
            flex: 1,
            maxWidth: 620,
            height: 28,
            borderRadius: 8,
            background: colors.white,
            border: '1px solid #DDE3EE',
            display: 'flex',
            alignItems: 'center',
            padding: '0 14px',
            fontFamily,
            fontSize: 15,
            color: '#55607A',
          }}
        >
          <span style={{ color: colors.green, marginRight: 8 }}>●</span>
          {url}
        </div>
      </div>
      <div style={{ position: 'relative', width, height, overflow: 'hidden' }}>
        <Img
          src={staticFile(`shots/${src}`)}
          style={{
            position: 'absolute',
            width,
            height,
            transform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
            transformOrigin: '50% 50%',
          }}
        />
        {children}
      </div>
    </div>
  );
};

/** A pill naming one capability, popping in after `delay`. */
export const Chip: React.FC<{
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  delay: number;
}> = ({ label, icon: Icon, delay }) => {
  const copy = useCopy();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 15, mass: 0.7 } });
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '22px 30px',
        borderRadius: 20,
        background: `linear-gradient(135deg, ${colors.white}14, ${colors.white}06)`,
        border: `1px solid ${colors.white}24`,
        boxShadow: `0 20px 60px ${colors.night}AA`,
        fontFamily,
        fontSize: 27,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        color: colors.white,
        opacity: p,
        transform: `translateY(${(1 - p) * 40}px) scale(${0.9 + p * 0.1})`,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `${colors.blue}33`,
          border: `1px solid ${colors.blue}66`,
        }}
      >
        <Icon size={30} color={colors.sky} strokeWidth={2} />
      </div>
      {copy(label)}
    </div>
  );
};

/** Fades a whole scene in and out over its first and last frames. */
export const SceneFade: React.FC<{
  duration: number;
  children: React.ReactNode;
  fade?: number;
}> = ({ duration, children, fade = 12 }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, fade, duration - fade, duration], [0, 1, 1, 0], clamp);
  const scale = interpolate(frame, [duration - fade, duration], [1, 1.03], clamp);
  return (
    <AbsoluteFill style={{ opacity: o, transform: `scale(${scale})` }}>{children}</AbsoluteFill>
  );
};
