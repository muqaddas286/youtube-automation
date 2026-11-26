import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Film,
  Loader2,
  RefreshCw,
  Upload,
  Volume2,
} from 'lucide-react';
import type {
  EpisodePack,
  RegenerateSectionType,
  VoiceActorName,
  YouTubeChannelInfo,
  YouTubePrivacyStatus,
  YouTubeUploadResult,
} from '../types/episode';
import { CopyButton, DownloadButton } from './CopyDownloadActions';
import { VideoStudioPanel } from './VideoStudioPanel';
import { YouTubeUploadPanel } from './YouTubeUploadPanel';
import type { RenderedVideoResult } from '../utils/videoEngine';
import {
  downloadBase64Wav,
  formatAllPromptsText,
  formatEpisodeAsText,
  slugifyTitle,
} from '../utils/exportEpisode';
import { renderSceneCartoonImage } from '../utils/cartoonSceneRenderer';

export type WorkspaceTab =
  | 'story-script'
  | 'scenes-prompts'
  | 'voiceover'
  | 'video-studio'
  | 'youtube-thumbnails'
  | 'editing-plan'
  | 'full-pack';

interface EpisodeWorkspaceProps {
  episode: EpisodePack;
  activeTab: WorkspaceTab;
  ytSessionId: string | null;
  ytChannel: YouTubeChannelInfo | null;
  onYouTubeAuthChange: (
    sessionId: string | null,
    channel: YouTubeChannelInfo | null
  ) => void;
  onTabChange: (tab: WorkspaceTab) => void;
  onUpdateEpisode: (updated: EpisodePack) => void;
  onError: (msg: string) => void;
}

const VOICE_OPTIONS: Array<{ id: VoiceActorName; label: string; tone: string }> = [
  { id: 'Kore', label: 'Kore', tone: 'Warm & Gentle Storyteller' },
  { id: 'Puck', label: 'Puck', tone: 'Playful & Energetic Cartoon' },
  { id: 'Charon', label: 'Charon', tone: 'Deep & Wise Folk Narrator' },
  { id: 'Zephyr', label: 'Zephyr', tone: 'Bright & Friendly Youthful' },
  { id: 'Fenrir', label: 'Fenrir', tone: 'Dramatic & Expressive' },
];

export function EpisodeWorkspace({
  episode,
  activeTab,
  ytSessionId,
  ytChannel,
  onYouTubeAuthChange,
  onTabChange,
  onUpdateEpisode,
  onError,
}: EpisodeWorkspaceProps) {
  const [regenerating, setRegenerating] = useState<RegenerateSectionType | null>(null);
  const [voiceActor, setVoiceActor] = useState<VoiceActorName>('Kore');
  const [voiceStyleInput, setVoiceStyleInput] = useState(
    episode.voiceoverPlan.recommendedVoiceStyle
  );
  const [editableNarration, setEditableNarration] = useState(
    episode.voiceoverPlan.cleanUrduNarration
  );
  const [isSynthesizingAudio, setIsSynthesizingAudio] = useState(false);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [audioEpisodeId, setAudioEpisodeId] = useState<string>(episode.id);
  const [exportedVideo, setExportedVideo] = useState<RenderedVideoResult | null>(
    null
  );
  const exportedVideoRef = useRef<RenderedVideoResult | null>(null);
  exportedVideoRef.current = exportedVideo;

  const [isUploadingToYouTube, setIsUploadingToYouTube] = useState(false);
  const [youtubeUploadPercent, setYoutubeUploadPercent] = useState(0);
  const [youtubeUploadPhase, setYoutubeUploadPhase] = useState('');
  const [youtubeUploadError, setYoutubeUploadError] = useState<string | null>(
    null
  );
  const [youtubeUploadResult, setYoutubeUploadResult] =
    useState<YouTubeUploadResult | null>(null);
  const [uploadedVideoKey, setUploadedVideoKey] = useState<string | null>(null);
  const inFlightUploadRef = useRef(false);

  // Reset TTS state cleanly when switching episodes
  useEffect(() => {
    setVoiceStyleInput(episode.voiceoverPlan.recommendedVoiceStyle);
    setEditableNarration(episode.voiceoverPlan.cleanUrduNarration);
    if (audioEpisodeId !== episode.id) {
      setAudioBase64(null);
      setAudioEpisodeId(episode.id);
    }
  }, [episode, audioEpisodeId]);

  // Clear and revoke exported video blob URL & upload status when switching episodes
  useEffect(() => {
    if (exportedVideoRef.current?.url) {
      URL.revokeObjectURL(exportedVideoRef.current.url);
    }
    setExportedVideo(null);
    setYoutubeUploadError(null);
    setYoutubeUploadResult(null);
    setUploadedVideoKey(null);
    setYoutubeUploadPercent(0);
    setYoutubeUploadPhase('');
  }, [episode.id]);

  useEffect(() => {
    return () => {
      if (exportedVideoRef.current?.url) {
        URL.revokeObjectURL(exportedVideoRef.current.url);
      }
    };
  }, []);

  const currentExportKey = useMemo(() => {
    if (!exportedVideo) return null;
    return `${episode.id}::${exportedVideo.url}::${exportedVideo.blob.size}`;
  }, [episode.id, exportedVideo]);

  const isAlreadyUploaded = Boolean(
    youtubeUploadResult &&
      currentExportKey &&
      uploadedVideoKey === currentExportKey
  );

  const handleVideoExported = (video: RenderedVideoResult | null) => {
    setExportedVideo(video);
    if (video) {
      setYoutubeUploadError(null);
      setYoutubeUploadResult(null);
      setUploadedVideoKey(null);
      setYoutubeUploadPercent(0);
      setYoutubeUploadPhase('');
    }
  };

  const handleUploadToYouTube = async (params: {
    title: string;
    description: string;
    tags: string[];
    madeForKids: boolean;
    privacyStatus: YouTubePrivacyStatus;
    thumbnailFile?: File | Blob | null;
    publicConfirmed?: boolean;
  }) => {
    if (inFlightUploadRef.current) return;

    if (
      youtubeUploadResult &&
      currentExportKey &&
      uploadedVideoKey === currentExportKey
    ) {
      setYoutubeUploadError(
        'This rendered video has already been uploaded to YouTube. Render a new video to upload again.'
      );
      return;
    }

    if (!ytSessionId || !ytChannel) {
      const msg =
        'Connect your YouTube channel via Google OAuth 2.0 first before uploading.';
      setYoutubeUploadError(msg);
      onError(msg);
      return;
    }

    if (!(exportedVideo?.blob instanceof Blob) || exportedVideo.blob.size < 16) {
      const msg =
        'Render your 9:16 WebM video first before uploading to YouTube.';
      setYoutubeUploadError(msg);
      onError(msg);
      return;
    }

    try {
      const magic = new Uint8Array(
        await exportedVideo.blob.slice(0, 4).arrayBuffer()
      );
      const isValidWebm =
        magic[0] === 0x1a &&
        magic[1] === 0x45 &&
        magic[2] === 0xdf &&
        magic[3] === 0xa3;
      if (!isValidWebm) {
        const msg =
          'Rendered video is not a valid WebM binary file. Please re-render the video and retry.';
        setYoutubeUploadError(msg);
        onError(msg);
        return;
      }
    } catch {
      const msg = 'Unable to read rendered WebM video binary data.';
      setYoutubeUploadError(msg);
      onError(msg);
      return;
    }

    const cleanTitle = params.title.trim();
    if (!cleanTitle) {
      setYoutubeUploadError('Please enter a video title before uploading.');
      return;
    }

    if (params.privacyStatus === 'public' && !params.publicConfirmed) {
      setYoutubeUploadError(
        'Explicit confirmation is required before publishing a video as Public.'
      );
      return;
    }

    inFlightUploadRef.current = true;
    setIsUploadingToYouTube(true);
    setYoutubeUploadError(null);
    setYoutubeUploadPercent(0);
    setYoutubeUploadPhase('Sending WebM video file to server...');

    const videoFilename = `${slugifyTitle(
      episode.episodeTitleEnglish
    )}-cartoon-spark.webm`;
    const webmFile = new File([exportedVideo.blob], videoFilename, {
      type: 'video/webm',
    });

    const formData = new FormData();
    formData.append('video', webmFile, videoFilename);
    if (params.thumbnailFile) {
      const thumbType =
        params.thumbnailFile.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const thumbExt = thumbType === 'image/png' ? 'png' : 'jpg';
      const thumbFilename = `${slugifyTitle(
        episode.episodeTitleEnglish
      )}-thumbnail.${thumbExt}`;
      const cleanThumbFile = new File([params.thumbnailFile], thumbFilename, {
        type: thumbType,
      });
      formData.append('thumbnail', cleanThumbFile, thumbFilename);
    }
    formData.append('title', cleanTitle);
    formData.append('description', params.description.trim());
    formData.append('tags', JSON.stringify(params.tags));
    formData.append('privacyStatus', params.privacyStatus || 'private');
    formData.append('madeForKids', params.madeForKids ? 'true' : 'false');
    formData.append(
      'publicConfirmed',
      params.publicConfirmed ? 'true' : 'false'
    );

    try {
      const result = await new Promise<YouTubeUploadResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/youtube/upload');
        xhr.withCredentials = true;
        if (ytSessionId && ytSessionId !== 'cookie-session') {
          xhr.setRequestHeader('Authorization', `Bearer ${ytSessionId}`);
        }

        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            const pct = Math.min(95, Math.round((ev.loaded / ev.total) * 95));
            setYoutubeUploadPercent(pct);
            if (pct >= 90) {
              setYoutubeUploadPhase(
                'Transferring video to YouTube Data API v3...'
              );
            }
          }
        };

        xhr.onload = () => {
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(xhr.responseText || '{}');
          } catch {
            // Non-JSON response
          }
          if (xhr.status === 401) {
            onYouTubeAuthChange(null, null);
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            const videoId =
              typeof data.videoId === 'string' ? data.videoId.trim() : '';
            const youtubeUrl =
              typeof data.youtubeUrl === 'string' ? data.youtubeUrl.trim() : '';
            if (!videoId || !youtubeUrl) {
              reject(
                new Error(
                  'YouTube did not return a confirmed video ID. Upload was not marked successful.'
                )
              );
              return;
            }
            setYoutubeUploadPercent(100);
            resolve({
              videoId,
              youtubeUrl,
              privacyStatus:
                data.privacyStatus === 'public' ||
                data.privacyStatus === 'unlisted'
                  ? data.privacyStatus
                  : 'private',
              title: typeof data.title === 'string' ? data.title : cleanTitle,
              thumbnailUploaded: Boolean(data.thumbnailUploaded),
              thumbnailWarning:
                typeof data.thumbnailWarning === 'string'
                  ? data.thumbnailWarning
                  : null,
            });
          } else {
            reject(
              new Error(
                typeof data.error === 'string'
                  ? data.error
                  : `YouTube upload failed with status ${xhr.status}.`
              )
            );
          }
        };

        xhr.onerror = () => {
          reject(
            new Error(
              'Network error occurred while sending the video to the server.'
            )
          );
        };

        xhr.send(formData);
      });

      setYoutubeUploadResult(result);
      setUploadedVideoKey(currentExportKey);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'YouTube upload failed.';
      setYoutubeUploadError(msg);
      onError(msg);
    } finally {
      inFlightUploadRef.current = false;
      setIsUploadingToYouTube(false);
      setYoutubeUploadPhase('');
    }
  };

  const handleDirectUploadFromVideoStudio = (selectedTitle: string) => {
    if (!ytChannel || !ytSessionId) {
      setYoutubeUploadError(
        'Connect your YouTube channel via Google OAuth 2.0 first, then click Upload Video.'
      );
      onTabChange('youtube-thumbnails');
      return;
    }
    const meta = episode.youtubeMetadata;
    const tags = meta.tags?.length ? meta.tags : meta.keywords || [];
    const madeForKids =
      typeof meta.madeForKids === 'boolean'
        ? meta.madeForKids
        : episode.audience === 'Kids (4-8 Years)';
    void handleUploadToYouTube({
      title: selectedTitle || meta.titles[0] || episode.episodeTitleEnglish,
      description: meta.description || '',
      tags,
      madeForKids,
      privacyStatus: 'private',
      publicConfirmed: false,
    });
  };

  const audioDataUrl = useMemo(() => {
    if (!audioBase64) return null;
    return `data:audio/wav;base64,${audioBase64}`;
  }, [audioBase64]);

  const fileSlug = slugifyTitle(episode.episodeTitleEnglish);
  const fullPackText = useMemo(() => formatEpisodeAsText(episode), [episode]);
  const allPromptsText = useMemo(() => formatAllPromptsText(episode), [episode]);

  const handleRegenerate = async (section: RegenerateSectionType) => {
    if (regenerating) return;
    setRegenerating(section);
    try {
      const res = await fetch('/api/regenerate-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episode, section }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Could not regenerate section.');
      }
      onUpdateEpisode({
        ...episode,
        ...data,
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Section regeneration failed.');
    } finally {
      setRegenerating(null);
    }
  };

  const synthesizeVoiceover = async (): Promise<string | null> => {
    const textToSpeak = editableNarration.trim();
    if (!textToSpeak) {
      throw new Error('Urdu narration text is empty.');
    }
    setIsSynthesizingAudio(true);
    try {
      const res = await fetch('/api/generate-voiceover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToSpeak,
          voiceName: voiceActor,
          style: voiceStyleInput.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Voice synthesis failed.');
      }
      setAudioBase64(data.audioBase64);
      setAudioEpisodeId(episode.id);
      return data.audioBase64 as string;
    } finally {
      setIsSynthesizingAudio(false);
    }
  };

  const handleSynthesizeButton = async () => {
    if (isSynthesizingAudio) return;
    try {
      await synthesizeVoiceover();
    } catch (err) {
      onError(
        err instanceof Error
          ? err.message
          : 'Failed to generate Urdu voiceover audio.'
      );
    }
  };

  const handleDownloadSceneImage = (sceneNumber: number, dataUrl: string) => {
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = `${fileSlug}-scene-${String(sceneNumber).padStart(2, '0')}.jpg`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const handleUploadCustomSceneImage = (
    sceneNumber: number,
    file: File | undefined
  ) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) return;
      const updatedScenes = episode.scenes.map((s) =>
        s.sceneNumber === sceneNumber ? { ...s, imageDataUrl: result } : s
      );
      onUpdateEpisode({ ...episode, scenes: updatedScenes });
    };
    reader.readAsDataURL(file);
  };

  const tabs: Array<{ id: WorkspaceTab; label: string }> = [
    { id: 'story-script', label: 'Story & 60s Script' },
    { id: 'scenes-prompts', label: '8 Scenes & Images' },
    { id: 'voiceover', label: 'Urdu Voiceover' },
    { id: 'video-studio', label: 'Video Studio & Export' },
    { id: 'youtube-thumbnails', label: 'YouTube SEO & Upload' },
    { id: 'editing-plan', label: 'Editing Plan' },
    { id: 'full-pack', label: 'Full Pack' },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Episode Header Summary */}
      <section className="rounded-xl border border-white/[0.08] bg-[#131622] p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>Cartoon Spark</span>
              <span aria-hidden="true">·</span>
              <span>{episode.tone}</span>
              <span aria-hidden="true">·</span>
              <span>{episode.artStyle}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">
                {episode.scenes.length} Scenes / {episode.shortsScript.totalDurationSeconds}s
              </span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white">
              {episode.episodeTitleEnglish}
            </h1>
            <p className="font-urdu-compact text-right text-lg font-semibold text-violet-300">
              {episode.episodeTitleUrdu}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => onTabChange('video-studio')}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500 whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <Film className="h-3.5 w-3.5" />
              <span>Preview & Export Video</span>
            </button>
            <CopyButton text={fullPackText} label="Copy Full Pack" />
            <DownloadButton
              filename={`${fileSlug}-production-pack.txt`}
              content={fullPackText}
              label="Download .txt Pack"
            />
          </div>
        </div>

        {/* Workspace Section Tabs */}
        <div className="mt-6 flex items-center gap-1 overflow-x-auto border-t border-white/[0.08] pt-4">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                  active
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* TAB 1: Original Urdu Story + 60s Shorts Script */}
      {(activeTab === 'story-script' || activeTab === 'full-pack') && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Original Urdu Story */}
          <section className="lg:col-span-7 rounded-xl border border-white/[0.08] bg-[#131622] p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  01. Original Urdu Cartoon Story
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Full storybook narration in natural Urdu script
                </p>
              </div>
              <div className="flex items-center gap-2">
                <CopyButton
                  text={`${episode.episodeTitleUrdu}\n\n${episode.urduStory}\n\nاخلاقی سبق: ${episode.moralLessonUrdu}`}
                  label="Copy Story"
                  compact
                />
                <DownloadButton
                  filename={`${fileSlug}-urdu-story.txt`}
                  content={`${episode.episodeTitleUrdu}\n\n${episode.urduStory}\n\nاخلاقی سبق: ${episode.moralLessonUrdu}`}
                  label="Download"
                  compact
                />
              </div>
            </div>

            <div className="rounded-lg bg-[#0B0D14] p-5 border border-white/[0.06]">
              <p className="font-urdu whitespace-pre-line text-base text-slate-100">
                {episode.urduStory}
              </p>
            </div>

            <div className="border-t border-white/[0.08] pt-4 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-violet-400">
                Moral Lesson
              </span>
              <p className="font-urdu-compact text-base text-white">
                {episode.moralLessonUrdu}
              </p>
              <p className="text-xs text-slate-400">{episode.moralLessonEnglish}</p>
            </div>
          </section>

          {/* 60-Second Shorts Script */}
          <section className="lg:col-span-5 rounded-xl border border-white/[0.08] bg-[#131622] p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  02. 60-Second Shorts Script
                </h2>
                <p className="mt-0.5 text-xs text-slate-400 font-mono-tabular">
                  Target Runtime: {episode.shortsScript.totalDurationSeconds}s
                </p>
              </div>
              <div className="flex items-center gap-2">
                <CopyButton
                  text={episode.shortsScript.fullScriptUrdu}
                  label="Copy Script"
                  compact
                />
                <DownloadButton
                  filename={`${fileSlug}-60s-script.txt`}
                  content={episode.shortsScript.fullScriptUrdu}
                  label="Download"
                  compact
                />
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <span className="text-xs font-medium text-violet-400">
                  First 3s Hook
                </span>
                <p className="mt-1 font-urdu-compact rounded-lg bg-[#0B0D14] px-4 py-3 text-sm text-white border border-white/[0.06]">
                  {episode.shortsScript.hookLineUrdu}
                </p>
              </div>

              <div>
                <span className="text-xs font-medium text-slate-300">
                  Complete 60s Script
                </span>
                <div className="mt-1.5 max-h-[340px] overflow-y-auto rounded-lg bg-[#0B0D14] p-4 border border-white/[0.06]">
                  <p className="font-urdu whitespace-pre-line text-sm text-slate-200">
                    {episode.shortsScript.fullScriptUrdu}
                  </p>
                </div>
              </div>

              <div className="border-t border-white/[0.08] pt-3 space-y-1.5">
                <span className="text-xs font-medium text-slate-300">
                  Closing Subscribe CTA
                </span>
                <p className="font-urdu-compact text-sm text-violet-200">
                  {episode.shortsScript.closingCtaUrdu}
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {episode.shortsScript.pacingNotes}
                </p>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: 8 Scenes + Generated 9:16 Cartoon Images + Prompts */}
      {(activeTab === 'scenes-prompts' || activeTab === 'full-pack') && (
        <section className="rounded-xl border border-white/[0.08] bg-[#131622] p-6 space-y-6">
          <div className="flex flex-col gap-4 border-b border-white/[0.08] pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">
                03. 8-Scene Storyboard, Cartoon Images & Prompts
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Consistent characters across all 8 vertical 9:16 cartoon scenes (built-in renderer; paid AI image APIs disabled unless approved)
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={regenerating === 'imagePrompts'}
                onClick={() => handleRegenerate('imagePrompts')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#181C2B] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-violet-500/40 hover:text-white disabled:opacity-50 whitespace-nowrap shrink-0 min-h-[34px]"
              >
                {regenerating === 'imagePrompts' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 text-violet-400" />
                )}
                <span>Regenerate Prompts</span>
              </button>
              <CopyButton text={allPromptsText} label="Copy All 8 Prompts" compact />
              <DownloadButton
                filename={`${fileSlug}-8-scene-prompts.txt`}
                content={allPromptsText}
                label="Download Prompts"
                compact
              />
            </div>
          </div>

          {/* Character Reference Strip */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold text-slate-300">
              Consistent Character Sheet ({episode.artStyle})
            </h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {episode.characterSheet.map((char) => (
                <div
                  key={char.name}
                  className="rounded-lg border border-white/[0.06] bg-[#0B0D14] p-4 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white">{char.name}</span>
                    <span className="text-xs text-violet-400">{char.role}</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {char.visualDescription}
                  </p>
                  <div className="flex items-center gap-1.5 pt-1">
                    {[char.primaryColor, char.secondaryColor, char.accentColor].map(
                      (col, idx) => (
                        <span
                          key={`${col}-${idx}`}
                          className="h-3 w-3 rounded-sm border border-white/15"
                          style={{ backgroundColor: col }}
                          title={col}
                        />
                      )
                    )}
                    <span className="ml-1 text-[11px] text-slate-500">
                      {char.accessory}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 8 Scene List with 9:16 Generated Images */}
          <div className="divide-y divide-white/[0.08] border-t border-white/[0.08]">
            {episode.scenes.map((scene) => {
              const sceneImg =
                scene.imageDataUrl || renderSceneCartoonImage(episode, scene);
              return (
                <div key={scene.sceneNumber} className="py-6 first:pt-6 last:pb-0">
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
                    {/* 9:16 Scene Cartoon Image */}
                    <div className="lg:col-span-3 flex flex-col items-center space-y-2.5">
                      <div className="w-full max-w-[190px] overflow-hidden rounded-xl border border-white/10 bg-[#0B0D14] aspect-[9/16]">
                        <img
                          src={sceneImg}
                          alt={`Scene ${scene.sceneNumber}: ${scene.visualAction}`}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            handleDownloadSceneImage(scene.sceneNumber, sceneImg)
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#181C2B] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-violet-500/40 hover:text-white"
                        >
                          <Download className="h-3 w-3" />
                          <span>Save .jpg</span>
                        </button>
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-white/10 bg-[#181C2B] px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:border-violet-500/40 hover:text-white">
                          <Upload className="h-3 w-3" />
                          <span>Replace</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            onChange={(e) =>
                              handleUploadCustomSceneImage(
                                scene.sceneNumber,
                                e.target.files?.[0]
                              )
                            }
                          />
                        </label>
                      </div>
                    </div>

                    {/* Scene Details & Urdu Narration */}
                    <div className="lg:col-span-4 space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono-tabular font-semibold text-violet-400">
                          Scene {String(scene.sceneNumber).padStart(2, '0')}
                        </span>
                        <span className="text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-mono-tabular text-slate-300">
                          {scene.timeRange}
                        </span>
                        <span className="text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-mono-tabular text-slate-400">
                          {scene.durationSeconds}s
                        </span>
                      </div>

                      <p className="text-sm text-slate-200 leading-relaxed">
                        {scene.visualAction}
                      </p>

                      <p className="text-xs text-slate-400">
                        Camera: {scene.cameraMovement} · SFX: {scene.sfxCue}
                      </p>

                      <div className="rounded-lg border border-white/[0.06] bg-[#0B0D14] p-3.5 space-y-1.5">
                        <p className="font-urdu-compact text-sm text-white">
                          {scene.urduNarration}
                        </p>
                        <p className="text-xs text-slate-400 italic">
                          {scene.romanUrduCaption}
                        </p>
                      </div>
                    </div>

                    {/* Cartoon Image Prompt */}
                    <div className="lg:col-span-5 flex flex-col justify-between rounded-lg border border-white/[0.06] bg-[#0B0D14] p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-300">
                          Cartoon Image Prompt (9:16)
                        </span>
                        <CopyButton text={scene.imagePrompt} label="Copy Prompt" compact />
                      </div>
                      <p className="font-mono text-xs text-slate-300 leading-relaxed">
                        {scene.imagePrompt}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* TAB 3: Urdu Voiceover Narration + Real Gemini TTS Audio */}
      {(activeTab === 'voiceover' || activeTab === 'full-pack') && (
        <section className="rounded-xl border border-white/[0.08] bg-[#131622] p-6 space-y-6">
          <div className="flex flex-col gap-4 border-b border-white/[0.08] pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">
                04. Urdu Voiceover Studio & Narration Script
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {episode.voiceoverPlan.recommendedVoiceStyle} ·{' '}
                <span className="font-mono-tabular">
                  {episode.voiceoverPlan.speakingRateWpm} WPM
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={regenerating === 'voiceover'}
                onClick={() => handleRegenerate('voiceover')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#181C2B] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-violet-500/40 hover:text-white disabled:opacity-50 whitespace-nowrap shrink-0 min-h-[34px]"
              >
                {regenerating === 'voiceover' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 text-violet-400" />
                )}
                <span>Regenerate Script</span>
              </button>
              <CopyButton
                text={episode.voiceoverPlan.urduVoiceoverWithCues}
                label="Copy Cued Script"
                compact
              />
              <DownloadButton
                filename={`${fileSlug}-urdu-voiceover.txt`}
                content={`${episode.voiceoverPlan.urduVoiceoverWithCues}\n\n--- CLEAN NARRATION ---\n${episode.voiceoverPlan.cleanUrduNarration}`}
                label="Download Script"
                compact
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left: Voiceover Script with Pacing Cues */}
            <div className="lg:col-span-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-300">
                  Voiceover Script with Pause & Tone Cues
                </h3>
                <CopyButton
                  text={episode.voiceoverPlan.urduVoiceoverWithCues}
                  label="Copy"
                  compact
                />
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-[#0B0D14] p-5">
                <p className="font-urdu whitespace-pre-line text-sm text-slate-100">
                  {episode.voiceoverPlan.urduVoiceoverWithCues}
                </p>
              </div>
            </div>

            {/* Right: Gemini TTS Audio Generator */}
            <div className="lg:col-span-6 space-y-4 rounded-lg border border-white/[0.06] bg-[#0B0D14] p-5">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Generate Playable Urdu Audio (.wav)
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Synthesize a ready-to-edit Urdu voiceover track directly with Gemini Speech. This audio automatically syncs into your 9:16 Video Studio export.
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Narrator Voice
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {VOICE_OPTIONS.map((voice) => (
                    <button
                      key={voice.id}
                      type="button"
                      onClick={() => setVoiceActor(voice.id)}
                      className={`rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                        voiceActor === voice.id
                          ? 'border-violet-500 bg-violet-600/20 text-white'
                          : 'border-white/10 bg-[#131622] text-slate-300 hover:border-white/20'
                      }`}
                    >
                      <div className="text-xs font-semibold">{voice.label}</div>
                      <div className="truncate text-[11px] text-slate-400">
                        {voice.tone}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="tts-style"
                  className="block text-xs font-medium text-slate-300"
                >
                  Delivery Direction
                </label>
                <input
                  id="tts-style"
                  type="text"
                  value={voiceStyleInput}
                  onChange={(e) => setVoiceStyleInput(e.target.value)}
                  className="w-full min-h-[38px] rounded-lg border border-white/10 bg-[#131622] px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="tts-text"
                    className="block text-xs font-medium text-slate-300"
                  >
                    Clean Urdu Text for Audio (Editable)
                  </label>
                  <CopyButton text={editableNarration} label="Copy Text" compact />
                </div>
                <textarea
                  id="tts-text"
                  rows={5}
                  value={editableNarration}
                  onChange={(e) => setEditableNarration(e.target.value)}
                  className="font-urdu-compact w-full rounded-lg border border-white/10 bg-[#131622] p-3.5 text-sm text-white focus:border-violet-500 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  disabled={isSynthesizingAudio || !editableNarration.trim()}
                  onClick={handleSynthesizeButton}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50 whitespace-nowrap shrink-0 min-h-[40px]"
                >
                  {isSynthesizingAudio ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Synthesizing Urdu Voiceover...</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-4 w-4" />
                      <span>Generate Urdu Voiceover Audio</span>
                    </>
                  )}
                </button>

                {audioBase64 && (
                  <button
                    type="button"
                    onClick={() =>
                      downloadBase64Wav(`${fileSlug}-urdu-voiceover.wav`, audioBase64)
                    }
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-2.5 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-500/20 whitespace-nowrap shrink-0 min-h-[40px]"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download .wav Audio</span>
                  </button>
                )}
              </div>

              {audioDataUrl && (
                <div className="rounded-lg border border-violet-500/30 bg-[#131622] p-3.5 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Urdu voiceover ready ({voiceActor})</span>
                  </div>
                  <audio controls src={audioDataUrl} className="w-full h-10" />
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* TAB 4: 9:16 Video Studio & WebM Export */}
      {(activeTab === 'video-studio' || activeTab === 'full-pack') && (
        <VideoStudioPanel
          episode={episode}
          voiceActor={voiceActor}
          narrationAudioBase64={audioBase64}
          exportedVideo={exportedVideo}
          ytChannel={ytChannel}
          isUploadingToYouTube={isUploadingToYouTube}
          youtubeUploadPercent={youtubeUploadPercent}
          youtubeUploadPhase={youtubeUploadPhase}
          youtubeUploadError={youtubeUploadError}
          youtubeUploadResult={youtubeUploadResult}
          isAlreadyUploaded={isAlreadyUploaded}
          onVideoExported={handleVideoExported}
          onDirectUploadToYouTube={handleDirectUploadFromVideoStudio}
          onOpenYouTubeUpload={() => onTabChange('youtube-thumbnails')}
          onSynthesizeVoiceover={synthesizeVoiceover}
          onError={onError}
        />
      )}

      {/* TAB 5: YouTube SEO, OAuth Channel Connection, Video Upload & Thumbnail Text */}
      {(activeTab === 'youtube-thumbnails' || activeTab === 'full-pack') && (
        <div className="space-y-6">
          <YouTubeUploadPanel
            episode={episode}
            exportedVideo={exportedVideo}
            ytSessionId={ytSessionId}
            ytChannel={ytChannel}
            isUploading={isUploadingToYouTube}
            uploadPercent={youtubeUploadPercent}
            uploadPhase={youtubeUploadPhase}
            uploadError={youtubeUploadError}
            uploadResult={youtubeUploadResult}
            isAlreadyUploaded={isAlreadyUploaded}
            onClearUploadError={() => setYoutubeUploadError(null)}
            onExecuteUpload={handleUploadToYouTube}
            onAuthChange={onYouTubeAuthChange}
            onUpdateEpisode={onUpdateEpisode}
            onRegenerateSeo={() => handleRegenerate('titles')}
            isRegeneratingSeo={regenerating === 'titles'}
            onJumpToVideoRender={() => onTabChange('video-studio')}
            onError={onError}
          />

          {/* Thumbnail Text Suggestions */}
          <section className="rounded-xl border border-white/[0.08] bg-[#131622] p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  07. Thumbnail Text Suggestions
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Bold 2–4 word Urdu hooks for mobile readability
                </p>
              </div>
              <button
                type="button"
                disabled={regenerating === 'thumbnails'}
                onClick={() => handleRegenerate('thumbnails')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#181C2B] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-violet-500/40 hover:text-white disabled:opacity-50 whitespace-nowrap shrink-0 min-h-[34px]"
              >
                {regenerating === 'thumbnails' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 text-violet-400" />
                )}
                <span>New Ideas</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {episode.thumbnailSuggestions.map((thumb, idx) => (
                <div
                  key={`${thumb.conceptName}-${idx}`}
                  className="rounded-lg border border-white/[0.06] bg-[#0B0D14] p-4 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-400">
                      Option 0{idx + 1} · {thumb.conceptName}
                    </span>
                    <CopyButton
                      text={`${thumb.urduText} (${thumb.englishBadge})`}
                      label="Copy Text"
                      compact
                    />
                  </div>

                  {/* Mockup Thumbnail Text Frame */}
                  <div className="rounded-lg bg-gradient-to-br from-[#1B1730] via-[#131622] to-[#0B0D14] border border-violet-500/25 p-4 text-center space-y-1">
                    <p className="font-urdu-compact text-xl font-bold text-amber-300 text-center">
                      {thumb.urduText}
                    </p>
                    <p className="text-xs font-semibold tracking-wide text-violet-300">
                      {thumb.englishBadge}
                    </p>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {thumb.visualComposition}
                  </p>
                  <p className="text-xs text-slate-400">
                    Palette: {thumb.colorDirection}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* TAB 6: Complete Video Editing Plan */}
      {(activeTab === 'editing-plan' || activeTab === 'full-pack') && (
        <section className="rounded-xl border border-white/[0.08] bg-[#131622] p-6 space-y-6">
          <div className="flex flex-col gap-4 border-b border-white/[0.08] pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">
                08. Complete Video Editing Plan
              </h2>
              <p className="mt-0.5 text-xs text-slate-400 font-mono-tabular">
                {episode.editingPlan.aspectRatio} · {episode.editingPlan.resolution} ·{' '}
                {episode.editingPlan.targetFps}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={regenerating === 'editingPlan'}
                onClick={() => handleRegenerate('editingPlan')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#181C2B] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-violet-500/40 hover:text-white disabled:opacity-50 whitespace-nowrap shrink-0 min-h-[34px]"
              >
                {regenerating === 'editingPlan' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 text-violet-400" />
                )}
                <span>Regenerate Plan</span>
              </button>
              <CopyButton
                text={`VIDEO EDITING PLAN (${episode.episodeTitleEnglish})\nFormat: ${episode.editingPlan.aspectRatio} | ${episode.editingPlan.resolution} | ${episode.editingPlan.targetFps}\nBGM: ${episode.editingPlan.bgmMood}\nCaptions: ${episode.editingPlan.captionStyle}\nColor: ${episode.editingPlan.colorGrading}\nTransitions: ${episode.editingPlan.transitionRules}\n\nSTEPS:\n${episode.editingPlan.timelineSteps
                  .map(
                    (s) =>
                      `${s.stepNumber}. [${s.timeWindow}] ${s.phaseTitle}: ${s.instructions}`
                  )
                  .join('\n')}`}
                label="Copy Plan"
                compact
              />
            </div>
          </div>

          {/* Technical & Creative Specs Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-white/[0.06] bg-[#0B0D14] p-4 space-y-1">
              <span className="text-xs text-slate-400">BGM & Audio Mix</span>
              <p className="text-sm font-medium text-white leading-snug">
                {episode.editingPlan.bgmMood}
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-[#0B0D14] p-4 space-y-1">
              <span className="text-xs text-slate-400">Caption Style</span>
              <p className="text-sm font-medium text-white leading-snug">
                {episode.editingPlan.captionStyle}
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-[#0B0D14] p-4 space-y-1">
              <span className="text-xs text-slate-400">Color Grading</span>
              <p className="text-sm font-medium text-white leading-snug">
                {episode.editingPlan.colorGrading}
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-[#0B0D14] p-4 space-y-1">
              <span className="text-xs text-slate-400">Transitions</span>
              <p className="text-sm font-medium text-white leading-snug">
                {episode.editingPlan.transitionRules}
              </p>
            </div>
          </div>

          {/* 5-Step Beginner Editor Guide */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-300">
              Step-by-Step CapCut / Premiere Workflow
            </h3>
            <div className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.06] bg-[#0B0D14]">
              {episode.editingPlan.timelineSteps.map((step) => (
                <div
                  key={step.stepNumber}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:gap-6"
                >
                  <div className="flex items-center gap-3 sm:w-56 shrink-0">
                    <span className="font-mono-tabular text-xs font-semibold text-violet-400">
                      Step 0{step.stepNumber}
                    </span>
                    <span className="text-sm font-semibold text-white">
                      {step.phaseTitle}
                    </span>
                  </div>
                  <div className="flex-1 space-y-1">
                    <span className="font-mono-tabular text-xs text-slate-400">
                      {step.timeWindow}
                    </span>
                    <p className="text-sm text-slate-200 leading-relaxed">
                      {step.instructions}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Scene-by-Scene Timeline Cue Table */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-300">
              8-Scene Timeline Cue Sheet
            </h3>
            <div className="overflow-x-auto rounded-lg border border-white/[0.06] bg-[#0B0D14]">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08] text-slate-400">
                    <th className="px-4 py-3 font-medium">Scene</th>
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Camera Motion</th>
                    <th className="px-4 py-3 font-medium">SFX Cue</th>
                    <th className="px-4 py-3 font-medium text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {episode.scenes.map((scene) => (
                    <tr
                      key={scene.sceneNumber}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 py-2.5 font-mono-tabular font-semibold text-violet-300">
                        #{String(scene.sceneNumber).padStart(2, '0')}
                      </td>
                      <td className="px-4 py-2.5 font-mono-tabular text-slate-300 whitespace-nowrap">
                        {scene.timeRange}
                      </td>
                      <td className="px-4 py-2.5 text-slate-200">
                        {scene.cameraMovement}
                      </td>
                      <td className="px-4 py-2.5 text-slate-300">{scene.sfxCue}</td>
                      <td className="px-4 py-2.5 text-right font-mono-tabular text-slate-300">
                        {scene.durationSeconds}s
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
