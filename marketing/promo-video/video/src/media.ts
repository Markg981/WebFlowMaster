import { useEffect, useState } from 'react';
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';
import type { Language } from './copy';

/**
 * Files written by the scripts, read when the video renders rather than bundled: they are not
 * committed, and a cut that does not use one must still render without it.
 */
function useJson<T>(file: string | null): T | null {
  const [data, setData] = useState<T | null>(null);
  const [handle] = useState(() => (file ? delayRender(`Loading ${file}`) : null));
  useEffect(() => {
    if (!file || handle === null) return;
    fetch(staticFile(file))
      .then((res) => {
        if (!res.ok)
          throw new Error(`${file}: ${res.status}. Run the capture or the voice-over first.`);
        return res.json();
      })
      .then((json) => {
        setData(json);
        continueRender(handle);
      })
      .catch((error) => cancelRender(error));
  }, [file, handle]);
  return data;
}

export interface Clip {
  src: string;
  seconds: number;
  /** When things happen in the clip, in seconds from its start (demo/capture.mjs). */
  marks: Record<string, number>;
}

/** A live clip of the product, filmed in the edition's language. */
export const useClip = (lang: Language, name: string): Clip | null => {
  const meta = useJson<Omit<Clip, 'src'>>(`clips/${lang}/${name}.json`);
  return meta && { ...meta, src: staticFile(`clips/${lang}/${name}.mp4`) };
};

export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** How long each voice line lasts, and the captions timed on it (audio/narrate.mjs). */
export const useVoiceover = (enabled: boolean) => {
  const timing = useJson<Record<string, Record<string, Record<string, number>>>>(
    enabled ? 'voice/timing.json' : null,
  );
  const captions = useJson<Record<string, Record<string, Cue[]>>>(
    enabled ? 'voice/captions.json' : null,
  );
  return { timing, captions };
};
