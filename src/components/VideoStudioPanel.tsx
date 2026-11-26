import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Film,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Square,
  Upload,
  Youtube,
} from 'lucide-react';
import type {
  EpisodePack,
  VoiceActorName,
  YouTubeChannelInfo,
  YouTubeUploadResult,
} from '../types/episode';
import {
  computeSceneTimings,
  decodeBase64WavToAudioBuffer,
  drawVideoFrame,
  renderEpisodeWebmVideo,
  scheduleBackgroundMusic,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  type RenderedVideoResult,
  type VideoRenderProgress,
} from '../utils/videoEngine';
import { renderSceneCartoonImage } from '../utils/cartoonSceneRenderer';
import { CopyButton, DownloadButton } from './CopyDownloadActions';
import { slugifyTitle } from '../utils/exportEpisode';

interface VideoStudioPanelProps {
  episode: EpisodePack;
  voiceActor: VoiceActorName;
  narrationAudioBase64: string | null;
  exportedVideo: RenderedVideoResult | null;
  ytChannel: YouTubeChannelInfo | null;
  isUploadingToYouTube: boolean;
  youtubeUploadPercent: number;
  youtubeUploadPhase: string;
  youtubeUploadError: string | null;
  youtubeUploadResult: YouTubeUploadResult | null;
  isAlreadyUploaded: boolean;
  onVideoExported: (video: RenderedVideoResult | null) => void;
  onDirectUploadToYouTube: (selectedTitle: string) => void;
  onOpenYouTubeUpload: () => void;
  onSynthesizeVoiceover: () => Promise<string | null>;
  onError: (message: string) => void;
}

export function VideoStudioPanel({
  episode,
  voiceActor,
  narrationAudioBase64,
  exportedVideo,
  ytChannel,
  isUploadingToYouTube,
  youtubeUploadPercent,
  youtubeUploadPhase,
  youtubeUploadError,
  youtubeUploadResult,
  isAlreadyUploaded,
  onVideoExported,
  onDirectUploadToYouTube,
  onOpenYouTubeUpload,
  onSynthesizeVoiceover,
  onError,
}: VideoStudioPanelProps) {
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRafRef = useRef<number>(0);
  const previewAudioCtxRef = useRef<AudioContext | null>(null);
  const previewStopMusicRef = useRef<(() => void) | null>(null);
  const previewVoiceSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const [includeVoiceover, setIncludeVoiceover] = useState(true);
  const [includeMusic, setIncludeMusic] = useState(true);
  const [showUrduSubtitles, setShowUrduSubtitles] = useState(true);
  const [showRomanSubtitles, setShowRomanSubtitles] = useState(true);

  const [isPreparingAudio, setIsPreparingAudio] = useState(false);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [previewElapsed, setPreviewElapsed] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(
    episode.shortsScript.totalDurationSeconds || 60
  );

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<VideoRenderProgress | null>(
    null
  );

  const [loadedImages, setLoadedImages] = useState<HTMLImageElement[]>([]);
  const [selectedTitleIdx, setSelectedTitleIdx] = useState(0);

  const fileSlug = slugifyTitle(episode.episodeTitleEnglish);

  const stopPreviewPlayback = () => {
    if (previewRafRef.current) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = 0;
    }
    if (previewStopMusicRef.current) {
      previewStopMusicRef.current();
      previewStopMusicRef.current = null;
    }
    if (previewVoiceSourceRef.current) {
      try {
        previewVoiceSourceRef.current.stop();
      } catch {
        // Ignore
      }
      previewVoiceSourceRef.current = null;
    }
    if (previewAudioCtxRef.current) {
      previewAudioCtxRef.current.close().catch(() => {});
      previewAudioCtxRef.current = null;
    }
    setIsPlayingPreview(false);
  };

  // Load 8 scene images whenever episode changes
  useEffect(() => {
    stopPreviewPlayback();
    setPreviewElapsed(0);
    setExportProgress(null);
    setSelectedTitleIdx(0);

    let cancelled = false;
    const urls = episode.scenes.map(
      (s) => s.imageDataUrl || renderSceneCartoonImage(episode, s)
    );
    Promise.all(
      urls.map(
        (src) =>
          new Promise<HTMLImageElement>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(img);
            img.src = src;
          })
      )
    ).then((imgs) => {
      if (!cancelled) setLoadedImages(imgs);
    });

    return () => {
      cancelled = true;
    };
  }, [episode.id, episode.scenes]);

  // Draw static frame on canvas whenever idle
  useEffect(() => {
    if (isPlayingPreview || loadedImages.length === 0) return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { timings, totalSeconds } = computeSceneTimings(
      episode.scenes,
      previewDuration
    );
    setPreviewDuration(totalSeconds);
    drawVideoFrame(ctx, episode, loadedImages, timings, previewElapsed, {
      showUrduSubtitles,
      showRomanSubtitles,
    });
  }, [
    loadedImages,
    episode,
    isPlayingPreview,
    previewElapsed,
    showUrduSubtitles,
    showRomanSubtitles,
  ]);

  useEffect(() => {
    return () => {
      stopPreviewPlayback();
      exportAbortRef.current?.abort();
    };
  }, []);

  const ensureVoiceoverIfNeeded = async (): Promise<string | null> => {
    if (!includeVoiceover) return null;
    if (narrationAudioBase64) return narrationAudioBase64;
    setIsPreparingAudio(true);
    try {
      return await onSynthesizeVoiceover();
    } finally {
      setIsPreparingAudio(false);
    }
  };

  const handleTogglePreview = async () => {
    if (isPlayingPreview) {
      stopPreviewPlayback();
      return;
    }

    if (loadedImages.length === 0) {
      onError('Scene images are still preparing. Please wait a moment.');
      return;
    }

    let voiceBase64: string | null = narrationAudioBase64;
    if (includeVoiceover && !voiceBase64) {
      try {
        voiceBase64 = await ensureVoiceoverIfNeeded();
      } catch (err) {
        onError(
          err instanceof Error
            ? err.message
            : 'Could not synthesize Urdu voiceover. You can uncheck voiceover to preview music only.'
        );
        return;
      }
    }

    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    previewAudioCtxRef.current = audioCtx;

    let narrationBuffer: AudioBuffer | null = null;
    if (includeVoiceover && voiceBase64) {
      narrationBuffer = await decodeBase64WavToAudioBuffer(audioCtx, voiceBase64);
    }

    const targetDur = narrationBuffer
      ? Math.max(narrationBuffer.duration + 1.0, 12)
      : episode.shortsScript.totalDurationSeconds || 40;

    const { timings, totalSeconds } = computeSceneTimings(
      episode.scenes,
      targetDur
    );
    setPreviewDuration(totalSeconds);

    const startOffset = previewElapsed >= totalSeconds - 0.5 ? 0 : previewElapsed;

    if (narrationBuffer && startOffset < narrationBuffer.duration) {
      const source = audioCtx.createBufferSource();
      source.buffer = narrationBuffer;
      source.connect(audioCtx.destination);
      source.start(audioCtx.currentTime + 0.05, startOffset);
      previewVoiceSourceRef.current = source;
    }

    if (includeMusic) {
      previewStopMusicRef.current = scheduleBackgroundMusic(
        audioCtx,
        audioCtx.destination,
        Math.max(1, totalSeconds - startOffset)
      );
    }

    setIsPlayingPreview(true);
    const wallStart = performance.now() - startOffset * 1000;

    const loop = () => {
      const nowElapsed = (performance.now() - wallStart) / 1000;
      setPreviewElapsed(Math.min(totalSeconds, nowElapsed));
      drawVideoFrame(ctx, episode, loadedImages, timings, nowElapsed, {
        showUrduSubtitles,
        showRomanSubtitles,
      });

      if (nowElapsed >= totalSeconds) {
        stopPreviewPlayback();
        setPreviewElapsed(0);
        return;
      }
      previewRafRef.current = requestAnimationFrame(loop);
    };

    previewRafRef.current = requestAnimationFrame(loop);
  };

  const handleRestartPreview = () => {
    stopPreviewPlayback();
    setPreviewElapsed(0);
  };

  const handleExportWebm = async () => {
    if (isExporting) return;
    stopPreviewPlayback();

    let voiceBase64: string | null = narrationAudioBase64;
    if (includeVoiceover && !voiceBase64) {
      try {
        voiceBase64 = await ensureVoiceoverIfNeeded();
      } catch (err) {
        onError(
          err instanceof Error
            ? err.message
            : 'Could not synthesize Urdu voiceover for export.'
        );
        return;
      }
    }

    if (exportedVideo?.url) {
      URL.revokeObjectURL(exportedVideo.url);
      onVideoExported(null);
    }

    const controller = new AbortController();
    exportAbortRef.current = controller;
    setIsExporting(true);
    setExportProgress({
      percent: 0,
      currentScene: 1,
      totalScenes: episode.scenes.length,
      elapsedSeconds: 0,
      totalSeconds: episode.shortsScript.totalDurationSeconds || 60,
    });

    try {
      const result = await renderEpisodeWebmVideo({
        episode,
        narrationAudioBase64: includeVoiceover ? voiceBase64 : null,
        includeMusic,
        showUrduSubtitles,
        showRomanSubtitles,
        onProgress: (p) => setExportProgress(p),
        abortSignal: controller.signal,
      });
      onVideoExported(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Video export failed.';
      if (!msg.includes('cancelled')) {
        onError(msg);
      }
    } finally {
      setIsExporting(false);
      exportAbortRef.current = null;
    }
  };

  const handleDownloadWebmFile = () => {
    if (!exportedVideo) return;
    const anchor = document.createElement('a');
    anchor.href = exportedVideo.url;
    anchor.download = `${fileSlug}-cartoon-spark.webm`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const seoSummaryText = `TITLE:\n${
    episode.youtubeMetadata.titles[selectedTitleIdx] ||
    episode.youtubeMetadata.titles[0] ||
    episode.episodeTitleEnglish
  }\n\nURDU TITLE:\n${episode.episodeTitleUrdu}\n\nSTORY:\n${
    episode.urduStory
  }\n\nDESCRIPTION:\n${episode.youtubeMetadata.description}\n\nTAGS:\n${(
    episode.youtubeMetadata.tags ||
    episode.youtubeMetadata.keywords ||
    []
  ).join(', ')}\n\nHASHTAGS:\n${episode.youtubeMetadata.hashtags.join(' ')}\n`;

  const formatTime = (sec: number) => {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  return (
    <section className="rounded-xl border border-white/[0.08] bg-[#131622] p-6 space-y-6">
      <div className="flex flex-col gap-3 border-b border-white/[0.08] pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">
            05. 9:16 Video Studio & WebM Export
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Animated slideshow video with all 8 scenes, Ken Burns motion, transitions, Urdu
            narration ({voiceActor}), subtitles, and storybook music
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DownloadButton
            filename={`${fileSlug}-youtube-story-pack.txt`}
            content={seoSummaryText}
            label="Download Story & SEO .txt"
            compact
          />
          <button
            type="button"
            onClick={onOpenYouTubeUpload}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-600/15 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-600/25 min-h-[34px]"
          >
            <Youtube className="h-3.5 w-3.5" />
            <span>YouTube SEO & Upload</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left: Live 9:16 Canvas Preview Player */}
        <div className="lg:col-span-5 flex flex-col items-center space-y-4">
          <div className="w-full max-w-[300px] overflow-hidden rounded-xl border border-white/10 bg-[#0B0D14]">
            <canvas
              ref={previewCanvasRef}
              width={VIDEO_WIDTH}
              height={VIDEO_HEIGHT}
              className="block w-full aspect-[9/16] bg-[#0B0D14]"
            />
          </div>

          <div className="w-full max-w-[300px] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-mono-tabular text-slate-400">
              <span>{formatTime(previewElapsed)}</span>
              <span>{formatTime(previewDuration)}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isPreparingAudio || isExporting}
                onClick={handleTogglePreview}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50 whitespace-nowrap min-h-[40px]"
              >
                {isPreparingAudio ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Preparing Urdu Audio...</span>
                  </>
                ) : isPlayingPreview ? (
                  <>
                    <Pause className="h-4 w-4" />
                    <span>Pause Preview</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    <span>Preview Video</span>
                  </>
                )}
              </button>

              <button
                type="button"
                aria-label="Restart preview"
                disabled={isExporting}
                onClick={handleRestartPreview}
                className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#181C2B] p-2.5 text-slate-300 hover:border-violet-500/40 hover:text-white min-h-[40px] min-w-[40px]"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right: Video Options, Export Progress & Real WebM Player */}
        <div className="lg:col-span-7 space-y-6">
          <div className="rounded-lg border border-white/[0.06] bg-[#0B0D14] p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white">
              Video Track & Subtitle Controls
            </h3>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeVoiceover}
                  disabled={isExporting || isPlayingPreview}
                  onChange={(e) => setIncludeVoiceover(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-[#131622] accent-violet-600"
                />
                <span>Include Urdu AI Narration ({voiceActor})</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeMusic}
                  disabled={isExporting || isPlayingPreview}
                  onChange={(e) => setIncludeMusic(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-[#131622] accent-violet-600"
                />
                <span>Include Storybook Background Music</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showUrduSubtitles}
                  disabled={isExporting}
                  onChange={(e) => setShowUrduSubtitles(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-[#131622] accent-violet-600"
                />
                <span>Burn-in Urdu Subtitles</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showRomanSubtitles}
                  disabled={isExporting}
                  onChange={(e) => setShowRomanSubtitles(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-[#131622] accent-violet-600"
                />
                <span>Burn-in Roman Urdu Captions</span>
              </label>
            </div>

            <div className="border-t border-white/[0.06] pt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={isExporting || isPreparingAudio}
                onClick={handleExportWebm}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50 whitespace-nowrap shrink-0 min-h-[42px]"
              >
                {isExporting || isPreparingAudio ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>
                      {isPreparingAudio
                        ? 'Generating Urdu TTS Audio...'
                        : 'Recording 9:16 WebM Video...'}
                    </span>
                  </>
                ) : (
                  <>
                    <Film className="h-4 w-4" />
                    <span>Render & Export Video (.webm)</span>
                  </>
                )}
              </button>

              {isExporting && (
                <button
                  type="button"
                  onClick={() => exportAbortRef.current?.abort()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-950/30 px-3.5 py-2 text-xs font-medium text-rose-200 hover:bg-rose-900/40 min-h-[42px]"
                >
                  <Square className="h-3.5 w-3.5" />
                  <span>Cancel</span>
                </button>
              )}
            </div>

            {isExporting && exportProgress && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs text-slate-300 font-mono-tabular">
                  <span>
                    Recording Scene {exportProgress.currentScene}/
                    {exportProgress.totalScenes}
                  </span>
                  <span>
                    {exportProgress.percent}% · {formatTime(exportProgress.elapsedSeconds)} /{' '}
                    {formatTime(exportProgress.totalSeconds)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-violet-500 transition-all duration-200"
                    style={{ width: `${exportProgress.percent}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-400">
                  Keep this browser tab open while MediaRecorder encodes frames and audio in real time.
                </p>
              </div>
            )}

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Uses browser Canvas + Web Audio + MediaRecorder for 9:16 WebM creation with zero paid video API charges.
            </p>
          </div>

          {exportedVideo && (
            <div className="rounded-lg border border-violet-500/35 bg-[#0B0D14] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>
                    9:16 WebM Video Ready ({Math.round(exportedVideo.blob.size / 1024)} KB ·{' '}
                    {exportedVideo.durationSeconds}s)
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadWebmFile}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#181C2B] px-3.5 py-2 text-xs font-semibold text-white hover:border-violet-500/40 whitespace-nowrap shrink-0 min-h-[38px]"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download .webm</span>
                  </button>
                  <button
                    type="button"
                    disabled={isUploadingToYouTube || isAlreadyUploaded}
                    onClick={() =>
                      onDirectUploadToYouTube(
                        episode.youtubeMetadata.titles[selectedTitleIdx] ||
                          episode.youtubeMetadata.titles[0] ||
                          episode.episodeTitleEnglish
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0 min-h-[38px]"
                  >
                    {isUploadingToYouTube ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Uploading ({youtubeUploadPercent}%)...</span>
                      </>
                    ) : isAlreadyUploaded ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                        <span>Uploaded to YouTube</span>
                      </>
                    ) : ytChannel ? (
                      <>
                        <Upload className="h-4 w-4" />
                        <span>Upload to YouTube (Private)</span>
                      </>
                    ) : (
                      <>
                        <Youtube className="h-4 w-4" />
                        <span>Connect YouTube to Upload</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {isUploadingToYouTube && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs text-slate-300 font-mono-tabular">
                    <span>{youtubeUploadPhase}</span>
                    <span>{youtubeUploadPercent}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-violet-500 transition-all duration-200"
                      style={{ width: `${youtubeUploadPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {youtubeUploadError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-rose-500/35 bg-rose-950/35 p-3 text-xs text-rose-200"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                  <span>{youtubeUploadError}</span>
                </div>
              )}

              {youtubeUploadResult && (
                <div className="rounded-lg border border-emerald-500/35 bg-emerald-950/25 p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-emerald-300">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>
                        Confirmed on YouTube ({youtubeUploadResult.privacyStatus.toUpperCase()})
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-300">
                      ID: {youtubeUploadResult.videoId}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-[#131622] px-3 py-2">
                    <a
                      href={youtubeUploadResult.youtubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 truncate text-xs font-medium text-violet-300 hover:underline"
                    >
                      <span className="truncate">{youtubeUploadResult.youtubeUrl}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <CopyButton text={youtubeUploadResult.videoId} label="Copy ID" compact />
                      <CopyButton text={youtubeUploadResult.youtubeUrl} label="Copy URL" compact />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                <span>
                  {ytChannel
                    ? `Connected channel: ${ytChannel.title} · Default visibility: Private`
                    : 'Not connected to YouTube yet.'}
                </span>
                <button
                  type="button"
                  onClick={onOpenYouTubeUpload}
                  className="text-violet-400 hover:text-violet-300 font-medium"
                >
                  Edit SEO, Thumbnail & Visibility
                </button>
              </div>

              <video
                controls
                src={exportedVideo.url}
                className="mx-auto max-h-[320px] rounded-lg border border-white/10 bg-black"
              />
            </div>
          )}

          {/* Quick SEO Summary Card */}
          <div className="rounded-lg border border-white/[0.06] bg-[#0B0D14] p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-300">
                Auto-Generated Title & Export Text
              </span>
              <CopyButton
                text={
                  episode.youtubeMetadata.titles[selectedTitleIdx] ||
                  episode.youtubeMetadata.titles[0] ||
                  ''
                }
                label="Copy Title"
                compact
              />
            </div>
            <select
              value={selectedTitleIdx}
              onChange={(e) => setSelectedTitleIdx(Number(e.target.value))}
              className="w-full min-h-[40px] rounded-lg border border-white/10 bg-[#131622] px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
            >
              {episode.youtubeMetadata.titles.map((t, i) => (
                <option key={`${t}-${i}`} value={i}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </section>
  );
}
