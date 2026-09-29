import { loadFont } from '@remotion/google-fonts/Inter';

// The product's own typeface and colours (client/src/index.css, client/public/favicon.svg).
export const { fontFamily } = loadFont('normal', { weights: ['400', '500', '600', '700', '800'], subsets: ['latin'] });

export const FPS = 30;

export const colors = {
  night: '#070B1A',
  navy: '#0E1530',
  ink: '#101A33',
  blue: '#3B67FF',
  blueDeep: '#2647C9',
  sky: '#8FB0FF',
  paper: '#F6F8FC',
  muted: '#8A94AD',
  green: '#1AA251',
  red: '#DC2626',
  white: '#FFFFFF',
};

/** Seconds to frames. */
export const s = (seconds: number) => Math.round(seconds * FPS);
