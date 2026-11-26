import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Upload,
  Youtube,
} from 'lucide-react';
import type {
  EpisodePack,
  YouTubeChannelInfo,
  YouTubeConfigStatus,
  YouTubePrivacyStatus,
  YouTubeUploadResult,
} from '../types/episode';
import type { RenderedVideoResult } from '../utils/videoEngine';
import { generateAutoThumbnailBlob } from '../utils/thumbnailRenderer';
import { CopyButton, DownloadButton } from './CopyDownloadActions';
import { slugifyTitle } from '../utils/exportEpisode';

interface YouTubeUploadPanelProps {
  episode: EpisodePack;
  exportedVideo: RenderedVideoResult | null;
  ytSessionId: string | null;
  ytChannel: YouTubeChannelInfo | null;
  isUploading: boolean;
  uploadPercent: number;
  uploadPhase: string;
  uploadError: string | null;
  uploadResult: YouTubeUploadResult | null;
  isAlreadyUploaded: boolean;
  onClearUploadError: () => void;
  onExecuteUpload: (params: {
    title: string;
    description: string;
    tags: string[];
    madeForKids: boolean;
    privacyStatus: YouTubePrivacyStatus;
    thumbnailFile?: File | Blob | null;
    publicConfirmed?: boolean;
  }) => Promise<void>;
  onAuthChange: (
    sessionId: string | null,
    channel: YouTubeChannelInfo | null
  ) => void;
  onUpdateEpisode: (updated: EpisodePack) => void;
  onRegenerateSeo: () => Promise<void>;
  isRegeneratingSeo: boolean;
  onJumpToVideoRender?: () => void;
  onError: (msg: string) => void;
}

export function YouTubeUploadPanel({
  episode,
  exportedVideo,
  ytSessionId,
  ytChannel,
  isUploading,
  uploadPercent,
  uploadPhase,
  uploadError,
  uploadResult,
  isAlreadyUploaded,
  onClearUploadError,
  onExecuteUpload,
  onAuthChange,
  onUpdateEpisode,
  onRegenerateSeo,
  isRegeneratingSeo,
  onJumpToVideoRender,
  onError,
}: YouTubeUploadPanelProps) {
  const meta = episode.youtubeMetadata;
  const fileSlug = slugifyTitle(episode.episodeTitleEnglish);

  // Editable SEO Metadata State synced with episode
  const [title, setTitle] = useState(
    meta.titles[0] || episode.episodeTitleEnglish
  );
  const [storySummary, setStorySummary] = useState(
    meta.storySummary || episode.moralLessonEnglish
  );
  const [description, setDescription] = useState(meta.description || '');
  const [hashtagsText, setHashtagsText] = useState(
    (meta.hashtags || []).join(' ')
  );
  const [tagsText, setTagsText] = useState(
    (meta.tags || meta.keywords || []).join(', ')
  );
  const [madeForKids, setMadeForKids] = useState<boolean>(
    typeof meta.madeForKids === 'boolean'
      ? meta.madeForKids
      : episode.audience === 'Kids (4-8 Years)'
  );

  // OAuth & Config Status
  const [configStatus, setConfigStatus] = useState<YouTubeConfigStatus | null>(
    null
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Upload & Thumbnail State (visibility defaults to PRIVATE)
  const [privacyStatus, setPrivacyStatus] =
    useState<YouTubePrivacyStatus>('private');
  const [showPublicConfirmModal, setShowPublicConfirmModal] = useState(false);
  const [thumbnailFile, setThumbnailFile] = useState<File | Blob | null>(null);
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState<string | null>(
    null
  );
  const [thumbnailLabel, setThumbnailLabel] = useState<string>('');
  const [isBuildingThumbnail, setIsBuildingThumbnail] = useState(false);

  // Sync editable SEO fields when episode or regenerated metadata changes (without wiping uploadResult)
  useEffect(() => {
    setTitle(episode.youtubeMetadata.titles[0] || episode.episodeTitleEnglish);
    setStorySummary(
      episode.youtubeMetadata.storySummary || episode.moralLessonEnglish
    );
    setDescription(episode.youtubeMetadata.description || '');
    setHashtagsText((episode.youtubeMetadata.hashtags || []).join(' '));
    setTagsText(
      (
        episode.youtubeMetadata.tags ||
        episode.youtubeMetadata.keywords ||
        []
      ).join(', ')
    );
    setMadeForKids(
      typeof episode.youtubeMetadata.madeForKids === 'boolean'
        ? episode.youtubeMetadata.madeForKids
        : episode.audience === 'Kids (4-8 Years)'
    );
  }, [episode.id, episode.youtubeMetadata]);

  useEffect(() => {
    setLocalError(null);
  }, [episode.id]);

  // Check server OAuth configuration & existing connection status
  const refreshYouTubeStatus = async (tokenOverride?: string | null) => {
    try {
      const token = tokenOverride !== undefined ? tokenOverride : ytSessionId;
      const headers: Record<string, string> = {};
      if (token && token !== 'cookie-session') {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch('/api/youtube/status', {
        headers,
        credentials: 'include',
      });
      const data = await res.json();
      setConfigStatus({
        oauthConfigured: Boolean(data.oauthConfigured),
        callbackUrl:
          data.callbackUrl ||
          `${window.location.origin}/api/youtube/auth/callback`,
        missingVars: Array.isArray(data.missingVars) ? data.missingVars : [],
      });
      if (data.connected && data.channel) {
        onAuthChange(data.sessionId || token || 'cookie-session', data.channel);
      }
    } catch {
      // Ignore silent status check errors
    }
  };

  useEffect(() => {
    refreshYouTubeStatus();
  }, []);

  // Listen for Google OAuth popup callback postMessage
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin || '';
      const validOrigin =
        origin === window.location.origin ||
        origin.endsWith('.run.app') ||
        origin.includes('localhost');
      if (!validOrigin) return;

      if (event.data?.type === 'YOUTUBE_OAUTH_SUCCESS') {
        setIsConnecting(false);
        setLocalError(null);
        onClearUploadError();
        const newSessionId = event.data.sessionId as string;
        const channel = event.data.channel as YouTubeChannelInfo;
        onAuthChange(newSessionId, channel);
      } else if (event.data?.type === 'YOUTUBE_OAUTH_ERROR') {
        setIsConnecting(false);
        const errText =
          event.data.error || 'Google OAuth authorization failed.';
        setLocalError(errText);
        onError(errText);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onAuthChange, onError]);

  const parsedTags = useMemo(() => {
    return tagsText
      .split(',')
      .map((t) => t.replace(/^#/, '').trim())
      .filter(Boolean);
  }, [tagsText]);

  const parsedHashtags = useMemo(() => {
    return hashtagsText
      .split(/\s+/)
      .map((h) => h.trim())
      .filter(Boolean)
      .map((h) => (h.startsWith('#') ? h : `#${h}`));
  }, [hashtagsText]);

  const tagsCharLength = parsedTags.join(',').length;

  const persistMetadataEdits = (overrides?: Partial<{
    title: string;
    storySummary: string;
    description: string;
    hashtags: string[];
    tags: string[];
    madeForKids: boolean;
  }>) => {
    const nextTitle = overrides?.title ?? title;
    const updatedTitles = [
      nextTitle,
      ...episode.youtubeMetadata.titles.filter((t) => t !== nextTitle),
    ].slice(0, 3);

    onUpdateEpisode({
      ...episode,
      youtubeMetadata: {
        ...episode.youtubeMetadata,
        titles: updatedTitles,
        storySummary: overrides?.storySummary ?? storySummary,
        description: overrides?.description ?? description,
        hashtags: overrides?.hashtags ?? parsedHashtags,
        tags: overrides?.tags ?? parsedTags,
        madeForKids: overrides?.madeForKids ?? madeForKids,
      },
    });
  };

  const handleRebuildDescription = () => {
    const rebuilt = [
      `${episode.episodeTitleUrdu} | ${title}`,
      '',
      `Story Summary:`,
      storySummary.trim(),
      '',
      `Moral Lesson (اخلاقی سبق):`,
      `${episode.moralLessonUrdu}`,
      `${episode.moralLessonEnglish}`,
      '',
      `Subscribe to Cartoon Spark for new Urdu cartoon stories every week!`,
      '',
      parsedHashtags.join(' '),
    ].join('\n');
    setDescription(rebuilt);
    persistMetadataEdits({ description: rebuilt });
  };

  const handleConnectYouTube = async () => {
    setLocalError(null);
    setIsConnecting(true);
    try {
      const res = await fetch('/api/youtube/auth/url');
      const data = await res.json();
      if (!res.ok) {
        setIsConnecting(false);
        setLocalError(data.error || 'Could not start Google OAuth flow.');
        return;
      }

      const popup = window.open(
        data.url,
        'cartoon_spark_youtube_oauth',
        'width=600,height=720,scrollbars=yes,resizable=yes'
      );

      if (!popup) {
        setIsConnecting(false);
        setLocalError(
          'Your browser blocked the Google sign-in popup. Please allow popups for this site and click Connect YouTube Channel again.'
        );
        return;
      }

      // Detect if user manually closed the popup before completing auth
      const pollClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollClosed);
          setIsConnecting(false);
        }
      }, 600);
    } catch (err) {
      setIsConnecting(false);
      const msg =
        err instanceof Error ? err.message : 'Failed to initiate YouTube sign-in.';
      setLocalError(msg);
      onError(msg);
    }
  };

  const handleDisconnectYouTube = async () => {
    try {
      const headers: Record<string, string> = {};
      if (ytSessionId && ytSessionId !== 'cookie-session') {
        headers.Authorization = `Bearer ${ytSessionId}`;
      }
      await fetch('/api/youtube/disconnect', {
        method: 'POST',
        headers,
        credentials: 'include',
      });
    } catch {
      // Ignore network errors on local disconnect
    }
    onAuthChange(null, null);
  };

  const handleAutoThumbnail = async () => {
    setIsBuildingThumbnail(true);
    setLocalError(null);
    try {
      const { blob, dataUrl } = await generateAutoThumbnailBlob(episode);
      setThumbnailFile(blob);
      setThumbnailPreviewUrl(dataUrl);
      setThumbnailLabel('Auto-generated 1280×720 JPEG (Scene 1 + Urdu Text)');
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : 'Could not generate thumbnail.'
      );
    } finally {
      setIsBuildingThumbnail(false);
    }
  };

  const handleCustomThumbnailUpload = (file: File | undefined) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setLocalError('YouTube thumbnails must be a JPG or PNG image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLocalError('Thumbnail file must be under 2 MB for YouTube upload.');
      return;
    }
    setLocalError(null);
    setThumbnailFile(file);
    setThumbnailLabel(`${file.name} (${Math.round(file.size / 1024)} KB)`);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setThumbnailPreviewUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const executeYouTubeUpload = async (confirmedPublic: boolean) => {
    setLocalError(null);
    onClearUploadError();
    persistMetadataEdits();
    await onExecuteUpload({
      title,
      description,
      tags: parsedTags,
      madeForKids,
      privacyStatus,
      thumbnailFile,
      publicConfirmed: confirmedPublic,
    });
  };

  const handleUploadClick = () => {
    if (isUploading || isAlreadyUploaded) return;
    if (privacyStatus === 'public') {
      setShowPublicConfirmModal(true);
      return;
    }
    void executeYouTubeUpload(false);
  };

  const fullMetadataCopy = [
    `TITLE:\n${title}`,
    `STORY SUMMARY:\n${storySummary}`,
    `DESCRIPTION:\n${description}`,
    `TAGS:\n${parsedTags.join(', ')}`,
    `HASHTAGS:\n${parsedHashtags.join(' ')}`,
    `AUDIENCE:\n${
      madeForKids
        ? 'Made for Kids (COPPA)'
        : 'Not Made for Kids (General Family)'
    }`,
  ].join('\n\n');

  return (
    <div className="space-y-6">
      {/* Public Upload Confirmation Modal */}
      {showPublicConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-amber-500/35 bg-[#131622] p-6 space-y-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div className="space-y-1.5">
                <h3 className="text-base font-semibold text-white">
                  Confirm Public YouTube Publish
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  You selected <strong>Public</strong> visibility. Once uploaded,
                  this video (<span className="text-white">{title}</span>) will
                  be immediately visible to everyone on YouTube.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowPublicConfirmModal(false)}
                className="rounded-lg border border-white/10 bg-[#181C2B] px-4 py-2 text-xs font-medium text-slate-200 hover:text-white min-h-[38px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPublicConfirmModal(false);
                  executeYouTubeUpload(true);
                }}
                className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500 min-h-[38px]"
              >
                Confirm & Upload Publicly
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FEATURE 2: Secure YouTube Account Connection */}
      <section className="rounded-xl border border-white/[0.08] bg-[#131622] p-6 space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Youtube className="h-4 w-4 text-violet-400" />
              <h2 className="text-base font-semibold text-white">
                YouTube Channel Connection (Google OAuth 2.0)
              </h2>
            </div>
            <p className="text-xs text-slate-400">
              Connect your own YouTube channel securely via Google OAuth. Your Google password and OAuth client secrets are never stored or exposed in the browser.
            </p>
          </div>

          {ytChannel ? (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-[#0B0D14] px-3.5 py-2 shrink-0">
              {ytChannel.thumbnailUrl && (
                <img
                  src={ytChannel.thumbnailUrl}
                  alt={ytChannel.title}
                  referrerPolicy="no-referrer"
                  className="h-8 w-8 rounded-full object-cover"
                />
              )}
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-white">
                  {ytChannel.title}
                </div>
                <div className="text-[11px] text-emerald-300">
                  Connected
                  {ytChannel.customUrl ? ` · ${ytChannel.customUrl}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={handleDisconnectYouTube}
                className="ml-2 inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:border-rose-500/40 hover:text-rose-200"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Disconnect</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={isConnecting}
              onClick={handleConnectYouTube}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50 whitespace-nowrap shrink-0 min-h-[40px]"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Waiting for Google Sign-In...</span>
                </>
              ) : (
                <>
                  <Youtube className="h-4 w-4" />
                  <span>Connect YouTube Channel</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* OAuth Configuration Requirements Box (shown cleanly when server env vars are missing) */}
        {configStatus && !configStatus.oauthConfigured && (
          <div className="rounded-lg border border-amber-500/30 bg-[#0B0D14] p-4 space-y-2.5">
            <div className="text-xs font-semibold text-amber-300">
              Google OAuth & YouTube Data API v3 Setup Required
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              To enable live channel sign-in and direct uploads, configure these server secrets in AI Studio <strong>Settings &gt; Secrets</strong>:
            </p>
            <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-400">
              <li>
                Enable <strong>YouTube Data API v3</strong> in Google Cloud Console.
              </li>
              <li>
                Create an <strong>OAuth 2.0 Web Application Client</strong> and add this exact Authorized Redirect URI:
              </li>
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/10 bg-[#131622] px-3 py-2">
              <code className="font-mono text-xs text-violet-300 break-all">
                {configStatus.callbackUrl}
              </code>
              <CopyButton text={configStatus.callbackUrl} label="Copy URI" compact />
            </div>
            <p className="text-xs text-slate-400">
              Missing server secrets:{' '}
              <span className="font-mono text-slate-200">
                {configStatus.missingVars.join(', ')}
              </span>
            </p>
          </div>
        )}

        {(localError || uploadError) && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-rose-500/35 bg-rose-950/35 p-3.5 text-xs text-rose-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <span>{uploadError || localError}</span>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* FEATURE 1: Automatic & Editable YouTube SEO Metadata */}
        <section className="lg:col-span-7 rounded-xl border border-white/[0.08] bg-[#131622] p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
            <div>
              <h2 className="text-base font-semibold text-white">
                Automatic YouTube SEO & Description
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Auto-generated from your Urdu story, summary, and moral — edit any field before upload
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isRegeneratingSeo}
                onClick={onRegenerateSeo}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#181C2B] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-violet-500/40 hover:text-white disabled:opacity-50 min-h-[34px]"
              >
                {isRegeneratingSeo ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 text-violet-400" />
                )}
                <span>Regenerate SEO</span>
              </button>
              <CopyButton text={fullMetadataCopy} label="Copy All SEO" compact />
              <DownloadButton
                filename={`${fileSlug}-youtube-seo.txt`}
                content={fullMetadataCopy}
                label="Download .txt"
                compact
              />
            </div>
          </div>

          {/* Title + AI Title Quick-Pick */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="yt-edit-title"
                className="text-xs font-semibold text-slate-300"
              >
                YouTube Title ({title.length}/100)
              </label>
              <CopyButton text={title} label="Copy Title" compact />
            </div>
            <input
              id="yt-edit-title"
              type="text"
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => persistMetadataEdits()}
              className="w-full min-h-[42px] rounded-lg border border-white/10 bg-[#0B0D14] px-3.5 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {meta.titles.map((opt, idx) => (
                <button
                  key={`${opt}-${idx}`}
                  type="button"
                  onClick={() => {
                    setTitle(opt);
                    persistMetadataEdits({ title: opt });
                  }}
                  className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors truncate max-w-full ${
                    title === opt
                      ? 'border-violet-500 bg-violet-600/20 text-violet-200'
                      : 'border-white/10 bg-[#0B0D14] text-slate-400 hover:text-white'
                  }`}
                >
                  Option {idx + 1}: {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Short Story Summary */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="yt-story-summary"
                className="text-xs font-semibold text-slate-300"
              >
                Short Story Summary
              </label>
              <CopyButton text={storySummary} label="Copy Summary" compact />
            </div>
            <textarea
              id="yt-story-summary"
              rows={2}
              value={storySummary}
              onChange={(e) => setStorySummary(e.target.value)}
              onBlur={() => persistMetadataEdits()}
              className="w-full rounded-lg border border-white/10 bg-[#0B0D14] px-3.5 py-2.5 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
            />
          </div>

          {/* Complete Editable Description */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="yt-edit-desc"
                className="text-xs font-semibold text-slate-300"
              >
                YouTube Description ({description.length}/5000)
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRebuildDescription}
                  className="text-xs text-violet-400 hover:text-violet-300"
                >
                  Rebuild with Moral & Summary
                </button>
                <CopyButton text={description} label="Copy Description" compact />
              </div>
            </div>
            <textarea
              id="yt-edit-desc"
              rows={7}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => persistMetadataEdits()}
              className="w-full rounded-lg border border-white/10 bg-[#0B0D14] px-3.5 py-3 text-xs text-slate-200 leading-relaxed focus:border-violet-500 focus:outline-none"
            />
          </div>

          {/* Searchable YouTube Tags */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="yt-edit-tags"
                className="text-xs font-semibold text-slate-300"
              >
                Searchable YouTube Tags (comma-separated · {tagsCharLength}/480 chars)
              </label>
              <CopyButton text={parsedTags.join(', ')} label="Copy Tags" compact />
            </div>
            <textarea
              id="yt-edit-tags"
              rows={2}
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              onBlur={() => persistMetadataEdits()}
              placeholder="urdu cartoon, cartoon spark, urdu kahani, moral story"
              className="w-full rounded-lg border border-white/10 bg-[#0B0D14] px-3.5 py-2.5 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
            />
          </div>

          {/* Hashtags */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="yt-edit-hashtags"
                className="text-xs font-semibold text-slate-300"
              >
                Relevant Hashtags
              </label>
              <CopyButton text={parsedHashtags.join(' ')} label="Copy Hashtags" compact />
            </div>
            <input
              id="yt-edit-hashtags"
              type="text"
              value={hashtagsText}
              onChange={(e) => setHashtagsText(e.target.value)}
              onBlur={() => persistMetadataEdits()}
              className="w-full min-h-[40px] rounded-lg border border-white/10 bg-[#0B0D14] px-3.5 py-2 font-mono text-xs text-violet-300 focus:border-violet-500 focus:outline-none"
            />
          </div>

          {/* Suitable Audience Setting */}
          <div className="space-y-2 border-t border-white/[0.08] pt-4">
            <span className="block text-xs font-semibold text-slate-300">
              Audience Setting (COPPA Compliance)
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setMadeForKids(true);
                  persistMetadataEdits({ madeForKids: true });
                }}
                className={`rounded-lg border px-3.5 py-2.5 text-left text-xs transition-colors ${
                  madeForKids
                    ? 'border-violet-500 bg-violet-600/20 text-white'
                    : 'border-white/10 bg-[#0B0D14] text-slate-400 hover:text-white'
                }`}
              >
                <div className="font-semibold">Yes, it's Made for Kids</div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  Best for young children's cartoon stories
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMadeForKids(false);
                  persistMetadataEdits({ madeForKids: false });
                }}
                className={`rounded-lg border px-3.5 py-2.5 text-left text-xs transition-colors ${
                  !madeForKids
                    ? 'border-violet-500 bg-violet-600/20 text-white'
                    : 'border-white/10 bg-[#0B0D14] text-slate-400 hover:text-white'
                }`}
              >
                <div className="font-semibold">No, Not Made for Kids</div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  General family audience with full comments
                </div>
              </button>
            </div>
            {meta.audienceGuidance && (
              <p className="text-[11px] text-slate-400">{meta.audienceGuidance}</p>
            )}
          </div>
        </section>

        {/* FEATURE 3: Automatic YouTube Video & Thumbnail Upload */}
        <section className="lg:col-span-5 rounded-xl border border-white/[0.08] bg-[#131622] p-6 space-y-5">
          <div className="border-b border-white/[0.08] pb-4">
            <h2 className="text-base font-semibold text-white">
              Upload Video to YouTube
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Uploads your rendered 9:16 video, title, description, tags, and thumbnail via YouTube Data API v3
            </p>
          </div>

          {/* 1. Video File Status */}
          <div className="rounded-lg border border-white/[0.06] bg-[#0B0D14] p-4 space-y-2">
            <div className="text-xs font-semibold text-slate-300">
              1. Video File Status
            </div>
            {exportedVideo?.blob ? (
              <div className="flex items-center gap-2 text-xs text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  Ready: 9:16 WebM Video (
                  {Math.round(exportedVideo.blob.size / 1024)} KB ·{' '}
                  {exportedVideo.durationSeconds}s)
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-amber-300">
                  Render your 9:16 WebM video first before uploading to YouTube.
                </p>
                {onJumpToVideoRender && (
                  <button
                    type="button"
                    onClick={onJumpToVideoRender}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-600/15 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-600/25"
                  >
                    <span>Go to Video Render Controls</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 2. Optional Thumbnail Upload */}
          <div className="rounded-lg border border-white/[0.06] bg-[#0B0D14] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-300">
                2. Custom Thumbnail (Optional)
              </span>
              {thumbnailPreviewUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setThumbnailFile(null);
                    setThumbnailPreviewUrl(null);
                    setThumbnailLabel('');
                  }}
                  className="text-[11px] text-rose-300 hover:text-rose-200"
                >
                  Remove
                </button>
              )}
            </div>

            {thumbnailPreviewUrl && (
              <div className="space-y-1.5">
                <img
                  src={thumbnailPreviewUrl}
                  alt="Selected YouTube thumbnail preview"
                  className="w-full rounded-lg border border-white/10 object-cover aspect-video"
                />
                <p className="text-[11px] text-slate-400">{thumbnailLabel}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isBuildingThumbnail}
                onClick={handleAutoThumbnail}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#181C2B] px-3 py-2 text-xs font-medium text-slate-200 hover:border-violet-500/40 hover:text-white min-h-[36px]"
              >
                {isBuildingThumbnail ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                )}
                <span>Auto-Generate Thumbnail</span>
              </button>

              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-[#181C2B] px-3 py-2 text-xs font-medium text-slate-200 hover:border-violet-500/40 hover:text-white min-h-[36px]">
                <ImageIcon className="h-3.5 w-3.5 text-slate-400" />
                <span>Upload JPG/PNG</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  className="sr-only"
                  onChange={(e) =>
                    handleCustomThumbnailUpload(e.target.files?.[0])
                  }
                />
              </label>
            </div>
          </div>

          {/* 3. Visibility Selector (Defaults to PRIVATE) */}
          <div className="rounded-lg border border-white/[0.06] bg-[#0B0D14] p-4 space-y-2.5">
            <label className="block text-xs font-semibold text-slate-300">
              3. Video Visibility (Default: Private)
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['private', 'unlisted', 'public'] as YouTubePrivacyStatus[]).map(
                (vis) => (
                  <button
                    key={vis}
                    type="button"
                    disabled={isUploading}
                    onClick={() => setPrivacyStatus(vis)}
                    className={`rounded-lg border px-2.5 py-2 text-xs font-medium capitalize transition-colors min-h-[38px] ${
                      privacyStatus === vis
                        ? vis === 'public'
                          ? 'border-amber-500 bg-amber-500/15 text-amber-200'
                          : 'border-violet-500 bg-violet-600/20 text-white'
                        : 'border-white/10 bg-[#131622] text-slate-400 hover:text-white'
                    }`}
                  >
                    {vis}
                  </button>
                )
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              {privacyStatus === 'private' &&
                'Private: Safe default. Only you can view until you publish in YouTube Studio.'}
              {privacyStatus === 'unlisted' &&
                'Unlisted: Anyone with the link can watch, hidden from search.'}
              {privacyStatus === 'public' &&
                'Public: Visible to everyone immediately (confirmation required).'}
            </p>
          </div>

          {/* Upload Action Button */}
          <button
            type="button"
            disabled={
              isUploading ||
              isAlreadyUploaded ||
              !ytChannel ||
              !exportedVideo?.blob
            }
            onClick={handleUploadClick}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-3 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px]"
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Uploading to YouTube ({uploadPercent}%)...</span>
              </>
            ) : isAlreadyUploaded ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                <span>Uploaded to YouTube</span>
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                <span>
                  {!ytChannel
                    ? 'Connect YouTube Channel to Upload'
                    : !exportedVideo?.blob
                    ? 'Render Video First to Upload'
                    : `Upload Video (${privacyStatus.toUpperCase()})`}
                </span>
              </>
            )}
          </button>

          {isAlreadyUploaded && (
            <p className="text-[11px] text-slate-400">
              Duplicate upload locked for this rendered video. Render a new video in Video Studio if you want to upload another version.
            </p>
          )}

          {/* Upload Progress Bar */}
          {isUploading && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-300 font-mono-tabular">
                <span>{uploadPhase}</span>
                <span>{uploadPercent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-violet-500 transition-all duration-200"
                  style={{ width: `${uploadPercent}%` }}
                />
              </div>
            </div>
          )}

          {uploadError && !localError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-rose-500/35 bg-rose-950/35 p-3 text-xs text-rose-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <span>{uploadError}</span>
            </div>
          )}

          {/* Real Uploaded Video Result */}
          {uploadResult && (
            <div className="rounded-lg border border-emerald-500/35 bg-emerald-950/25 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  Uploaded to YouTube ({uploadResult.privacyStatus.toUpperCase()})
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-[#0B0D14] px-3 py-2">
                <div className="min-w-0">
                  <span className="text-[11px] text-slate-400">Video ID: </span>
                  <span className="font-mono text-xs text-white">
                    {uploadResult.videoId}
                  </span>
                </div>
                <CopyButton text={uploadResult.videoId} label="Copy ID" compact />
              </div>

              <div className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-[#0B0D14] px-3 py-2">
                <a
                  href={uploadResult.youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 truncate text-xs font-medium text-violet-300 hover:underline"
                >
                  <span className="truncate">{uploadResult.youtubeUrl}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
                <CopyButton text={uploadResult.youtubeUrl} label="Copy URL" compact />
              </div>

              {uploadResult.thumbnailWarning && (
                <p className="text-[11px] text-amber-300 leading-relaxed">
                  {uploadResult.thumbnailWarning}
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
