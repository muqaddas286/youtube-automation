import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Film, Loader2, Play, Wand2 } from 'lucide-react';
import type {
  ArtStyle,
  GenerateEpisodeRequest,
  StoryTone,
  TargetAudience,
} from '../types/episode';

interface StoryGeneratorPanelProps {
  resetKey: number;
  isGenerating: boolean;
  onGenerate: (payload: GenerateEpisodeRequest) => Promise<void>;
}

const STARTER_IDEAS: Array<{
  title: string;
  topic: string;
  moral: string;
  tone: StoryTone;
}> = [
  {
    title: 'Clever Sparrow & Greedy Crow',
    topic:
      'A tiny clever sparrow named Chinky protects her cozy nest in an old neem tree from a greedy crow who tries to steal shiny mangoes.',
    moral: 'Kindness and clever thinking always defeat greed.',
    tone: 'Moral & Heartwarming',
  },
  {
    title: 'Boy & Glowing Purple Lantern',
    topic:
      'A curious boy named Bilal finds a glowing purple lantern in his courtyard and meets a wise talking hoopoe bird who teaches him honesty.',
    moral: 'Telling the truth brings real magic into your life.',
    tone: 'Magical Adventure',
  },
  {
    title: 'Lazy Donkey & Salt Bags',
    topic:
      'A cheeky donkey realizes slipping in the river melts his heavy salt bags, until his smart owner switches the load to fluffy cotton.',
    moral: 'Shortcuts and laziness always backfire.',
    tone: 'Funny & Playful',
  },
  {
    title: 'Sharing the Last Mango',
    topic:
      'Two squabbling siblings, Zara and Hamza, fight over the last ripe mango on a hot summer afternoon until an old street cat teaches them to share.',
    moral: 'Happiness doubles when we share with others.',
    tone: 'Clever Folk Tale',
  },
];

const TONES: StoryTone[] = [
  'Moral & Heartwarming',
  'Funny & Playful',
  'Magical Adventure',
  'Clever Folk Tale',
];

const ART_STYLES: ArtStyle[] = [
  '2D Pixar-Inspired Storybook',
  'Classic Hand-Drawn Desi Animation',
  'Vibrant 3D Clay Cartoon',
  'Soft Watercolor Kids Book',
];

const AUDIENCES: TargetAudience[] = ['Kids (4-8 Years)', 'Family & All Ages'];

export function StoryGeneratorPanel({
  resetKey,
  isGenerating,
  onGenerate,
}: StoryGeneratorPanelProps) {
  const topicInputRef = useRef<HTMLTextAreaElement | null>(null);

  const [topic, setTopic] = useState('');
  const [moral, setMoral] = useState('');
  const [tone, setTone] = useState<StoryTone>('Moral & Heartwarming');
  const [artStyle, setArtStyle] = useState<ArtStyle>('2D Pixar-Inspired Storybook');
  const [audience, setAudience] = useState<TargetAudience>('Kids (4-8 Years)');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sampleImageError, setSampleImageError] = useState(false);

  // Reset entire form cleanly whenever New Story is triggered
  useEffect(() => {
    setTopic('');
    setMoral('');
    setTone('Moral & Heartwarming');
    setArtStyle('2D Pixar-Inspired Storybook');
    setAudience('Kids (4-8 Years)');
    setShowAdvanced(false);
    if (resetKey > 0) {
      setTimeout(() => topicInputRef.current?.focus(), 40);
    }
  }, [resetKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || isGenerating) return;
    await onGenerate({
      topic: topic.trim(),
      moral: moral.trim() || undefined,
      tone,
      artStyle,
      audience,
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-stretch">
        {/* Left: Topic-First Automatic Episode Builder */}
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-7 flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#131622] p-6 sm:p-8"
        >
          <div className="space-y-6">
            <div>
              <p className="text-xs font-medium text-violet-400">
                Channel Studio · Cartoon Spark
              </p>
              <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white text-balance">
                Create a New Urdu Cartoon Short
              </h1>
              <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
                Enter any story topic below. Cartoon Spark AI automatically creates the
                original Urdu story, catchy title, moral lesson, 60-second narration
                script, 8 vertical cartoon scene images, YouTube SEO, and playable video.
              </p>
            </div>

            {/* Topic Input (Only Required Field) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="story-topic"
                  className="block text-xs font-medium text-slate-200"
                >
                  Story Topic (English or Urdu)
                </label>
                {topic && !isGenerating && (
                  <button
                    type="button"
                    onClick={() => {
                      setTopic('');
                      setMoral('');
                      topicInputRef.current?.focus();
                    }}
                    className="text-xs text-slate-400 hover:text-white transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              <textarea
                ref={topicInputRef}
                id="story-topic"
                rows={4}
                value={topic}
                disabled={isGenerating}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Type any topic, e.g.: An honest little woodcutter drops his axe into a magical river..."
                className="w-full rounded-lg border border-white/10 bg-[#0B0D14] px-4 py-3 text-sm text-white placeholder-slate-500 transition-colors focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                required
              />
            </div>

            {/* Quick Starter Presets */}
            <div className="space-y-2.5">
              <span className="block text-xs font-medium text-slate-400">
                Or click a starter topic to fill automatically:
              </span>
              <div className="flex flex-wrap gap-2">
                {STARTER_IDEAS.map((idea) => {
                  const isSelected = topic.trim() === idea.topic.trim();
                  return (
                    <button
                      key={idea.title}
                      type="button"
                      disabled={isGenerating}
                      onClick={() => {
                        setTopic(idea.topic);
                        setMoral(idea.moral);
                        setTone(idea.tone);
                      }}
                      className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                        isSelected
                          ? 'border-violet-500 bg-violet-600/20 text-violet-200'
                          : 'border-white/10 bg-[#181C2B] text-slate-300 hover:border-white/20 hover:text-white'
                      }`}
                    >
                      {idea.title}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Optional Customizations Toggle */}
            <div className="border-t border-white/[0.08] pt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors"
              >
                {showAdvanced ? (
                  <ChevronUp className="h-4 w-4 text-violet-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-violet-400" />
                )}
                <span>
                  Optional Style & Moral Settings ({tone} · {artStyle})
                </span>
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <label
                      htmlFor="story-moral"
                      className="block text-xs font-medium text-slate-300"
                    >
                      Custom Moral Lesson (Leave empty for AI auto-moral)
                    </label>
                    <input
                      id="story-moral"
                      type="text"
                      value={moral}
                      disabled={isGenerating}
                      onChange={(e) => setMoral(e.target.value)}
                      placeholder="Leave blank to auto-generate moral lesson"
                      className="w-full min-h-[42px] rounded-lg border border-white/10 bg-[#0B0D14] px-4 py-2.5 text-sm text-white placeholder-slate-500 transition-colors focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label
                        htmlFor="story-tone"
                        className="block text-xs font-medium text-slate-300"
                      >
                        Story Tone
                      </label>
                      <select
                        id="story-tone"
                        value={tone}
                        disabled={isGenerating}
                        onChange={(e) => setTone(e.target.value as StoryTone)}
                        className="w-full min-h-[42px] rounded-lg border border-white/10 bg-[#0B0D14] px-3.5 py-2.5 text-sm text-white focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                      >
                        {TONES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label
                        htmlFor="art-style"
                        className="block text-xs font-medium text-slate-300"
                      >
                        Cartoon Art Style
                      </label>
                      <select
                        id="art-style"
                        value={artStyle}
                        disabled={isGenerating}
                        onChange={(e) => setArtStyle(e.target.value as ArtStyle)}
                        className="w-full min-h-[42px] rounded-lg border border-white/10 bg-[#0B0D14] px-3.5 py-2.5 text-sm text-white focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                      >
                        {ART_STYLES.map((style) => (
                          <option key={style} value={style}>
                            {style}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span className="block text-xs font-medium text-slate-300">
                      Target Audience
                    </span>
                    <div className="inline-flex rounded-lg border border-white/10 bg-[#0B0D14] p-1">
                      {AUDIENCES.map((aud) => (
                        <button
                          key={aud}
                          type="button"
                          disabled={isGenerating}
                          onClick={() => setAudience(aud)}
                          className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                            audience === aud
                              ? 'bg-violet-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {aud}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Primary Submit CTA */}
          <div className="mt-8 border-t border-white/[0.08] pt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <p className="text-xs text-slate-400">
              Auto-creates story, title, moral, 8 cartoon scenes, voiceover & 9:16 video
            </p>
            <button
              type="submit"
              disabled={isGenerating || !topic.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 whitespace-nowrap shrink-0 min-h-[44px]"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Generating Complete Episode...</span>
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" />
                  <span>Generate Complete Episode</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Right: Visual Frame Preview & Channel Workflow */}
        <div className="lg:col-span-5 flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#131622] p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>9:16 Vertical Shorts Preview</span>
              <span className="font-mono-tabular">8 Scenes · 60s</span>
            </div>

            <div className="relative mx-auto aspect-[9/16] max-h-[360px] w-full max-w-[220px] overflow-hidden rounded-xl border border-white/10 bg-[#0B0D14]">
              {!sampleImageError ? (
                <img
                  src="/src/assets/images/cartoon_spark_sample_1795689113845.jpg"
                  alt="Cartoon Spark vertical Urdu storybook illustration preview"
                  referrerPolicy="no-referrer"
                  onError={() => setSampleImageError(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-violet-950/60 to-[#0B0D14] p-4 text-center">
                  <Film className="h-8 w-8 text-violet-400" />
                  <p className="mt-2 text-xs font-medium text-slate-200">
                    9:16 Cartoon Storyboard Frame
                  </p>
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-3.5">
                <p className="font-urdu-compact text-right text-sm text-white">
                  چمکتی لالٹین کا راز
                </p>
                <p className="mt-1 text-[11px] text-slate-300">
                  Cartoon Spark · Urdu Shorts
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 border-t border-white/[0.08] pt-5 space-y-3">
            <h2 className="text-xs font-semibold text-slate-200">
              Automated End-to-End Pipeline
            </h2>
            <ol className="space-y-2 text-xs text-slate-400">
              <li className="flex items-start gap-2.5">
                <span className="font-mono-tabular text-violet-400">01.</span>
                <span>Original Urdu story, title, moral, 60s script & YouTube SEO.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="font-mono-tabular text-violet-400">02.</span>
                <span>8 consistent 9:16 cartoon scene illustrations + AI image prompts.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="font-mono-tabular text-violet-400">03.</span>
                <span>Urdu TTS narration, subtitles, music & downloadable WebM video.</span>
              </li>
            </ol>
            <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-500">
              <Play className="h-3 w-3 text-violet-400 shrink-0" />
              <span>Export ready-to-upload WebM video & metadata locally.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
