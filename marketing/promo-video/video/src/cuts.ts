import { createContext, useContext } from 'react';
import story from '../../narration.json';
import { s } from './theme';

/** The cuts of the promo, as narration.json tells them: scenes, lengths and voice. */
export type CutId = keyof typeof story.cuts;
export type SceneId =
  | 'hook'
  | 'logo'
  | 'build'
  | 'beyond'
  | 'api'
  | 'run'
  | 'report'
  | 'dashboard'
  | 'integrations'
  | 'cta';

export const CUT_IDS = Object.keys(story.cuts) as CutId[];
/** Seconds between the start of a scene and the start of its voice line. */
export const VOICE_LEAD = story.lead;

export interface PlacedScene {
  id: SceneId;
  from: number;
  duration: number;
  voice: Record<string, string> | undefined;
}

export const placeScenes = (cut: CutId): PlacedScene[] => {
  let from = 0;
  return story.cuts[cut].scenes.map(({ scene, seconds, voice }) => {
    const placed = { id: scene as SceneId, from, duration: s(seconds), voice };
    from += placed.duration;
    return placed;
  });
};

export const cutFrames = (cut: CutId) =>
  placeScenes(cut).reduce((end, scene) => Math.max(end, scene.from + scene.duration), 0);

export const cutSuffix = (cut: CutId) => story.cuts[cut].suffix;

/** The shapes the promo is made in: 16:9 for sites and YouTube, 1:1 and 9:16 for social feeds. */
export const FORMATS = {
  landscape: { width: 1920, height: 1080, suffix: '' },
  square: { width: 1080, height: 1080, suffix: '-square' },
  vertical: { width: 1080, height: 1920, suffix: '-vertical' },
} as const;
export type FormatId = keyof typeof FORMATS;

export const FormatContext = createContext<FormatId>('landscape');
/** The format being rendered, and whether its layout stacks text above the product. */
export const useFormat = () => {
  const format = useContext(FormatContext);
  return { format, stacked: format !== 'landscape', ...FORMATS[format] };
};
