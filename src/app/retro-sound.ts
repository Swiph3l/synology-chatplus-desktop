let playing: HTMLAudioElement | undefined;

export function stopRetroSoundPreview() {
  playing?.pause();
  playing = undefined;
}

export async function playRetroSoundPreview() {
  stopRetroSoundPreview();
  const audio = new Audio("/sounds/retro-prompt.wav");
  playing = audio;
  audio.volume = 0.6;
  audio.addEventListener(
    "ended",
    () => {
      if (playing === audio) playing = undefined;
    },
    { once: true },
  );
  try {
    await audio.play();
  } catch (error) {
    if (playing !== audio) return;
    stopRetroSoundPreview();
    throw error;
  }
}
