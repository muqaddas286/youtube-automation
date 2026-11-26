import type { EpisodePack } from '../types/episode';
import { renderSceneCartoonImage } from './cartoonSceneRenderer';

export async function generateAutoThumbnailBlob(
  episode: EpisodePack,
  urduOverlayText?: string,
  englishBadge?: string
): Promise<{ blob: Blob; dataUrl: string }> {
  const width = 1280;
  const height = 720;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize canvas for thumbnail generation.');
  }

  const sceneSrc =
    episode.scenes[0]?.imageDataUrl ||
    renderSceneCartoonImage(episode, episode.scenes[0]);

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not load scene image for thumbnail.'));
    el.src = sceneSrc;
  });

  // Rich dark purple studio backdrop
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#0B0D14');
  bg.addColorStop(0.5, '#191433');
  bg.addColorStop(1, '#2E1065');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Draw crisp 9:16 cartoon frame framed cleanly on the left/right
  const frameH = height - 64;
  const frameW = Math.round((frameH * 9) / 16);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(48, 32, frameW, frameH, 20);
  ctx.clip();
  ctx.drawImage(img, 48, 32, frameW, frameH);
  ctx.restore();

  ctx.strokeStyle = 'rgba(139, 92, 246, 0.7)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(48, 32, frameW, frameH, 20);
  ctx.stroke();

  // Right-side bold Urdu & Cartoon Spark branding panel
  const rightCenter = 48 + frameW + (width - (48 + frameW)) / 2;

  ctx.fillStyle = '#7C3AED';
  ctx.beginPath();
  ctx.roundRect(rightCenter - 140, 120, 280, 52, 10);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 24px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CARTOON SPARK', rightCenter, 146);

  const urduText =
    urduOverlayText ||
    episode.thumbnailSuggestions[0]?.urduText ||
    episode.episodeTitleUrdu;

  ctx.direction = 'rtl';
  ctx.fillStyle = '#FDE047';
  ctx.font = '700 68px "Noto Sans Arabic", "Noto Nastaliq Urdu", sans-serif';
  ctx.fillText(urduText, rightCenter, 340, width - frameW - 140);

  const badge =
    englishBadge ||
    episode.thumbnailSuggestions[0]?.englishBadge ||
    'Urdu Moral Story';
  ctx.direction = 'ltr';
  ctx.fillStyle = '#E2E8F0';
  ctx.font = '600 32px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(badge, rightCenter, 470, width - frameW - 140);

  ctx.fillStyle = '#A78BFA';
  ctx.font = '500 22px "DM Sans", sans-serif';
  ctx.fillText(episode.episodeTitleEnglish, rightCenter, 560, width - frameW - 140);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Failed to encode JPEG thumbnail.'));
      },
      'image/jpeg',
      0.92
    );
  });

  return { blob, dataUrl };
}
