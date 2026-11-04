import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SAMPLE_RATE = 24_000;
export const DURATION_SECONDS = 0.32;
const PEAK = 0.18;

// Original synthesis for ChatPlus Desktop, distributed under GPL-3.0-only.
// Three short, overlapping sine bells evoke a small 1990s interface cue.
// Frequencies/envelopes are authored here; no recordings or system sounds are
// sampled. A quiet peak and smooth edges keep the explicit UI action gentle.
export function generateRetroSound() {
  const count = Math.round(SAMPLE_RATE * DURATION_SECONDS);
  const samples = new Float64Array(count);
  const voices = [
    { start: 0, frequency: 587.329536, gain: 1 },
    { start: 0.055, frequency: 880, gain: 0.65 },
    { start: 0.11, frequency: 739.988845, gain: 0.45 },
  ];
  const smooth = (value) => value * value * (3 - 2 * value);
  let maximum = 0;
  for (let index = 0; index < count; ++index) {
    const time = index / SAMPLE_RATE;
    let sample = 0;
    for (const { start, frequency, gain } of voices) {
      const elapsed = time - start;
      if (elapsed < 0) continue;
      const attack = smooth(Math.min(1, elapsed / 0.006));
      const decay = Math.exp(-elapsed / 0.085);
      const phase = 2 * Math.PI * frequency * elapsed;
      sample +=
        gain *
        attack *
        decay *
        (Math.sin(phase) + 0.12 * Math.sin(phase * 2.003));
    }
    const remaining = (count - 1 - index) / SAMPLE_RATE;
    sample *= smooth(Math.min(1, remaining / 0.035));
    samples[index] = sample;
    maximum = Math.max(maximum, Math.abs(sample));
  }
  const wav = Buffer.alloc(44 + count * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(count * 2, 40);
  for (let index = 0; index < count; ++index)
    wav.writeInt16LE(
      Math.round(samples[index] * (PEAK / maximum) * 32_767),
      44 + index * 2,
    );
  return wav;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const destination = new URL(
    "../public/sounds/retro-prompt.wav",
    import.meta.url,
  );
  await mkdir(new URL(".", destination), { recursive: true });
  const wav = generateRetroSound();
  await writeFile(destination, wav);
  console.log(`Generated ${wav.length} bytes: ${fileURLToPath(destination)}`);
}
