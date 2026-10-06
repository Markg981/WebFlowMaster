/**
 * An original procedural instrumental for the WebFlowMaster promo.
 * No samples, downloaded tracks, external synthesizer or random source.
 * Run: node marketing/promo-video/audio/synthesize.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rate = 48000;
const seconds = 60;
const samples = rate * seconds;
const left = new Float32Array(samples);
const right = new Float32Array(samples);
const frequency = (midi) => 440 * 2 ** ((midi - 69) / 12);
const tau = 2 * Math.PI;
const smooth = (v) => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * (3 - 2 * x);
};
// Am9, Fmaj9, Cmaj9, G6: four slowly changing, open voicings.
const chords = [
  [45, 52, 57, 60, 64, 71],
  [41, 48, 53, 57, 60, 67],
  [36, 48, 55, 59, 62, 64],
  [43, 50, 55, 59, 62, 64],
];
const beat = 0.625; // 96 BPM; eight beats per five-second harmonic phrase.

for (let i = 0; i < samples; i++) {
  const t = i / rate;
  let l = 0,
    r = 0;
  // Crossfaded pad phrases. Oscillators are time-continuous across each phrase.
  for (let phrase = Math.max(0, Math.floor((t - 1.2) / 5)); phrase <= Math.floor(t / 5); phrase++) {
    const age = t - phrase * 5;
    const env = smooth(age / 1.2) * (1 - smooth((age - 5) / 1.2));
    if (!env) continue;
    const chord = chords[phrase % chords.length];
    chord.forEach((note, n) => {
      const f = frequency(note);
      const gain = (n === 0 ? 0.04 : 0.026) * env;
      const warm = (detune) =>
        Math.sin(tau * f * detune * t + n * 0.37) + 0.15 * Math.sin(tau * 2 * f * detune * t);
      l += gain * warm(0.9988);
      r += gain * warm(1.0012);
    });
  }
  // Soft, alternating original arpeggio: rounded sine pluck with a short attack.
  const step = Math.floor(t / beat);
  const age = t - step * beat;
  const chord = chords[Math.floor(t / 5) % chords.length];
  const sequence = [2, 4, 3, 5, 2, 3, 4, 5];
  const f = frequency(chord[sequence[step % 8]] + 12);
  const pluck =
    0.048 *
    smooth(age / 0.024) *
    Math.exp(-age * 5) *
    (Math.sin(tau * f * age) + 0.12 * Math.sin(tau * f * 2 * age));
  l += pluck * (step % 2 ? 0.55 : 1);
  r += pluck * (step % 2 ? 1 : 0.55);
  // A subdued pulse every other beat; no sampled percussion or sharp transient.
  const pulseAge = t % (beat * 2);
  const pulse =
    0.04 *
    smooth(pulseAge / 0.015) *
    Math.exp(-pulseAge * 15) *
    Math.sin(tau * (48 * pulseAge + (18 * (1 - Math.exp(-pulseAge * 22))) / 22));
  l += pulse;
  r += pulse;
  const fade = smooth(t / 2.5) * (1 - smooth((t - 56) / 4));
  left[i] = l * fade;
  right[i] = r * fade;
}

let peak = 0;
for (let i = 0; i < samples; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
const gain = 0.6 / peak; // Headroom before the video mixes this quietly at 30%.
const wav = Buffer.alloc(44 + samples * 4);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(samples * 4, 40);
let rms = 0;
for (let i = 0; i < samples; i++) {
  const l = left[i] * gain,
    r = right[i] * gain;
  wav.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
  wav.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  rms += (l * l + r * r) / 2;
}
const destination = fileURLToPath(new URL('../video/public/music.wav', import.meta.url));
mkdirSync(fileURLToPath(new URL('../video/public/', import.meta.url)), { recursive: true });
writeFileSync(destination, wav);
console.log(
  JSON.stringify({
    destination,
    seconds,
    rate,
    channels: 2,
    peak: 0.6,
    rms: Math.sqrt(rms / samples),
    bytes: wav.length,
  }),
);
