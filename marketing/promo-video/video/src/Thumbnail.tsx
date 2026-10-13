import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { Backdrop, LogoMark } from './components';
import { italian, type Language } from './copy';
import { colors, fontFamily } from './theme';

/**
 * The still a platform shows before the video plays (YouTube, LinkedIn, the site): the name,
 * the promise and the dashboard, readable at the size of a search result.
 */
export const Thumbnail: React.FC<{ lang?: Language }> = ({ lang = 'en' }) => {
  const line = 'End-to-end testing your whole team can run.';
  return (
    <AbsoluteFill style={{ background: colors.night }}>
      <Backdrop />
      <div
        style={{
          position: 'absolute',
          right: -120,
          top: 150,
          width: 760,
          borderRadius: 16,
          overflow: 'hidden',
          transform: 'perspective(1600px) rotateY(-14deg) rotateX(4deg)',
          boxShadow: `0 30px 90px ${colors.night}, 0 0 60px ${colors.blue}55`,
        }}
      >
        <Img
          src={staticFile(`shots/${lang}/dashboard.png`)}
          style={{ width: 760, display: 'block' }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 70,
          top: 0,
          bottom: 0,
          width: 600,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 34,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <LogoMark size={92} delay={-60} />
          <div
            style={{
              fontFamily,
              fontSize: 64,
              fontWeight: 800,
              letterSpacing: '-0.045em',
              color: colors.white,
            }}
          >
            WebFlow<span style={{ color: colors.sky }}>Master</span>
          </div>
        </div>
        <div
          style={{
            fontFamily,
            fontSize: 58,
            fontWeight: 700,
            lineHeight: 1.08,
            letterSpacing: '-0.035em',
            color: colors.white,
          }}
        >
          {lang === 'it' ? italian[line] : line}
        </div>
      </div>
    </AbsoluteFill>
  );
};
