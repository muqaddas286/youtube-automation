import type { EpisodePack } from '../types/episode';

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = 'text/plain;charset=utf-8'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBase64Wav(filename: string, base64Data: string): void {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'cartoon-spark-episode'
  );
}

export function formatAllPromptsText(episode: EpisodePack): string {
  const chars = episode.characterSheet
    .map((c) => `- ${c.name} (${c.role}): ${c.visualDescription}`)
    .join('\n');

  const scenePrompts = episode.scenes
    .map(
      (s) =>
        `Scene ${s.sceneNumber} (${s.timeRange}) [${s.cameraMovement}]\nPrompt: ${s.imagePrompt}`
    )
    .join('\n\n');

  return `CARTOON SPARK — IMAGE PROMPTS (${episode.episodeTitleEnglish})\nArt Style: ${episode.artStyle}\n\nCHARACTER REFERENCE:\n${chars}\n\n8 SCENE PROMPTS (9:16 VERTICAL):\n${scenePrompts}\n`;
}

export function formatEpisodeAsText(episode: EpisodePack): string {
  const lines: string[] = [
    `CARTOON SPARK AI — COMPLETE YOUTUBE SHORTS PRODUCTION PACK`,
    `==========================================================`,
    `Channel: Cartoon Spark (Urdu Cartoon Stories)`,
    `Episode Title (EN): ${episode.episodeTitleEnglish}`,
    `Episode Title (UR): ${episode.episodeTitleUrdu}`,
    `Tone: ${episode.tone} | Art Style: ${episode.artStyle} | Audience: ${episode.audience}`,
    `Moral (UR): ${episode.moralLessonUrdu}`,
    `Moral (EN): ${episode.moralLessonEnglish}`,
    ``,
    `1. ORIGINAL URDU STORY`,
    `----------------------`,
    episode.urduStory,
    ``,
    `2. 60-SECOND YOUTUBE SHORTS SCRIPT`,
    `----------------------------------`,
    `Hook (First 3s): ${episode.shortsScript.hookLineUrdu}`,
    `Closing CTA: ${episode.shortsScript.closingCtaUrdu}`,
    `Pacing Notes: ${episode.shortsScript.pacingNotes}`,
    ``,
    episode.shortsScript.fullScriptUrdu,
    ``,
    `3. CONSISTENT CHARACTER SHEET`,
    `-----------------------------`,
    ...episode.characterSheet.map(
      (c) => `- ${c.name} (${c.role}): ${c.visualDescription}`
    ),
    ``,
    `4. 8-SCENE STORYBOARD & CARTOON IMAGE PROMPTS`,
    `---------------------------------------------`,
    ...episode.scenes.flatMap((s) => [
      `Scene ${s.sceneNumber} (${s.timeRange} · ${s.durationSeconds}s)`,
      `Visual Action: ${s.visualAction}`,
      `Camera: ${s.cameraMovement} | SFX: ${s.sfxCue}`,
      `Urdu Narration: ${s.urduNarration}`,
      `Roman Urdu Caption: ${s.romanUrduCaption}`,
      `Cartoon Image Prompt: ${s.imagePrompt}`,
      ``,
    ]),
    `5. URDU VOICEOVER NARRATION`,
    `---------------------------`,
    `Voice Style: ${episode.voiceoverPlan.recommendedVoiceStyle}`,
    `Target Speed: ${episode.voiceoverPlan.speakingRateWpm} WPM`,
    ``,
    `Script with Delivery Cues:`,
    episode.voiceoverPlan.urduVoiceoverWithCues,
    ``,
    `Clean TTS-Ready Narration:`,
    episode.voiceoverPlan.cleanUrduNarration,
    ``,
    `6. YOUTUBE TITLES, DESCRIPTION, TAGS & HASHTAGS`,
    `-----------------------------------------------`,
    `Suggested Titles:`,
    ...episode.youtubeMetadata.titles.map((t, idx) => `  ${idx + 1}. ${t}`),
    ``,
    `Story Summary:`,
    episode.youtubeMetadata.storySummary || episode.moralLessonEnglish,
    ``,
    `Description:`,
    episode.youtubeMetadata.description,
    ``,
    `YouTube Tags:`,
    (episode.youtubeMetadata.tags || episode.youtubeMetadata.keywords || []).join(', '),
    ``,
    `Keywords:`,
    (episode.youtubeMetadata.keywords || []).join(', '),
    ``,
    `Hashtags:`,
    episode.youtubeMetadata.hashtags.join(' '),
    ``,
    `Audience Setting: ${
      episode.youtubeMetadata.madeForKids
        ? 'Made for Kids (COPPA)'
        : 'Not Made for Kids (General Family)'
    }`,
    ``,
    `7. THUMBNAIL TEXT SUGGESTIONS`,
    `-----------------------------`,
    ...episode.thumbnailSuggestions.map(
      (th, idx) =>
        `  Option ${idx + 1} (${th.conceptName}):\n    Urdu Text: ${th.urduText}\n    Badge: ${th.englishBadge}\n    Visual: ${th.visualComposition}\n    Colors: ${th.colorDirection}`
    ),
    ``,
    `8. VIDEO EDITING PLAN`,
    `---------------------`,
    `Format: ${episode.editingPlan.aspectRatio} | ${episode.editingPlan.resolution} | ${episode.editingPlan.targetFps}`,
    `BGM Mood: ${episode.editingPlan.bgmMood}`,
    `Caption Style: ${episode.editingPlan.captionStyle}`,
    `Color Grading: ${episode.editingPlan.colorGrading}`,
    `Transitions: ${episode.editingPlan.transitionRules}`,
    ``,
    `Step-by-Step Timeline:`,
    ...episode.editingPlan.timelineSteps.map(
      (step) =>
        `  Step ${step.stepNumber} [${step.timeWindow}] ${step.phaseTitle}: ${step.instructions}`
    ),
  ];

  return lines.join('\n');
}
