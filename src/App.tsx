import { useEffect, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Clapperboard,
  FileText,
  Film,
  Layers,
  Menu,
  Mic,
  Plus,
  Sparkles,
  Trash2,
  Video,
  X,
  Youtube,
} from 'lucide-react';
import type {
  EpisodePack,
  GenerateEpisodeRequest,
  YouTubeChannelInfo,
} from './types/episode';
import { StoryGeneratorPanel } from './components/StoryGeneratorPanel';
import { EpisodeWorkspace, type WorkspaceTab } from './components/EpisodeWorkspace';
import { CopyButton, DownloadButton } from './components/CopyDownloadActions';
import { formatEpisodeAsText, slugifyTitle } from './utils/exportEpisode';
import {
  hydrateEpisodeSceneImages,
  stripLargeSceneImagesForStorage,
} from './utils/cartoonSceneRenderer';

const STORAGE_KEY = 'cartoon_spark_episodes_v1';

type StudioView = 'create' | 'workspace';

export default function App() {
  const [episodes, setEpisodes] = useState<EpisodePack[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.map((ep) => hydrateEpisodeSceneImages(ep as EpisodePack));
        }
      }
    } catch {
      // Ignore storage read errors
    }
    return [];
  });

  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(() => {
    return episodes[0]?.id ?? null;
  });
  const [view, setView] = useState<StudioView>(() =>
    episodes.length > 0 ? 'workspace' : 'create'
  );
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('story-script');
  const [formResetKey, setFormResetKey] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingStage, setLoadingStage] = useState<string>(
    'Writing original Urdu cartoon story...'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [ytSessionId, setYtSessionId] = useState<string | null>(null);
  const [ytChannel, setYtChannel] = useState<YouTubeChannelInfo | null>(null);

  const handleYouTubeAuthChange = (
    sessionId: string | null,
    channel: YouTubeChannelInfo | null
  ) => {
    setYtSessionId(sessionId);
    setYtChannel(channel);
  };

  useEffect(() => {
    let cancelled = false;
    fetch('/api/youtube/status', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.connected && data?.channel) {
          setYtSessionId(data.sessionId || 'cookie-session');
          setYtChannel(data.channel as YouTubeChannelInfo);
        }
      })
      .catch(() => {
        // Ignore initial background status error
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist compact episode blueprints in localStorage cleanly
  useEffect(() => {
    try {
      const compactList = episodes.map((ep) => stripLargeSceneImagesForStorage(ep));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(compactList));
    } catch {
      // Ignore storage quota errors
    }
  }, [episodes]);

  // Cycle progress labels during generation
  useEffect(() => {
    if (!isGenerating) return;
    const stages = [
      'Writing original Urdu cartoon story, title & moral...',
      'Converting story into 60-second YouTube Shorts script...',
      'Dividing episode into 8 consistent cartoon scenes...',
      'Rendering 9:16 cartoon scene illustrations & YouTube SEO...',
    ];
    let index = 0;
    setLoadingStage(stages[0]);
    const interval = setInterval(() => {
      index = Math.min(index + 1, stages.length - 1);
      setLoadingStage(stages[index]);
    }, 2200);
    return () => clearInterval(interval);
  }, [isGenerating]);

  const activeEpisode =
    episodes.find((ep) => ep.id === activeEpisodeId) ?? null;

  const openFreshStoryForm = () => {
    setErrorMessage(null);
    setFormResetKey((k) => k + 1);
    setView('create');
    setMobileNavOpen(false);
  };

  const handleGenerateEpisode = async (payload: GenerateEpisodeRequest) => {
    setErrorMessage(null);
    setIsGenerating(true);
    try {
      const response = await fetch('/api/generate-episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data.error ||
            `Server returned ${response.status}. Please try again.`
        );
      }
      const hydrated = hydrateEpisodeSceneImages(data.episode as EpisodePack);
      setEpisodes((prev) => [hydrated, ...prev]);
      setActiveEpisodeId(hydrated.id);
      setWorkspaceTab('scenes-prompts');
      setView('workspace');
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not generate episode. Please try again.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUpdateEpisode = (updated: EpisodePack) => {
    setEpisodes((prev) =>
      prev.map((ep) => (ep.id === updated.id ? updated : ep))
    );
  };

  const handleDeleteEpisode = (id: string) => {
    setEpisodes((prev) => {
      const remaining = prev.filter((ep) => ep.id !== id);
      if (activeEpisodeId === id) {
        const nextEp = remaining[0] ?? null;
        setActiveEpisodeId(nextEp?.id ?? null);
        if (!nextEp) {
          setView('create');
          setFormResetKey((k) => k + 1);
        }
      }
      return remaining;
    });
  };

  const handleSelectSavedEpisode = (ep: EpisodePack) => {
    const hydrated = hydrateEpisodeSceneImages(ep);
    setEpisodes((prev) =>
      prev.map((item) => (item.id === hydrated.id ? hydrated : item))
    );
    setActiveEpisodeId(hydrated.id);
    setView('workspace');
    setMobileNavOpen(false);
  };

  const navItems: Array<{
    id: WorkspaceTab;
    label: string;
    icon: typeof BookOpen;
  }> = [
    { id: 'story-script', label: 'Story & 60s Script', icon: BookOpen },
    { id: 'scenes-prompts', label: '8 Scenes & Images', icon: Clapperboard },
    { id: 'voiceover', label: 'Urdu Voiceover', icon: Mic },
    { id: 'video-studio', label: 'Video Studio & Export', icon: Video },
    { id: 'youtube-thumbnails', label: 'YouTube SEO & Upload', icon: Youtube },
    { id: 'editing-plan', label: 'Video Editing Plan', icon: Film },
    { id: 'full-pack', label: 'All-in-One Pack', icon: Layers },
  ];

  const renderSidebarContent = () => (
    <div className="flex h-full flex-col justify-between bg-[#131622] border-r border-white/[0.08]">
      <div className="space-y-6 p-5 overflow-y-auto">
        {/* Channel Brand Identity */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#0B0D14]">
            {!avatarError ? (
              <img
                src="/src/assets/images/cartoon_spark_avatar_1795689113524.jpg"
                alt="Cartoon Spark channel mascot"
                referrerPolicy="no-referrer"
                onError={() => setAvatarError(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-violet-600/20 text-violet-300">
                <Sparkles className="h-5 w-5" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white font-display">
              Cartoon Spark AI
            </div>
            <div className="truncate text-xs text-slate-400">
              Cartoon Spark · Urdu Stories
            </div>
          </div>
        </div>

        {/* Create New Episode Button */}
        <button
          type="button"
          onClick={openFreshStoryForm}
          className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
            view === 'create'
              ? 'bg-violet-600 text-white'
              : 'border border-violet-500/40 bg-violet-600/15 text-violet-200 hover:bg-violet-600/25'
          }`}
        >
          <Plus className="h-4 w-4" />
          <span>New Story</span>
        </button>

        {/* Active Episode Navigation */}
        {activeEpisode && (
          <div className="space-y-1.5">
            <div className="px-2 text-xs font-medium text-slate-400">
              Production Modules
            </div>
            <nav className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive =
                  view === 'workspace' && workspaceTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setView('workspace');
                      setWorkspaceTab(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                      isActive
                        ? 'bg-violet-600/20 text-white'
                        : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        isActive ? 'text-violet-400' : 'text-slate-500'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        )}

        {/* Saved Episodes History */}
        <div className="space-y-2 border-t border-white/[0.08] pt-5">
          <div className="flex items-center justify-between px-2 text-xs font-medium text-slate-400">
            <span>Saved Episodes</span>
            <span className="font-mono-tabular text-slate-500">
              {episodes.length}
            </span>
          </div>

          {episodes.length === 0 ? (
            <p className="px-2 text-xs text-slate-500 leading-relaxed">
              Completed episodes are saved automatically here for reopening and download.
            </p>
          ) : (
            <div className="space-y-1">
              {episodes.map((ep) => {
                const selected =
                  view === 'workspace' && activeEpisode?.id === ep.id;
                return (
                  <div
                    key={ep.id}
                    className={`group flex items-center justify-between gap-1 rounded-lg px-2.5 py-2 transition-colors ${
                      selected
                        ? 'bg-white/[0.07] text-white'
                        : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectSavedEpisode(ep)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                      <span className="truncate text-xs font-medium">
                        {ep.episodeTitleEnglish}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${ep.episodeTitleEnglish}`}
                      onClick={() => handleDeleteEpisode(ep.id)}
                      className="rounded p-1 text-slate-500 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer Note */}
      <div className="border-t border-white/[0.08] px-5 py-3.5 text-[11px] text-slate-400 truncate">
        {ytChannel
          ? `YouTube: ${ytChannel.title}`
          : 'YouTube OAuth · Cartoon Spark'}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#0B0D14] text-[#F1F3F9]">
      {/* Desktop Sidebar */}
      <aside className="hidden w-[264px] shrink-0 lg:block sticky top-0 h-screen">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative z-10 w-[272px] max-w-[85vw] h-full">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileNavOpen(false)}
              className="absolute right-3 top-3 rounded-lg p-2 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
            {renderSidebarContent()}
          </div>
        </div>
      )}

      {/* Main Content Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-6 border-b border-white/[0.08] bg-[#0B0D14]/95 px-4 py-3 backdrop-blur sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMobileNavOpen(true)}
              className="rounded-lg border border-white/10 p-2 text-slate-300 hover:text-white lg:hidden min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className="font-medium text-slate-400 whitespace-nowrap">
                Cartoon Spark
              </span>
              <span className="text-slate-600" aria-hidden="true">
                /
              </span>
              <span className="truncate font-semibold text-white">
                {view === 'create'
                  ? 'New Episode Studio'
                  : activeEpisode?.episodeTitleEnglish || 'Episode Workspace'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {view === 'workspace' && activeEpisode ? (
              <>
                <div className="hidden sm:flex items-center gap-2">
                  <CopyButton
                    text={formatEpisodeAsText(activeEpisode)}
                    label="Copy Pack"
                  />
                  <DownloadButton
                    filename={`${slugifyTitle(
                      activeEpisode.episodeTitleEnglish
                    )}-pack.txt`}
                    content={formatEpisodeAsText(activeEpisode)}
                    label="Download .txt"
                  />
                </div>
                <button
                  type="button"
                  onClick={openFreshStoryForm}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500 whitespace-nowrap shrink-0 min-h-[40px]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>New Story</span>
                </button>
              </>
            ) : (
              activeEpisode && (
                <button
                  type="button"
                  onClick={() => setView('workspace')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#131622] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-violet-500/40 hover:text-white whitespace-nowrap shrink-0 min-h-[40px]"
                >
                  <span>Back to Episode</span>
                </button>
              )
            )}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">
          {/* Error Banner */}
          {errorMessage && (
            <div
              role="alert"
              className="mx-auto mb-6 flex max-w-6xl items-start justify-between gap-4 rounded-xl border border-rose-500/35 bg-rose-950/35 px-4 py-3.5 text-sm text-rose-200"
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                <div>
                  <div className="font-medium text-rose-100">Action Failed</div>
                  <p className="mt-0.5 text-xs text-rose-200/90">
                    {errorMessage}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={() => setErrorMessage(null)}
                className="rounded p-1 text-rose-300 hover:bg-rose-500/20 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Generation Loading Progress Overlay Banner */}
          {isGenerating && (
            <div className="mx-auto mb-6 max-w-6xl rounded-xl border border-violet-500/35 bg-violet-950/25 p-5">
              <div className="flex items-center gap-4">
                <div className="h-8 w-8 shrink-0 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-400" />
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-white">
                    Cartoon Spark AI is producing your episode
                  </div>
                  <p className="text-xs text-violet-200/90">{loadingStage}</p>
                </div>
              </div>
            </div>
          )}

          {view === 'create' || !activeEpisode ? (
            <StoryGeneratorPanel
              resetKey={formResetKey}
              isGenerating={isGenerating}
              onGenerate={handleGenerateEpisode}
            />
          ) : (
            <EpisodeWorkspace
              episode={activeEpisode}
              activeTab={workspaceTab}
              ytSessionId={ytSessionId}
              ytChannel={ytChannel}
              onYouTubeAuthChange={handleYouTubeAuthChange}
              onTabChange={setWorkspaceTab}
              onUpdateEpisode={handleUpdateEpisode}
              onError={(msg) => setErrorMessage(msg)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
