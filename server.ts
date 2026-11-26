import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  EpisodePack,
  GenerateEpisodeRequest,
  RegenerateSectionType,
  VoiceActorName,
  YouTubeChannelInfo,
  YouTubePrivacyStatus,
} from './src/types/episode.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '4mb' }));

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB max video upload
  },
});

const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

interface YouTubeSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  channel: YouTubeChannelInfo;
}

const oauthStates = new Map<string, number>();
const youtubeSessions = new Map<string, YouTubeSession>();

function getAppBaseUrl(): string {
  const raw = (process.env.APP_URL || '').trim();
  if (raw && raw !== 'MY_APP_URL' && /^https?:\/\//i.test(raw)) {
    return raw.replace(/\/+$/, '');
  }
  const port = Number(process.env.PORT) || 3000;
  return `http://localhost:${port}`;
}

function getYouTubeCallbackUrl(): string {
  return `${getAppBaseUrl()}/api/youtube/auth/callback`;
}

function getOAuthCredentials(): {
  clientId: string;
  clientSecret: string;
  configured: boolean;
  missingVars: string[];
} {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const missingVars: string[] = [];
  if (!clientId) missingVars.push('GOOGLE_CLIENT_ID');
  if (!clientSecret) missingVars.push('GOOGLE_CLIENT_SECRET');
  return {
    clientId,
    clientSecret,
    configured: missingVars.length === 0,
    missingVars,
  };
}

function extractBearerSessionId(req: express.Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)cs_yt_session=([^;]+)/);
  if (match?.[1]) {
    return decodeURIComponent(match[1]);
  }
  return null;
}

function parseGoogleApiError(rawBody: string, fallbackStatus: number): string {
  try {
    const parsed = JSON.parse(rawBody) as {
      error?: { message?: string; errors?: Array<{ reason?: string; message?: string }> } | string;
      error_description?: string;
    };
    if (typeof parsed.error === 'object' && parsed.error !== null) {
      const reason = parsed.error.errors?.[0]?.reason;
      const msg = parsed.error.message || parsed.error.errors?.[0]?.message;
      if (reason === 'youtubeSignupRequired') {
        return 'This Google account does not have a YouTube channel yet. Please create a channel on YouTube first.';
      }
      if (reason === 'accessNotConfigured') {
        return 'YouTube Data API v3 is not enabled in your Google Cloud project. Enable YouTube Data API v3 in Google Cloud Console and retry.';
      }
      if (reason === 'quotaExceeded') {
        return 'YouTube Data API v3 daily upload quota has been reached for this Google Cloud project.';
      }
      if (msg) return msg;
    }
    if (typeof parsed.error === 'string') {
      return parsed.error_description || parsed.error;
    }
  } catch {
    // Non-JSON error body
  }
  return `YouTube API request failed with status ${fallbackStatus}.`;
}

async function refreshYouTubeAccessToken(
  sessionId: string,
  session: YouTubeSession
): Promise<YouTubeSession> {
  if (Date.now() < session.expiresAt - 60_000) {
    return session;
  }
  if (!session.refreshToken) {
    youtubeSessions.delete(sessionId);
    throw new Error('Your YouTube authorization expired. Please reconnect your YouTube channel.');
  }
  const { clientId, clientSecret, configured } = getOAuthCredentials();
  if (!configured) {
    throw new Error('Google OAuth client credentials are not configured on the server.');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: session.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const tokenText = await tokenRes.text();
  if (!tokenRes.ok) {
    youtubeSessions.delete(sessionId);
    throw new Error(parseGoogleApiError(tokenText, tokenRes.status));
  }

  const refreshed = JSON.parse(tokenText) as {
    access_token: string;
    expires_in?: number;
  };
  const updated: YouTubeSession = {
    ...session,
    accessToken: refreshed.access_token,
    expiresAt: Date.now() + (refreshed.expires_in || 3600) * 1000,
  };
  youtubeSessions.set(sessionId, updated);
  return updated;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please add your Gemini API key in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getErrorStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null) {
    const record = err as Record<string, unknown>;
    if (typeof record.status === 'number') return record.status;
    if (typeof record.code === 'number') return record.code;
  }
  return undefined;
}

function isRetryableError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status === 503 || status === 502 || status === 504 || status === 500 || status === 429) {
    return true;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('resource_exhausted') ||
    msg.includes('429') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('etimedout') ||
    msg.includes('econnreset') ||
    msg.includes('fetch failed')
  );
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const status = getErrorStatus(err);
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (raw.includes('GEMINI_API_KEY is not configured')) {
    return { status: 400, message: raw };
  }
  if (
    status === 403 ||
    lower.includes('api_key_invalid') ||
    lower.includes('permission_denied') ||
    lower.includes('403')
  ) {
    return {
      status: 403,
      message:
        'Gemini API access was denied or the API key is invalid. Please verify your key in Settings > Secrets.',
    };
  }
  if (
    status === 503 ||
    lower.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('overloaded')
  ) {
    return {
      status: 503,
      message:
        'Gemini AI servers are temporarily overloaded (503 Service Unavailable). Automatic retries were attempted—please wait a few seconds and try again.',
    };
  }
  if (status === 429 || lower.includes('resource_exhausted') || lower.includes('429')) {
    return {
      status: 429,
      message:
        'Gemini API rate limit reached (429). Please wait 15–30 seconds and click Retry.',
    };
  }
  return {
    status: 500,
    message: raw || 'An unexpected error occurred while communicating with Gemini AI.',
  };
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt === maxAttempts) {
        throw err;
      }
      const baseDelay = 1000 * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * 350);
      await new Promise((r) => setTimeout(r, baseDelay + jitter));
    }
  }
  throw lastError;
}

async function generateTextWithFallback(
  ai: GoogleGenAI,
  params: {
    contents: string;
    config: Record<string, unknown>;
  }
) {
  try {
    return await withRetry(
      () =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: params.contents,
          config: params.config as never,
        }),
      3
    );
  } catch (err) {
    if (!isRetryableError(err)) {
      throw err;
    }
    return await withRetry(
      () =>
        ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: params.contents,
          config: params.config as never,
        }),
      2
    );
  }
}

const EPISODE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    episodeTitleEnglish: {
      type: Type.STRING,
      description: 'Short, catchy English title for studio reference.',
    },
    episodeTitleUrdu: {
      type: Type.STRING,
      description: 'Catchy, authentic Urdu title written in proper Urdu script.',
    },
    moralLessonUrdu: {
      type: Type.STRING,
      description: 'One-sentence moral of the story in proper Urdu script.',
    },
    moralLessonEnglish: {
      type: Type.STRING,
      description: 'Short English translation of the moral lesson.',
    },
    characterSheet: {
      type: Type.ARRAY,
      description: '2 consistent main characters with exact visual traits and hex colors.',
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          role: { type: Type.STRING },
          visualDescription: {
            type: Type.STRING,
            description: 'Consistent outfit, colors, age/species, and key features in English.',
          },
          archetype: {
            type: Type.STRING,
            description: 'Must be one of: boy, girl, bird, cat, rabbit, elder, donkey',
          },
          primaryColor: {
            type: Type.STRING,
            description: 'Hex color code e.g. #3B82F6 for main outfit/body.',
          },
          secondaryColor: {
            type: Type.STRING,
            description: 'Hex color code e.g. #F59E0B for trim/scarf/wings.',
          },
          accentColor: {
            type: Type.STRING,
            description: 'Hex color code e.g. #8B5CF6 for shoes/hat/eyes.',
          },
          accessory: {
            type: Type.STRING,
            description: 'Signature item e.g. glowing lantern, red scarf, straw hat.',
          },
        },
        required: [
          'name',
          'role',
          'visualDescription',
          'archetype',
          'primaryColor',
          'secondaryColor',
          'accentColor',
          'accessory',
        ],
      },
    },
    urduStory: {
      type: Type.STRING,
      description:
        'Complete original Urdu cartoon story in natural, engaging Urdu script (3-5 paragraphs separated by double newlines).',
    },
    shortsScript: {
      type: Type.OBJECT,
      properties: {
        totalDurationSeconds: { type: Type.INTEGER },
        hookLineUrdu: {
          type: Type.STRING,
          description: 'First 3-second attention-grabbing hook line in Urdu script.',
        },
        closingCtaUrdu: {
          type: Type.STRING,
          description: 'Closing moral + Cartoon Spark channel subscribe CTA in Urdu script.',
        },
        pacingNotes: {
          type: Type.STRING,
          description: 'Brief pacing advice for keeping the Shorts retention high.',
        },
        fullScriptUrdu: {
          type: Type.STRING,
          description:
            'Complete 60-second YouTube Shorts script formatted clearly with timestamps and Urdu narration.',
        },
      },
      required: [
        'totalDurationSeconds',
        'hookLineUrdu',
        'closingCtaUrdu',
        'pacingNotes',
        'fullScriptUrdu',
      ],
    },
    scenes: {
      type: Type.ARRAY,
      description: 'EXACTLY 8 sequential scenes totaling 60 seconds.',
      items: {
        type: Type.OBJECT,
        properties: {
          sceneNumber: { type: Type.INTEGER },
          timeRange: { type: Type.STRING, description: 'Format: 00:00 - 00:07' },
          durationSeconds: { type: Type.INTEGER },
          visualAction: {
            type: Type.STRING,
            description: 'Clear English description of what happens visually in this scene.',
          },
          cameraMovement: {
            type: Type.STRING,
            description: 'Simple camera/motion instruction e.g. Slow zoom in, Gentle pan right.',
          },
          urduNarration: {
            type: Type.STRING,
            description: 'Exact Urdu narration line spoken during this scene.',
          },
          romanUrduCaption: {
            type: Type.STRING,
            description: 'Roman Urdu transliteration of the narration for video captioning.',
          },
          imagePrompt: {
            type: Type.STRING,
            description:
              'Detailed AI cartoon image prompt in English maintaining consistent characters, vertical 9:16 framing, lighting, and requested art style. No text in image.',
          },
          sfxCue: {
            type: Type.STRING,
            description: 'Recommended sound effect cue e.g. Cheerful flute chime, Soft wind whoosh.',
          },
          visualBlueprint: {
            type: Type.OBJECT,
            description:
              'Structured visual layout tokens so the built-in cartoon illustrator renders this scene accurately.',
            properties: {
              setting: {
                type: Type.STRING,
                description: 'Must be one of: courtyard, forest, village, riverside, home, meadow',
              },
              timeOfDay: {
                type: Type.STRING,
                description: 'Must be one of: morning, afternoon, sunset, night',
              },
              cameraShot: {
                type: Type.STRING,
                description: 'Must be one of: wide, medium, closeup',
              },
              primaryCharacterPose: {
                type: Type.STRING,
                description:
                  'Must be one of: standing, walking, pointing, surprised, celebrating, thinking',
              },
              primaryCharacterExpression: {
                type: Type.STRING,
                description: 'Must be one of: happy, curious, worried, excited, kind',
              },
              includeSecondaryCharacter: { type: Type.BOOLEAN },
              secondaryCharacterPose: {
                type: Type.STRING,
                description:
                  'Must be one of: standing, walking, pointing, surprised, celebrating, thinking',
              },
              prop: {
                type: Type.STRING,
                description: 'Must be one of: lantern, mango, book, nest, pot, coin_pouch, none',
              },
              moodColor: {
                type: Type.STRING,
                description: 'Hex accent color matching the scene emotion e.g. #8B5CF6',
              },
            },
            required: [
              'setting',
              'timeOfDay',
              'cameraShot',
              'primaryCharacterPose',
              'primaryCharacterExpression',
              'includeSecondaryCharacter',
              'secondaryCharacterPose',
              'prop',
              'moodColor',
            ],
          },
        },
        required: [
          'sceneNumber',
          'timeRange',
          'durationSeconds',
          'visualAction',
          'cameraMovement',
          'urduNarration',
          'romanUrduCaption',
          'imagePrompt',
          'sfxCue',
          'visualBlueprint',
        ],
      },
    },
    voiceoverPlan: {
      type: Type.OBJECT,
      properties: {
        recommendedVoiceStyle: {
          type: Type.STRING,
          description: 'Tone & emotion guidance for the Urdu narrator.',
        },
        speakingRateWpm: { type: Type.INTEGER },
        urduVoiceoverWithCues: {
          type: Type.STRING,
          description:
            'Full Urdu voiceover script containing inline delivery cues like [نرم لہجہ] or [pause 0.5s].',
        },
        cleanUrduNarration: {
          type: Type.STRING,
          description:
            'Clean continuous Urdu narration text with zero brackets or stage cues, ready directly for text-to-speech.',
        },
      },
      required: [
        'recommendedVoiceStyle',
        'speakingRateWpm',
        'urduVoiceoverWithCues',
        'cleanUrduNarration',
      ],
    },
    youtubeMetadata: {
      type: Type.OBJECT,
      properties: {
        titles: {
          type: Type.ARRAY,
          description: '3 high-CTR, SEO-friendly YouTube Shorts titles (mix of Urdu & English/Roman Urdu).',
          items: { type: Type.STRING },
        },
        storySummary: {
          type: Type.STRING,
          description:
            'Concise 2-3 sentence summary of the actual Urdu story in English + Urdu for the video description.',
        },
        description: {
          type: Type.STRING,
          description:
            'Complete SEO-friendly YouTube description based on the actual Urdu story: engaging hook, short story summary, moral lesson in Urdu and English, Cartoon Spark subscribe CTA, and relevant hashtags.',
        },
        hashtags: {
          type: Type.ARRAY,
          description: '10 relevant hashtags starting with #.',
          items: { type: Type.STRING },
        },
        keywords: {
          type: Type.ARRAY,
          description: '10 YouTube SEO search keywords (Urdu & English phrases).',
          items: { type: Type.STRING },
        },
        tags: {
          type: Type.ARRAY,
          description:
            '12 searchable YouTube video tags (plain phrases without #, under 400 chars total) for YouTube Data API snippet.tags.',
          items: { type: Type.STRING },
        },
        madeForKids: {
          type: Type.BOOLEAN,
          description:
            'True when targeted primarily at young children (COPPA Made for Kids), false for general family audience.',
        },
        audienceGuidance: {
          type: Type.STRING,
          description:
            'Brief explanation of why this Made for Kids / General Audience setting is recommended.',
        },
      },
      required: [
        'titles',
        'storySummary',
        'description',
        'hashtags',
        'keywords',
        'tags',
        'madeForKids',
        'audienceGuidance',
      ],
    },
    thumbnailSuggestions: {
      type: Type.ARRAY,
      description: '3 punchy thumbnail text and visual suggestions.',
      items: {
        type: Type.OBJECT,
        properties: {
          conceptName: { type: Type.STRING },
          urduText: {
            type: Type.STRING,
            description: 'Short 2 to 4 word high-impact Urdu thumbnail overlay text.',
          },
          englishBadge: {
            type: Type.STRING,
            description: 'Short 2 to 3 word optional English/Roman Urdu kicker.',
          },
          visualComposition: { type: Type.STRING },
          colorDirection: { type: Type.STRING },
        },
        required: [
          'conceptName',
          'urduText',
          'englishBadge',
          'visualComposition',
          'colorDirection',
        ],
      },
    },
    editingPlan: {
      type: Type.OBJECT,
      properties: {
        aspectRatio: { type: Type.STRING },
        resolution: { type: Type.STRING },
        targetFps: { type: Type.STRING },
        bgmMood: { type: Type.STRING },
        captionStyle: { type: Type.STRING },
        colorGrading: { type: Type.STRING },
        transitionRules: { type: Type.STRING },
        timelineSteps: {
          type: Type.ARRAY,
          description: '5 beginner-friendly step-by-step editing instructions.',
          items: {
            type: Type.OBJECT,
            properties: {
              stepNumber: { type: Type.INTEGER },
              phaseTitle: { type: Type.STRING },
              timeWindow: { type: Type.STRING },
              instructions: { type: Type.STRING },
            },
            required: ['stepNumber', 'phaseTitle', 'timeWindow', 'instructions'],
          },
        },
      },
      required: [
        'aspectRatio',
        'resolution',
        'targetFps',
        'bgmMood',
        'captionStyle',
        'colorGrading',
        'transitionRules',
        'timelineSteps',
      ],
    },
  },
  required: [
    'episodeTitleEnglish',
    'episodeTitleUrdu',
    'moralLessonUrdu',
    'moralLessonEnglish',
    'characterSheet',
    'urduStory',
    'shortsScript',
    'scenes',
    'voiceoverPlan',
    'youtubeMetadata',
    'thumbnailSuggestions',
    'editingPlan',
  ],
};

// --- YouTube OAuth 2.0 & Data API v3 Routes ---

app.get('/api/youtube/status', async (req, res) => {
  const { configured, missingVars } = getOAuthCredentials();
  const callbackUrl = getYouTubeCallbackUrl();
  const sessionId = extractBearerSessionId(req);

  let connected = false;
  let channel: YouTubeChannelInfo | null = null;
  let activeSessionId: string | null = null;

  if (sessionId && youtubeSessions.has(sessionId)) {
    const session = youtubeSessions.get(sessionId)!;
    try {
      const valid = await refreshYouTubeAccessToken(sessionId, session);
      connected = true;
      channel = valid.channel;
      activeSessionId = sessionId;
    } catch {
      connected = false;
      channel = null;
      activeSessionId = null;
    }
  }

  res.json({
    oauthConfigured: configured,
    callbackUrl,
    missingVars,
    connected,
    sessionId: activeSessionId,
    channel,
  });
});

app.get('/api/youtube/auth/url', (req, res) => {
  const { clientId, configured, missingVars } = getOAuthCredentials();
  const callbackUrl = getYouTubeCallbackUrl();

  if (!configured) {
    res.status(400).json({
      error: `Google OAuth 2.0 is not configured yet. Missing server environment variables: ${missingVars.join(
        ', '
      )}. Add your Google Cloud OAuth Client ID and Secret in Settings > Secrets and authorize callback URI: ${callbackUrl}`,
      callbackUrl,
      missingVars,
    });
    return;
  }

  // Prune stale CSRF states older than 10 minutes
  const now = Date.now();
  for (const [key, created] of oauthStates.entries()) {
    if (now - created > 10 * 60 * 1000) {
      oauthStates.delete(key);
    }
  }

  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, now);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: YOUTUBE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });

  res.json({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    callbackUrl,
  });
});

function renderOAuthCallbackPage(payload: Record<string, unknown>, message: string): string {
  const serialized = JSON.stringify(payload).replace(/</g, '\\u003c');
  const escapedMsg = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Cartoon Spark — YouTube Authorization</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #0B0D14; color: #F1F3F9; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; text-align: center; }
      .box { max-width: 420px; padding: 24px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); background: #131622; }
      p { color: #CBD5E1; font-size: 14px; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="box">
      <p>${escapedMsg}</p>
    </div>
    <script>
      (function () {
        var payload = ${serialized};
        if (window.opener) {
          window.opener.postMessage(payload, '*');
          setTimeout(function () { window.close(); }, 350);
        } else {
          window.location.href = '/';
        }
      })();
    </script>
  </body>
</html>`;
}

app.get(['/api/youtube/auth/callback', '/api/youtube/auth/callback/'], async (req, res) => {
  try {
    const errorParam = typeof req.query.error === 'string' ? req.query.error : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';

    if (errorParam) {
      const msg =
        errorParam === 'access_denied'
          ? 'Google authorization was cancelled. No YouTube permissions were granted.'
          : `Google OAuth returned an error: ${errorParam}`;
      res
        .status(400)
        .send(renderOAuthCallbackPage({ type: 'YOUTUBE_OAUTH_ERROR', error: msg }, msg));
      return;
    }

    if (!code || !state || !oauthStates.has(state)) {
      const msg = 'Invalid or expired OAuth state. Please click Connect YouTube Channel again.';
      res
        .status(400)
        .send(renderOAuthCallbackPage({ type: 'YOUTUBE_OAUTH_ERROR', error: msg }, msg));
      return;
    }
    oauthStates.delete(state);

    const { clientId, clientSecret, configured } = getOAuthCredentials();
    if (!configured) {
      const msg = 'Google OAuth credentials are missing on the server.';
      res
        .status(500)
        .send(renderOAuthCallbackPage({ type: 'YOUTUBE_OAUTH_ERROR', error: msg }, msg));
      return;
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getYouTubeCallbackUrl(),
        grant_type: 'authorization_code',
      }),
    });

    const tokenText = await tokenRes.text();
    if (!tokenRes.ok) {
      const msg = parseGoogleApiError(tokenText, tokenRes.status);
      res
        .status(400)
        .send(renderOAuthCallbackPage({ type: 'YOUTUBE_OAUTH_ERROR', error: msg }, msg));
      return;
    }

    const tokenJson = JSON.parse(tokenText) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    // Fetch authenticated user's YouTube channel
    const channelRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
      {
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
        },
      }
    );
    const channelText = await channelRes.text();
    if (!channelRes.ok) {
      const msg = parseGoogleApiError(channelText, channelRes.status);
      res
        .status(400)
        .send(renderOAuthCallbackPage({ type: 'YOUTUBE_OAUTH_ERROR', error: msg }, msg));
      return;
    }

    const channelData = JSON.parse(channelText) as {
      items?: Array<{
        id: string;
        snippet?: {
          title?: string;
          customUrl?: string;
          thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
        };
        statistics?: { subscriberCount?: string };
      }>;
    };

    const firstChannel = channelData.items?.[0];
    if (!firstChannel) {
      const msg =
        'No YouTube channel was found on this Google account. Please create a YouTube channel or sign in with a Google account that owns one.';
      res
        .status(400)
        .send(renderOAuthCallbackPage({ type: 'YOUTUBE_OAUTH_ERROR', error: msg }, msg));
      return;
    }

    const channelInfo: YouTubeChannelInfo = {
      id: firstChannel.id,
      title: firstChannel.snippet?.title || 'Connected YouTube Channel',
      customUrl: firstChannel.snippet?.customUrl,
      thumbnailUrl:
        firstChannel.snippet?.thumbnails?.medium?.url ||
        firstChannel.snippet?.thumbnails?.default?.url,
      subscriberCount: firstChannel.statistics?.subscriberCount,
    };

    const sessionId = crypto.randomBytes(32).toString('hex');
    youtubeSessions.set(sessionId, {
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token,
      expiresAt: Date.now() + (tokenJson.expires_in || 3600) * 1000,
      channel: channelInfo,
    });

    res.cookie('cs_yt_session', sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      partitioned: true,
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.send(
      renderOAuthCallbackPage(
        {
          type: 'YOUTUBE_OAUTH_SUCCESS',
          sessionId,
          channel: channelInfo,
        },
        `Connected to ${channelInfo.title}. Returning to Cartoon Spark AI...`
      )
    );
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : 'Unexpected error while completing YouTube authorization.';
    res
      .status(500)
      .send(renderOAuthCallbackPage({ type: 'YOUTUBE_OAUTH_ERROR', error: msg }, msg));
  }
});

app.post('/api/youtube/disconnect', (req, res) => {
  const sessionId = extractBearerSessionId(req);
  if (sessionId) {
    youtubeSessions.delete(sessionId);
  }
  res.clearCookie('cs_yt_session', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
  });
  res.json({ ok: true });
});

const handleUploadFields = uploadMiddleware.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]);

app.post('/api/youtube/upload', (req, res, next) => {
  handleUploadFields(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        const msg =
          err.code === 'LIMIT_FILE_SIZE'
            ? 'Video file exceeds the 100 MB server upload limit.'
            : `Upload parsing error: ${err.message}`;
        res.status(400).json({ error: msg });
        return;
      }
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid upload payload.',
      });
      return;
    }
    next();
  });
}, async (req, res) => {
  try {
    const sessionId = extractBearerSessionId(req);
    if (!sessionId || !youtubeSessions.has(sessionId)) {
      res.status(401).json({
        error: 'YouTube channel is not connected. Click Connect YouTube Channel first.',
      });
      return;
    }

    let session = await refreshYouTubeAccessToken(
      sessionId,
      youtubeSessions.get(sessionId)!
    );

    const files = req.files as
      | Record<string, Express.Multer.File[]>
      | undefined;
    const videoFile = files?.video?.[0];
    const thumbnailFile = files?.thumbnail?.[0];

    if (!videoFile || !Buffer.isBuffer(videoFile.buffer) || videoFile.buffer.length < 16) {
      res.status(400).json({
        error: 'No valid WebM video file was received. Render your 9:16 WebM video before uploading.',
      });
      return;
    }

    // Verify WebM / Matroska EBML binary header (0x1A 0x45 0xDF 0xA3) so text/JSON/empty payloads are rejected
    const buf = videoFile.buffer;
    const isEbmlWebm =
      buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
    if (!isEbmlWebm) {
      res.status(400).json({
        error:
          'Invalid video file format. Uploaded data is not a valid WebM binary stream (video/webm expected).',
      });
      return;
    }

    const cleanVideoMime = 'video/webm';

    const rawTitle = String(req.body.title || '').trim();
    if (!rawTitle) {
      res.status(400).json({ error: 'A YouTube video title is required.' });
      return;
    }
    const title = rawTitle.slice(0, 100);
    const description = String(req.body.description || '').trim().slice(0, 5000);

    let tags: string[] = [];
    try {
      const parsedTags = JSON.parse(String(req.body.tags || '[]'));
      if (Array.isArray(parsedTags)) {
        tags = parsedTags
          .map((t) => String(t).replace(/^[#<>]+|[<>]+/g, '').trim())
          .filter(Boolean)
          .slice(0, 30);
      }
    } catch {
      tags = String(req.body.tags || '')
        .split(',')
        .map((t) => t.replace(/^[#<>]+|[<>]+/g, '').trim())
        .filter(Boolean)
        .slice(0, 30);
    }

    // Enforce YouTube's 500-character aggregate tag limit
    const cleanTags: string[] = [];
    let totalTagLen = 0;
    for (const tag of tags) {
      if (totalTagLen + tag.length + 1 <= 480) {
        cleanTags.push(tag);
        totalTagLen += tag.length + 1;
      }
    }

    const rawPrivacy = String(req.body.privacyStatus || 'private').toLowerCase();
    const privacyStatus: YouTubePrivacyStatus =
      rawPrivacy === 'public' || rawPrivacy === 'unlisted' ? rawPrivacy : 'private';

    if (privacyStatus === 'public' && req.body.publicConfirmed !== 'true') {
      res.status(400).json({
        error:
          'Explicit confirmation is required before publishing a video as Public on YouTube.',
      });
      return;
    }

    const madeForKids = String(req.body.madeForKids) === 'true';

    const initiateResumableUpload = async (accessToken: string) =>
      fetch(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Length': String(buf.length),
            'X-Upload-Content-Type': cleanVideoMime,
          },
          body: JSON.stringify({
            snippet: {
              title,
              description,
              tags: cleanTags,
              categoryId: '1', // Film & Animation
              defaultLanguage: 'ur',
            },
            status: {
              privacyStatus,
              selfDeclaredMadeForKids: madeForKids,
            },
          }),
        }
      );

    // Step 1: Initiate YouTube Data API v3 Resumable Upload (retry once if 401 & refreshToken exists)
    let initRes = await initiateResumableUpload(session.accessToken);
    if (initRes.status === 401 && session.refreshToken) {
      session = await refreshYouTubeAccessToken(sessionId, {
        ...session,
        expiresAt: 0,
      });
      initRes = await initiateResumableUpload(session.accessToken);
    }

    if (!initRes.ok) {
      const errText = await initRes.text();
      if (initRes.status === 401) {
        youtubeSessions.delete(sessionId);
        res.status(401).json({
          error:
            'Your YouTube authorization expired or was revoked. Please reconnect your YouTube channel.',
        });
        return;
      }
      res.status(initRes.status).json({
        error: parseGoogleApiError(errText, initRes.status),
      });
      return;
    }

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) {
      res.status(502).json({
        error: 'YouTube did not return a resumable upload location URI.',
      });
      return;
    }

    // Step 2: Upload actual WebM binary stream
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': cleanVideoMime,
        'Content-Length': String(buf.length),
      },
      body: new Uint8Array(buf),
    });

    const uploadBodyText = await uploadRes.text();
    if (!uploadRes.ok) {
      res.status(uploadRes.status).json({
        error: parseGoogleApiError(uploadBodyText, uploadRes.status),
      });
      return;
    }

    let uploadedVideo: {
      id?: string;
      snippet?: { title?: string };
      status?: { privacyStatus?: string };
    } = {};
    try {
      uploadedVideo = JSON.parse(uploadBodyText);
    } catch {
      res.status(502).json({
        error: 'YouTube returned an unreadable response after video upload.',
      });
      return;
    }

    const videoId = typeof uploadedVideo.id === 'string' ? uploadedVideo.id.trim() : '';
    if (!videoId) {
      res.status(502).json({
        error:
          'YouTube did not confirm a video ID for this upload. Check your YouTube Studio before retrying.',
      });
      return;
    }

    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    let thumbnailUploaded = false;
    let thumbnailWarning: string | null = null;

    // Step 3: Upload optional custom thumbnail (verify JPEG/PNG binary signature)
    if (thumbnailFile && thumbnailFile.buffer.length > 0) {
      const tb = thumbnailFile.buffer;
      const isJpeg = tb.length >= 3 && tb[0] === 0xff && tb[1] === 0xd8 && tb[2] === 0xff;
      const isPng =
        tb.length >= 4 &&
        tb[0] === 0x89 &&
        tb[1] === 0x50 &&
        tb[2] === 0x4e &&
        tb[3] === 0x47;

      if (!isJpeg && !isPng) {
        thumbnailWarning =
          'Video uploaded successfully, but the thumbnail was skipped because it was not a valid JPG or PNG image.';
      } else if (tb.length > 2 * 1024 * 1024) {
        thumbnailWarning =
          'Video uploaded, but thumbnail exceeded YouTube 2MB size limit and was skipped.';
      } else {
        const cleanThumbMime = isPng ? 'image/png' : 'image/jpeg';
        const thumbRes = await fetch(
          `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(
            videoId
          )}&uploadType=media`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.accessToken}`,
              'Content-Type': cleanThumbMime,
            },
            body: new Uint8Array(tb),
          }
        );

        if (thumbRes.ok) {
          thumbnailUploaded = true;
        } else {
          const thumbErr = await thumbRes.text();
          thumbnailWarning = `Video uploaded successfully, but custom thumbnail could not be applied: ${parseGoogleApiError(
            thumbErr,
            thumbRes.status
          )}`;
        }
      }
    }

    res.json({
      videoId,
      youtubeUrl,
      privacyStatus: uploadedVideo.status?.privacyStatus || privacyStatus,
      title: uploadedVideo.snippet?.title || title,
      thumbnailUploaded,
      thumbnailWarning,
    });
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : 'YouTube video upload failed unexpectedly.';
    res.status(500).json({ error: msg });
  }
});

// --- Gemini Episode, Regeneration & Urdu TTS Routes ---

app.post('/api/generate-episode', async (req, res) => {
  try {
    const body = req.body as GenerateEpisodeRequest;
    const topic = (body.topic || '').trim();
    if (!topic) {
      res.status(400).json({ error: 'Please enter a story topic to generate an episode.' });
      return;
    }

    const moral = (body.moral || '').trim();
    const tone = body.tone || 'Moral & Heartwarming';
    const artStyle = body.artStyle || '2D Pixar-Inspired Storybook';
    const audience = body.audience || 'Kids (4-8 Years)';

    const ai = getGeminiClient();

    const systemInstruction = `You are Cartoon Spark AI, a dedicated YouTube Shorts creative producer for the "Cartoon Spark" channel specializing in original Urdu cartoon stories.
Your output must be beginner-friendly, immediately usable for video production, and written in fluent, natural Pakistani Urdu script for all Urdu fields.
Rules:
1. From ONLY the user's topic, automatically create an original Urdu story, catchy Urdu & English title, uplifting moral lesson, 60-second Urdu narration script, and rich YouTube SEO metadata.
2. Divide the 60-second YouTube Short into EXACTLY 8 sequential scenes (Scene 1 to Scene 8) whose durations sum to 60 seconds (e.g., 7-8 seconds per scene).
3. Keep character appearance 100% consistent across all 8 image prompts and visualBlueprint fields by referencing the Character Sheet.
4. For characterSheet[].archetype, choose strictly from: boy, girl, bird, cat, rabbit, elder, donkey. Give distinct vivid hex colors for primaryColor, secondaryColor, accentColor.
5. For every scene's visualBlueprint, choose valid enum values:
   - setting: courtyard | forest | village | riverside | home | meadow
   - timeOfDay: morning | afternoon | sunset | night
   - cameraShot: wide | medium | closeup
   - primaryCharacterPose / secondaryCharacterPose: standing | walking | pointing | surprised | celebrating | thinking
   - primaryCharacterExpression: happy | curious | worried | excited | kind
   - prop: lantern | mango | book | nest | pot | coin_pouch | none
6. Every imagePrompt must specify vertical 9:16 composition, the requested art style (${artStyle}), expressive facial acting, lighting, and explicitly end with "no text, no watermark".
7. Make sure voiceoverPlan.cleanUrduNarration contains ONLY clean spoken Urdu sentences (combining all 8 scenes naturally for ~55-60s speech) with zero brackets, labels, or English words so it works seamlessly with Urdu Text-to-Speech.
8. In youtubeMetadata:
   - Write storySummary (2-3 sentences summarizing the actual story).
   - Write a complete description based on the actual Urdu story containing: Urdu & English hook, short story summary, the moral lesson, Cartoon Spark channel subscribe CTA, and relevant hashtags.
   - Generate 12 searchable YouTube tags (plain phrases without #) and 10 hashtags (with #).
   - Set madeForKids to ${audience === 'Kids (4-8 Years)' ? 'true' : 'false'} with clear audienceGuidance.`;

    const prompt = `Create a complete YouTube Shorts production package for the channel "Cartoon Spark".
Story Topic: ${topic}
${moral ? `Desired Moral Lesson: ${moral}` : 'Automatically invent a meaningful, heartwarming moral lesson.'}
Story Tone: ${tone}
Visual Art Style: ${artStyle}
Target Audience: ${audience}`;

    const response = await generateTextWithFallback(ai, {
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: EPISODE_RESPONSE_SCHEMA,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const rawText = (response.text || '').trim();
    if (!rawText) {
      throw new Error('Gemini returned an empty response. Please try again.');
    }

    const parsed = JSON.parse(rawText);
    const episode: EpisodePack = {
      id: `ep_${Date.now()}`,
      createdAt: new Date().toISOString(),
      topicPrompt: topic,
      tone,
      artStyle,
      audience,
      ...parsed,
    };

    res.json({ episode });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

app.post('/api/regenerate-section', async (req, res) => {
  try {
    const { episode, section, instruction } = req.body as {
      episode: EpisodePack;
      section: RegenerateSectionType;
      instruction?: string;
    };

    if (!episode || !section) {
      res.status(400).json({ error: 'Missing episode context or target section.' });
      return;
    }

    const ai = getGeminiClient();
    const extraNote = instruction?.trim()
      ? `Creator refinement request: ${instruction.trim()}`
      : 'Make this version even fresher, punchier, and higher CTR.';

    if (section === 'titles') {
      const response = await generateTextWithFallback(ai, {
        contents: `Channel: Cartoon Spark (Urdu Cartoon Stories).
Target Audience: ${episode.audience}
Story Title (Urdu): ${episode.episodeTitleUrdu}
Moral (Urdu): ${episode.moralLessonUrdu}
Moral (English): ${episode.moralLessonEnglish}
Full Story: ${episode.urduStory}
${extraNote}

Generate 3 fresh, high-CTR SEO-friendly YouTube Shorts titles, a concise storySummary, a complete description (including story summary, moral lesson, Cartoon Spark CTA, and hashtags), 10 hashtags, 10 keywords, 12 searchable YouTube tags, madeForKids boolean, and audienceGuidance.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: EPISODE_RESPONSE_SCHEMA.properties.youtubeMetadata,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      const youtubeMetadata = JSON.parse((response.text || '{}').trim());
      res.json({ youtubeMetadata });
      return;
    }

    if (section === 'thumbnails') {
      const response = await generateTextWithFallback(ai, {
        contents: `Channel: Cartoon Spark (Urdu Cartoon Stories).
Story Title (Urdu): ${episode.episodeTitleUrdu}
Moral: ${episode.moralLessonEnglish}
${extraNote}

Generate 3 fresh thumbnail text and visual composition concepts with punchy 2-4 word Urdu overlay text.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              thumbnailSuggestions: EPISODE_RESPONSE_SCHEMA.properties.thumbnailSuggestions,
            },
            required: ['thumbnailSuggestions'],
          },
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      const parsed = JSON.parse((response.text || '{}').trim());
      res.json({ thumbnailSuggestions: parsed.thumbnailSuggestions });
      return;
    }

    if (section === 'imagePrompts') {
      const response = await generateTextWithFallback(ai, {
        contents: `Art Style: ${episode.artStyle}
Character Sheet: ${JSON.stringify(episode.characterSheet)}
Existing 8 Scenes: ${JSON.stringify(
          episode.scenes.map((s) => ({
            sceneNumber: s.sceneNumber,
            visualAction: s.visualAction,
            urduNarration: s.urduNarration,
          }))
        )}
${extraNote}

Rewrite all 8 vertical 9:16 cartoon image prompts so character design, outfits, lighting, and atmosphere are richly detailed and cohesive across every scene. End every prompt with "no text, no watermark".`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              prompts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sceneNumber: { type: Type.INTEGER },
                    imagePrompt: { type: Type.STRING },
                  },
                  required: ['sceneNumber', 'imagePrompt'],
                },
              },
            },
            required: ['prompts'],
          },
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      const parsed = JSON.parse((response.text || '{}').trim()) as {
        prompts: Array<{ sceneNumber: number; imagePrompt: string }>;
      };
      const updatedScenes = episode.scenes.map((scene) => {
        const match = parsed.prompts?.find((p) => p.sceneNumber === scene.sceneNumber);
        return match ? { ...scene, imagePrompt: match.imagePrompt } : scene;
      });
      res.json({ scenes: updatedScenes });
      return;
    }

    if (section === 'editingPlan') {
      const response = await generateTextWithFallback(ai, {
        contents: `Channel: Cartoon Spark (Urdu Cartoon Stories, 60s YouTube Shorts).
Tone: ${episode.tone}
Scenes: ${JSON.stringify(
          episode.scenes.map((s) => ({
            sceneNumber: s.sceneNumber,
            timeRange: s.timeRange,
            sfxCue: s.sfxCue,
            cameraMovement: s.cameraMovement,
          }))
        )}
${extraNote}

Generate an updated beginner-friendly 5-step video editing plan tailored for CapCut / Premiere Pro.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: EPISODE_RESPONSE_SCHEMA.properties.editingPlan,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      const editingPlan = JSON.parse((response.text || '{}').trim());
      res.json({ editingPlan });
      return;
    }

    if (section === 'voiceover') {
      const response = await generateTextWithFallback(ai, {
        contents: `Channel: Cartoon Spark.
Tone: ${episode.tone}
8 Scene Urdu Narrations:
${episode.scenes.map((s) => `Scene ${s.sceneNumber}: ${s.urduNarration}`).join('\n')}
${extraNote}

Regenerate the voiceoverPlan with expressive delivery cues in urduVoiceoverWithCues, and pure spoken Urdu sentences (no brackets/tags) in cleanUrduNarration.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: EPISODE_RESPONSE_SCHEMA.properties.voiceoverPlan,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      const voiceoverPlan = JSON.parse((response.text || '{}').trim());
      res.json({ voiceoverPlan });
      return;
    }

    res.status(400).json({ error: 'Unsupported section type.' });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

app.post('/api/generate-voiceover', async (req, res) => {
  try {
    const { text, voiceName, style } = req.body as {
      text: string;
      voiceName?: VoiceActorName;
      style?: string;
    };

    const cleanText = (text || '').trim();
    if (!cleanText) {
      res.status(400).json({ error: 'Urdu narration text is required to synthesize audio.' });
      return;
    }

    const ai = getGeminiClient();
    const aiAlpha = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      apiVersion: 'v1alpha',
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const chosenVoice: VoiceActorName = voiceName || 'Kore';
    const voiceStyle =
      style?.trim() ||
      'Warm, expressive Urdu cartoon storyteller with clear pronunciation and engaging pacing';

    const attempts: Array<() => Promise<{ audio?: string }>> = [
      async () => {
        const r = await ai.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [{ text: `Read aloud in ${voiceStyle}: ${cleanText}` }],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: chosenVoice } },
            },
          },
        });
        return { audio: r.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data };
      },
      async () => {
        const r = await aiAlpha.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [{ text: cleanText, speechMetadata: { style: voiceStyle } }],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: chosenVoice } },
            },
          },
        });
        return { audio: r.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data };
      },
      async () => {
        const r = await ai.models.generateContent({
          model: 'gemini-3.8-flash-tts',
          contents: [{ role: 'user', parts: [{ text: cleanText }] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: chosenVoice } },
            },
          },
        });
        return { audio: r.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data };
      },
    ];

    let base64Audio: string | undefined;
    let lastAttemptError: unknown;
    for (const runAttempt of attempts) {
      try {
        const out = await withRetry(runAttempt, 2);
        if (out.audio) {
          base64Audio = out.audio;
          break;
        }
      } catch (err) {
        lastAttemptError = err;
        const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
        if (msg.includes('api_key_invalid') || msg.includes('403')) {
          throw err;
        }
      }
    }

    if (!base64Audio) {
      if (lastAttemptError) throw lastAttemptError;
      throw new Error('Voice synthesis returned no audio data. Please try again.');
    }

    res.json({
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
      voiceName: chosenVoice,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT) || 3000;

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Cartoon Spark AI server running on http://0.0.0.0:${port}`);
  });
}

startServer();
