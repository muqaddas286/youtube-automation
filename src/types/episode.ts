export type StoryTone =
  | 'Moral & Heartwarming'
  | 'Funny & Playful'
  | 'Magical Adventure'
  | 'Clever Folk Tale';

export type ArtStyle =
  | '2D Pixar-Inspired Storybook'
  | 'Classic Hand-Drawn Desi Animation'
  | 'Vibrant 3D Clay Cartoon'
  | 'Soft Watercolor Kids Book';

export type TargetAudience = 'Kids (4-8 Years)' | 'Family & All Ages';

export type VoiceActorName = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';

export type CharacterArchetype =
  | 'boy'
  | 'girl'
  | 'bird'
  | 'cat'
  | 'rabbit'
  | 'elder'
  | 'donkey';

export type SceneSetting =
  | 'courtyard'
  | 'forest'
  | 'village'
  | 'riverside'
  | 'home'
  | 'meadow';

export type TimeOfDay = 'morning' | 'afternoon' | 'sunset' | 'night';

export type CameraShot = 'wide' | 'medium' | 'closeup';

export type CharacterPose =
  | 'standing'
  | 'walking'
  | 'pointing'
  | 'surprised'
  | 'celebrating'
  | 'thinking';

export type CharacterExpression =
  | 'happy'
  | 'curious'
  | 'worried'
  | 'excited'
  | 'kind';

export type SceneProp =
  | 'lantern'
  | 'mango'
  | 'book'
  | 'nest'
  | 'pot'
  | 'coin_pouch'
  | 'none';

export type YouTubePrivacyStatus = 'private' | 'unlisted' | 'public';

export interface YouTubeChannelInfo {
  id: string;
  title: string;
  customUrl?: string;
  thumbnailUrl?: string;
  subscriberCount?: string;
}

export interface YouTubeConfigStatus {
  oauthConfigured: boolean;
  callbackUrl: string;
  missingVars: string[];
}

export interface YouTubeUploadResult {
  videoId: string;
  youtubeUrl: string;
  privacyStatus: YouTubePrivacyStatus;
  title: string;
  thumbnailUploaded: boolean;
  thumbnailWarning?: string | null;
}

export interface CharacterSheetItem {
  name: string;
  role: string;
  visualDescription: string;
  archetype: CharacterArchetype;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  accessory: string;
}

export interface SceneVisualBlueprint {
  setting: SceneSetting;
  timeOfDay: TimeOfDay;
  cameraShot: CameraShot;
  primaryCharacterPose: CharacterPose;
  primaryCharacterExpression: CharacterExpression;
  includeSecondaryCharacter: boolean;
  secondaryCharacterPose: CharacterPose;
  prop: SceneProp;
  moodColor: string;
}

export interface EpisodeScene {
  sceneNumber: number;
  timeRange: string;
  durationSeconds: number;
  visualAction: string;
  cameraMovement: string;
  urduNarration: string;
  romanUrduCaption: string;
  imagePrompt: string;
  sfxCue: string;
  visualBlueprint: SceneVisualBlueprint;
  imageDataUrl?: string;
}

export interface ThumbnailSuggestion {
  conceptName: string;
  urduText: string;
  englishBadge: string;
  visualComposition: string;
  colorDirection: string;
}

export interface EditingTimelineStep {
  stepNumber: number;
  phaseTitle: string;
  timeWindow: string;
  instructions: string;
}

export interface EpisodeYouTubeMetadata {
  titles: string[];
  storySummary: string;
  description: string;
  hashtags: string[];
  keywords: string[];
  tags: string[];
  madeForKids: boolean;
  audienceGuidance: string;
}

export interface EpisodePack {
  id: string;
  createdAt: string;
  topicPrompt: string;
  tone: StoryTone;
  artStyle: ArtStyle;
  audience: TargetAudience;
  episodeTitleEnglish: string;
  episodeTitleUrdu: string;
  moralLessonUrdu: string;
  moralLessonEnglish: string;
  characterSheet: CharacterSheetItem[];
  urduStory: string;
  shortsScript: {
    totalDurationSeconds: number;
    hookLineUrdu: string;
    closingCtaUrdu: string;
    pacingNotes: string;
    fullScriptUrdu: string;
  };
  scenes: EpisodeScene[];
  voiceoverPlan: {
    recommendedVoiceStyle: string;
    speakingRateWpm: number;
    urduVoiceoverWithCues: string;
    cleanUrduNarration: string;
  };
  youtubeMetadata: EpisodeYouTubeMetadata;
  thumbnailSuggestions: ThumbnailSuggestion[];
  editingPlan: {
    aspectRatio: string;
    resolution: string;
    targetFps: string;
    bgmMood: string;
    captionStyle: string;
    colorGrading: string;
    transitionRules: string;
    timelineSteps: EditingTimelineStep[];
  };
}

export interface GenerateEpisodeRequest {
  topic: string;
  moral?: string;
  tone: StoryTone;
  artStyle: ArtStyle;
  audience: TargetAudience;
}

export type RegenerateSectionType =
  | 'titles'
  | 'thumbnails'
  | 'imagePrompts'
  | 'editingPlan'
  | 'voiceover';
