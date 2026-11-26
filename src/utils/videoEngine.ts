import type { EpisodePack, EpisodeScene } from '../types/episode';
import { renderSceneCartoonImage } from './cartoonSceneRenderer';

export const VIDEO_WIDTH = 720;
export const VIDEO_HEIGHT = 1280;
export const VIDEO_FPS = 30;

export interface VideoRenderProgress {
  percent: number;
  currentScene: number;
  totalScenes: number;
  elapsedSeconds: number;
  totalSeconds: number;
}

export interface RenderedVideoResult {
  blob: Blob;
  url: string;
  durationSeconds: number;
  mimeType: string;
}

export interface SceneTiming {
  scene: EpisodeScene;
  startSec: number;
  endSec: number;
  durationSec: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load scene image for video rendering.'));
    img.src = src;
  });
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

export function computeSceneTimings(
  scenes: EpisodeScene[],
  targetTotalSeconds?: number
): { timings: SceneTiming[]; totalSeconds: number } {
  const rawTotal = scenes.reduce((sum, s) => sum + Math.max(2, s.durationSeconds || 7), 0);
  const scale = targetTotalSeconds && targetTotalSeconds > 4 ? targetTotalSeconds / rawTotal : 1;

  let cursor = 0;
  const timings: SceneTiming[] = scenes.map((scene) => {
    const dur = Math.max(2, (scene.durationSeconds || 7) * scale);
    const item: SceneTiming = {
      scene,
      startSec: cursor,
      endSec: cursor + dur,
      durationSec: dur,
    };
    cursor += dur;
    return item;
  });

  return { timings, totalSeconds: cursor };
}

export function drawVideoFrame(
  ctx: CanvasRenderingContext2D,
  episode: EpisodePack,
  images: HTMLImageElement[],
  timings: SceneTiming[],
  elapsedSec: number,
  options: { showUrduSubtitles: boolean; showRomanSubtitles: boolean }
): number {
  ctx.clearRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  ctx.fillStyle = '#0B0D14';
  ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);

  let activeIndex = timings.findIndex(
    (t) => elapsedSec >= t.startSec && elapsedSec < t.endSec
  );
  if (activeIndex === -1) {
    activeIndex = Math.max(0, timings.length - 1);
  }

  const active = timings[activeIndex];
  const sceneElapsed = Math.max(0, elapsedSec - active.startSec);
  const progress = Math.min(1, sceneElapsed / Math.max(0.1, active.durationSec));
  const fadeDuration = 0.45;

  const drawSceneImage = (
    idx: number,
    localProgress: number,
    alpha: number
  ) => {
    const img = images[idx];
    if (!img) return;
    ctx.save();
    ctx.globalAlpha = alpha;

    // Gentle Ken Burns pan & zoom variation per scene
    const dir = idx % 3;
    let scale = 1.0 + 0.08 * localProgress;
    let offsetX = 0;
    let offsetY = 0;

    if (dir === 0) {
      // Slow zoom in
      scale = 1.0 + 0.09 * localProgress;
    } else if (dir === 1) {
      // Pan left to right while slightly zoomed
      scale = 1.08;
      offsetX = (localProgress - 0.5) * -36;
    } else {
      // Gentle zoom out + upward tilt
      scale = 1.09 - 0.07 * localProgress;
      offsetY = (localProgress - 0.5) * 24;
    }

    const drawW = VIDEO_WIDTH * scale;
    const drawH = VIDEO_HEIGHT * scale;
    const x = (VIDEO_WIDTH - drawW) / 2 + offsetX;
    const y = (VIDEO_HEIGHT - drawH) / 2 + offsetY;
    ctx.drawImage(img, x, y, drawW, drawH);
    ctx.restore();
  };

  // Draw current scene
  drawSceneImage(activeIndex, progress, 1);

  // Smooth crossfade from previous scene during first 0.45s
  if (activeIndex > 0 && sceneElapsed < fadeDuration) {
    const prevAlpha = 1 - sceneElapsed / fadeDuration;
    drawSceneImage(activeIndex - 1, 1, Math.max(0, prevAlpha));
  }

  // Top & Bottom Cinema Scrims for crisp readability
  const topScrim = ctx.createLinearGradient(0, 0, 0, 210);
  topScrim.addColorStop(0, 'rgba(11, 13, 20, 0.78)');
  topScrim.addColorStop(1, 'rgba(11, 13, 20, 0)');
  ctx.fillStyle = topScrim;
  ctx.fillRect(0, 0, VIDEO_WIDTH, 210);

  const bottomScrim = ctx.createLinearGradient(0, VIDEO_HEIGHT - 380, 0, VIDEO_HEIGHT);
  bottomScrim.addColorStop(0, 'rgba(11, 13, 20, 0)');
  bottomScrim.addColorStop(0.35, 'rgba(11, 13, 20, 0.72)');
  bottomScrim.addColorStop(1, 'rgba(11, 13, 20, 0.92)');
  ctx.fillStyle = bottomScrim;
  ctx.fillRect(0, VIDEO_HEIGHT - 380, VIDEO_WIDTH, 380);

  // Top Channel Badge & Scene Progress Bar
  ctx.save();
  ctx.fillStyle = 'rgba(139, 92, 246, 0.9)';
  ctx.beginPath();
  ctx.roundRect(36, 40, 178, 36, 8);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '600 18px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Cartoon Spark', 125, 58);

  // Scene counter right
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = '500 17px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(
    `Scene ${activeIndex + 1}/${timings.length}`,
    VIDEO_WIDTH - 36,
    58
  );

  // Opening title card overlay during Scene 1
  if (activeIndex === 0) {
    const titleAlpha = sceneElapsed < 0.4 ? sceneElapsed / 0.4 : 1;
    ctx.globalAlpha = titleAlpha;
    ctx.fillStyle = 'rgba(19, 22, 34, 0.86)';
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(48, 108, VIDEO_WIDTH - 96, 114, 14);
    ctx.fill();
    ctx.stroke();

    ctx.direction = 'rtl';
    ctx.fillStyle = '#FDE047';
    ctx.font = '700 32px "Noto Sans Arabic", "Noto Nastaliq Urdu", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(episode.episodeTitleUrdu, VIDEO_WIDTH / 2, 152, VIDEO_WIDTH - 130);

    ctx.direction = 'ltr';
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '600 18px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(episode.episodeTitleEnglish, VIDEO_WIDTH / 2, 194, VIDEO_WIDTH - 130);
    ctx.globalAlpha = 1;
  }

  // Dynamic Subtitles at bottom safe area
  const scene = active.scene;
  let subY = VIDEO_HEIGHT - 125;

  if (options.showRomanSubtitles && scene.romanUrduCaption) {
    ctx.direction = 'ltr';
    ctx.font = '500 22px "DM Sans", sans-serif';
    const romanLines = wrapTextLines(ctx, scene.romanUrduCaption, VIDEO_WIDTH - 96).slice(0, 2);
    ctx.textAlign = 'center';
    for (let i = romanLines.length - 1; i >= 0; i--) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillText(romanLines[i], VIDEO_WIDTH / 2 + 1, subY + 2);
      ctx.fillStyle = '#C4B5FD';
      ctx.fillText(romanLines[i], VIDEO_WIDTH / 2, subY);
      subY -= 30;
    }
    subY -= 12;
  }

  if (options.showUrduSubtitles && scene.urduNarration) {
    ctx.direction = 'rtl';
    ctx.font = '700 30px "Noto Sans Arabic", "Noto Nastaliq Urdu", sans-serif';
    const urduLines = wrapTextLines(ctx, scene.urduNarration, VIDEO_WIDTH - 96).slice(0, 3);
    ctx.textAlign = 'center';
    for (let i = urduLines.length - 1; i >= 0; i--) {
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillText(urduLines[i], VIDEO_WIDTH / 2 + 2, subY + 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(urduLines[i], VIDEO_WIDTH / 2, subY);
      subY -= 46;
    }
  }

  // Thin bottom progress bar
  const totalSec = timings[timings.length - 1]?.endSec || 60;
  const overallProgress = Math.min(1, elapsedSec / Math.max(0.1, totalSec));
  ctx.direction = 'ltr';
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(36, VIDEO_HEIGHT - 44, VIDEO_WIDTH - 72, 6);
  ctx.fillStyle = '#8B5CF6';
  ctx.fillRect(36, VIDEO_HEIGHT - 44, (VIDEO_WIDTH - 72) * overallProgress, 6);

  ctx.restore();
  return activeIndex;
}

export function scheduleBackgroundMusic(
  audioCtx: AudioContext,
  destination: AudioNode,
  durationSec: number
): () => void {
  // Soft warm storybook pentatonic arpeggio loop (C major / A minor warm chords)
  const notes = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 392.0];
  const stepSec = 0.55;
  const masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.085;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1200;

  masterGain.connect(filter);
  filter.connect(destination);

  const startTime = audioCtx.currentTime + 0.05;
  const totalSteps = Math.ceil(durationSec / stepSec);
  const oscs: OscillatorNode[] = [];

  for (let i = 0; i < totalSteps; i++) {
    const t = startTime + i * stepSec;
    const freq = notes[i % notes.length];

    const osc = audioCtx.createOscillator();
    const noteGain = audioCtx.createGain();
    osc.type = i % 4 === 0 ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq, t);

    noteGain.gain.setValueAtTime(0.0001, t);
    noteGain.gain.exponentialRampToValueAtTime(0.55, t + 0.04);
    noteGain.gain.exponentialRampToValueAtTime(0.001, t + stepSec * 0.92);

    osc.connect(noteGain);
    noteGain.connect(masterGain);
    osc.start(t);
    osc.stop(t + stepSec);
    oscs.push(osc);
  }

  return () => {
    for (const osc of oscs) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // Ignore already stopped oscillators
      }
    }
    try {
      masterGain.disconnect();
      filter.disconnect();
    } catch {
      // Ignore
    }
  };
}

function getSupportedWebmMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

export async function decodeBase64WavToAudioBuffer(
  audioCtx: AudioContext,
  base64Wav: string
): Promise<AudioBuffer> {
  const binary = atob(base64Wav);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return await audioCtx.decodeAudioData(bytes.buffer.slice(0));
}

export async function renderEpisodeWebmVideo(params: {
  episode: EpisodePack;
  narrationAudioBase64?: string | null;
  includeMusic: boolean;
  showUrduSubtitles: boolean;
  showRomanSubtitles: boolean;
  onProgress: (p: VideoRenderProgress) => void;
  abortSignal?: AbortSignal;
}): Promise<RenderedVideoResult> {
  const {
    episode,
    narrationAudioBase64,
    includeMusic,
    showUrduSubtitles,
    showRomanSubtitles,
    onProgress,
    abortSignal,
  } = params;

  if (typeof MediaRecorder === 'undefined') {
    throw new Error(
      'Your browser does not support MediaRecorder WebM video export. Please try Chrome, Edge, or Firefox.'
    );
  }

  const mimeType = getSupportedWebmMimeType();
  if (!mimeType) {
    throw new Error(
      'WebM video recording is not supported in this browser.'
    );
  }

  // Load all 8 scene images (render locally if missing)
  const imageUrls = episode.scenes.map(
    (s) => s.imageDataUrl || renderSceneCartoonImage(episode, s)
  );
  const images = await Promise.all(imageUrls.map((url) => loadImage(url)));

  const canvas = document.createElement('canvas');
  canvas.width = VIDEO_WIDTH;
  canvas.height = VIDEO_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas for video export.');
  }

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  const audioDest = audioCtx.createMediaStreamDestination();
  let narrationBuffer: AudioBuffer | null = null;
  if (narrationAudioBase64) {
    narrationBuffer = await decodeBase64WavToAudioBuffer(audioCtx, narrationAudioBase64);
  }

  // Match video duration cleanly to narration length (or default Shorts script total)
  const targetDuration = narrationBuffer
    ? Math.max(narrationBuffer.duration + 1.0, 12)
    : episode.shortsScript.totalDurationSeconds || 40;

  const { timings, totalSeconds } = computeSceneTimings(
    episode.scenes,
    targetDuration
  );

  // Schedule Urdu TTS narration into MediaStream
  let narrationSource: AudioBufferSourceNode | null = null;
  if (narrationBuffer) {
    narrationSource = audioCtx.createBufferSource();
    narrationSource.buffer = narrationBuffer;
    const voiceGain = audioCtx.createGain();
    voiceGain.gain.value = 1.0;
    narrationSource.connect(voiceGain);
    voiceGain.connect(audioDest);
    narrationSource.start(audioCtx.currentTime + 0.15);
  }

  // Schedule gentle storybook background music if enabled
  let stopMusic = () => {};
  if (includeMusic) {
    stopMusic = scheduleBackgroundMusic(audioCtx, audioDest, totalSeconds);
  }

  const canvasStream = canvas.captureStream(VIDEO_FPS);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioDest.stream.getAudioTracks(),
  ]);

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 2_800_000,
  });

  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
    }
  };

  return await new Promise<RenderedVideoResult>((resolve, reject) => {
    let rafId = 0;
    let settled = false;

    const cleanup = () => {
      if (rafId) cancelAnimationFrame(rafId);
      stopMusic();
      if (narrationSource) {
        try {
          narrationSource.stop();
        } catch {
          // Ignore
        }
      }
      combinedStream.getTracks().forEach((t) => t.stop());
      audioCtx.close().catch(() => {});
    };

    if (abortSignal) {
      abortSignal.addEventListener(
        'abort',
        () => {
          if (settled) return;
          settled = true;
          try {
            if (recorder.state !== 'inactive') recorder.stop();
          } catch {
            // Ignore
          }
          cleanup();
          reject(new Error('Video export was cancelled.'));
        },
        { once: true }
      );
    }

    recorder.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('MediaRecorder failed while encoding the WebM video.'));
    };

    recorder.onstop = async () => {
      if (settled) return;
      settled = true;
      cleanup();
      const blob = new Blob(chunks, { type: 'video/webm' });
      if (blob.size < 16) {
        reject(new Error('Exported video file was empty or incomplete. Please try again.'));
        return;
      }
      try {
        const headerBytes = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
        const isEbml =
          headerBytes[0] === 0x1a &&
          headerBytes[1] === 0x45 &&
          headerBytes[2] === 0xdf &&
          headerBytes[3] === 0xa3;
        if (!isEbml) {
          reject(new Error('Exported video is not a valid WebM binary stream.'));
          return;
        }
      } catch {
        // Fallback if slice/arrayBuffer fails in restricted environments
      }
      const url = URL.createObjectURL(blob);
      resolve({
        blob,
        url,
        durationSeconds: Math.round(totalSeconds),
        mimeType: 'video/webm',
      });
    };

    const startTime = performance.now();
    recorder.start(250);

    const tick = () => {
      if (settled) return;
      const elapsedSec = (performance.now() - startTime) / 1000;
      const sceneIdx = drawVideoFrame(
        ctx,
        episode,
        images,
        timings,
        elapsedSec,
        { showUrduSubtitles, showRomanSubtitles }
      );

      onProgress({
        percent: Math.min(99, Math.round((elapsedSec / totalSeconds) * 100)),
        currentScene: sceneIdx + 1,
        totalScenes: timings.length,
        elapsedSeconds: Math.min(totalSeconds, elapsedSec),
        totalSeconds,
      });

      if (elapsedSec >= totalSeconds) {
        onProgress({
          percent: 100,
          currentScene: timings.length,
          totalScenes: timings.length,
          elapsedSeconds: totalSeconds,
          totalSeconds,
        });
        recorder.stop();
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
  });
}
