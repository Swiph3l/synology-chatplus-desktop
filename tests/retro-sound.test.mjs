import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  generateRetroSound,
  SAMPLE_RATE,
  DURATION_SECONDS,
} from "../scripts/generate-retro-sound.mjs";

test("original Retro cue is reproducible PCM with quiet unclipped levels and smooth endpoints", async () => {
  const wav = await readFile(
    new URL("../public/sounds/retro-prompt.wav", import.meta.url),
  );
  assert.deepEqual(wav, generateRetroSound());
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.toString("ascii", 8, 16), "WAVEfmt ");
  assert.equal(wav.readUInt32LE(16), 16);
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), SAMPLE_RATE);
  assert.equal(wav.readUInt32LE(28), SAMPLE_RATE * 2);
  assert.equal(wav.readUInt16LE(32), 2);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString("ascii", 36, 40), "data");
  const bytes = wav.readUInt32LE(40);
  assert.equal(bytes, wav.length - 44);
  const count = bytes / 2;
  const duration = count / SAMPLE_RATE;
  assert.equal(duration, DURATION_SECONDS);
  assert.ok(duration >= 0.25 && duration <= 0.35);
  let peak = 0;
  let total = 0;
  let mean = 0;
  let largestStep = 0;
  let previous = 0;
  for (let index = 0; index < count; ++index) {
    const sample = wav.readInt16LE(44 + index * 2) / 32_768;
    peak = Math.max(peak, Math.abs(sample));
    largestStep = Math.max(largestStep, Math.abs(sample - previous));
    total += sample * sample;
    mean += sample;
    previous = sample;
  }
  assert.ok(peak >= 0.1 && peak <= 0.2, `peak ${peak}`);
  assert.ok(Math.sqrt(total / count) >= 0.015, "cue must not be silent");
  assert.ok(Math.abs(mean / count) < 0.001, "no substantial DC offset");
  assert.ok(
    largestStep < 0.06,
    "smooth waveform without large discontinuities",
  );
  assert.equal(wav.readInt16LE(44), 0);
  assert.equal(wav.readInt16LE(wav.length - 2), 0);
});
