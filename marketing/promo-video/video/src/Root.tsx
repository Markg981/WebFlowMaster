import { Composition, Still } from 'remotion';
import { Promo, type PromoProps } from './Promo';
import { Thumbnail } from './Thumbnail';
import { CUT_IDS, cutFrames, FORMATS, type FormatId } from './cuts';
import type { Language } from './copy';
import { FPS } from './theme';

const LANGUAGES: Language[] = ['en', 'it'];
const CTA: Record<Language, string> = { en: 'Request a demo', it: 'Richiedi una demo' };

/**
 * One composition per edition: Promo-<lang>-<cut>-<format>, e.g. Promo-it-short-vertical.
 * render.mjs renders the release set; the studio shows them all.
 */
export const Root: React.FC = () => (
  <>
    {LANGUAGES.flatMap((lang) =>
      CUT_IDS.flatMap((cut) =>
        (Object.keys(FORMATS) as FormatId[]).map((format) => (
          <Composition
            key={`${lang}-${cut}-${format}`}
            id={`Promo-${lang}-${cut}-${format}`}
            component={Promo}
            durationInFrames={cutFrames(cut)}
            fps={FPS}
            width={FORMATS[format].width}
            height={FORMATS[format].height}
            defaultProps={
              {
                music: false,
                voice: false,
                lang,
                cut,
                format,
                cta: CTA[lang],
              } satisfies PromoProps
            }
          />
        )),
      ),
    )}
    {LANGUAGES.map((lang) => (
      <Still
        key={lang}
        id={`Thumbnail-${lang}`}
        component={Thumbnail}
        width={1280}
        height={720}
        defaultProps={{ lang }}
      />
    ))}
  </>
);
