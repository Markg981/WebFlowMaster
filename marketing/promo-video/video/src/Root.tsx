import { Composition } from 'remotion';
import { Promo, PROMO_FRAMES, type PromoProps } from './Promo';
import { FPS } from './theme';

export const Root: React.FC = () => (
  <Composition
    id="Promo"
    component={Promo}
    durationInFrames={PROMO_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
    defaultProps={{ music: false, cta: 'Request a demo' } satisfies PromoProps}
  />
);
