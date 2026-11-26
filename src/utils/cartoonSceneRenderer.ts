import type {
  CharacterArchetype,
  CharacterExpression,
  CharacterPose,
  CharacterSheetItem,
  EpisodePack,
  EpisodeScene,
  SceneProp,
  SceneSetting,
  TimeOfDay,
} from '../types/episode';

const WIDTH = 720;
const HEIGHT = 1280;

function safeColor(hex: string | undefined, fallback: string): string {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex.trim())) return fallback;
  return hex.trim();
}

function drawSky(ctx: CanvasRenderingContext2D, timeOfDay: TimeOfDay, moodColor: string) {
  const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT * 0.72);
  if (timeOfDay === 'night') {
    grad.addColorStop(0, '#0B1026');
    grad.addColorStop(0.55, '#19224A');
    grad.addColorStop(1, '#2D2758');
  } else if (timeOfDay === 'sunset') {
    grad.addColorStop(0, '#3B1D5A');
    grad.addColorStop(0.45, '#9D3B68');
    grad.addColorStop(0.85, '#F59E0B');
    grad.addColorStop(1, '#FDE68A');
  } else if (timeOfDay === 'morning') {
    grad.addColorStop(0, '#38BDF8');
    grad.addColorStop(0.6, '#BAE6FD');
    grad.addColorStop(1, '#FEF3C7');
  } else {
    grad.addColorStop(0, '#1D6FE8');
    grad.addColorStop(0.6, '#60A5FA');
    grad.addColorStop(1, '#DBEAFE');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Subtle atmospheric mood glow
  const glow = ctx.createRadialGradient(WIDTH * 0.5, HEIGHT * 0.35, 30, WIDTH * 0.5, HEIGHT * 0.35, 420);
  glow.addColorStop(0, `${safeColor(moodColor, '#8B5CF6')}28`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  if (timeOfDay === 'night') {
    // Twinkling stars
    ctx.fillStyle = '#FEF9C3';
    const stars = [
      [90, 120, 3], [180, 210, 2], [290, 95, 3.5], [440, 150, 2.5],
      [580, 110, 3], [640, 230, 2], [130, 320, 2], [510, 290, 2.5],
      [350, 220, 2], [610, 360, 2],
    ];
    for (const [x, y, r] of stars) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Crescent moon
    ctx.fillStyle = '#FDE68A';
    ctx.beginPath();
    ctx.arc(560, 185, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#121836';
    ctx.beginPath();
    ctx.arc(582, 173, 45, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Sun
    const sunY = timeOfDay === 'sunset' ? 420 : 210;
    const sunColor = timeOfDay === 'sunset' ? '#FBBF24' : '#FEF08A';
    ctx.fillStyle = `${sunColor}44`;
    ctx.beginPath();
    ctx.arc(540, sunY, 92, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = sunColor;
    ctx.beginPath();
    ctx.arc(540, sunY, 56, 0, Math.PI * 2);
    ctx.fill();

    // Soft cartoon clouds
    ctx.fillStyle = timeOfDay === 'sunset' ? 'rgba(255, 224, 194, 0.55)' : 'rgba(255, 255, 255, 0.78)';
    const drawCloud = (cx: number, cy: number, s: number) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 34 * s, 0, Math.PI * 2);
      ctx.arc(cx + 32 * s, cy - 10 * s, 40 * s, 0, Math.PI * 2);
      ctx.arc(cx + 68 * s, cy, 32 * s, 0, Math.PI * 2);
      ctx.fill();
    };
    drawCloud(110, 190, 1.1);
    drawCloud(360, 140, 0.85);
  }
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, night: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  // Trunk
  ctx.fillStyle = '#5C3A21';
  ctx.strokeStyle = '#2B180C';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-22, 0);
  ctx.quadraticCurveTo(-14, -120, -18, -210);
  ctx.lineTo(18, -210);
  ctx.quadraticCurveTo(14, -120, 26, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Foliage clusters
  const leafMain = night ? '#1E4D3B' : '#2E8B57';
  const leafLight = night ? '#2A6B50' : '#4ADE80';
  const blobs = [
    [-55, -220, 62],
    [55, -215, 58],
    [0, -275, 72],
    [-25, -185, 52],
    [35, -185, 52],
  ];
  ctx.fillStyle = leafMain;
  for (const [bx, by, br] of blobs) {
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = `${leafLight}55`;
  ctx.beginPath();
  ctx.arc(-15, -285, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEnvironment(
  ctx: CanvasRenderingContext2D,
  setting: SceneSetting,
  timeOfDay: TimeOfDay
) {
  const isNight = timeOfDay === 'night';
  const groundTop = HEIGHT * 0.68;

  // Distant rolling hills
  ctx.fillStyle = isNight ? '#1B2845' : '#4D7C5D';
  ctx.beginPath();
  ctx.moveTo(0, groundTop + 30);
  ctx.quadraticCurveTo(WIDTH * 0.28, groundTop - 95, WIDTH * 0.58, groundTop + 10);
  ctx.quadraticCurveTo(WIDTH * 0.85, groundTop - 60, WIDTH, groundTop + 20);
  ctx.lineTo(WIDTH, HEIGHT);
  ctx.lineTo(0, HEIGHT);
  ctx.closePath();
  ctx.fill();

  // Main ground plane
  const groundGrad = ctx.createLinearGradient(0, groundTop, 0, HEIGHT);
  if (setting === 'courtyard' || setting === 'village' || setting === 'home') {
    groundGrad.addColorStop(0, isNight ? '#312E4A' : '#D6B88D');
    groundGrad.addColorStop(1, isNight ? '#1E1B30' : '#A68356');
  } else {
    groundGrad.addColorStop(0, isNight ? '#1E3F35' : '#4E9F58');
    groundGrad.addColorStop(1, isNight ? '#112620' : '#2C6E36');
  }
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, groundTop, WIDTH, HEIGHT - groundTop);

  // Setting-specific background details
  if (setting === 'courtyard' || setting === 'home') {
    // Stylized arched wall & warm window
    ctx.fillStyle = isNight ? '#262B47' : '#F3E3C9';
    ctx.strokeStyle = '#1E1B2E';
    ctx.lineWidth = 4;
    ctx.fillRect(40, groundTop - 270, WIDTH - 80, 270);
    ctx.strokeRect(40, groundTop - 270, WIDTH - 80, 270);

    // Decorative Islamic/Desi arch doorway
    ctx.fillStyle = isNight ? '#141729' : '#7C4A2D';
    ctx.beginPath();
    ctx.moveTo(WIDTH * 0.5 - 85, groundTop);
    ctx.lineTo(WIDTH * 0.5 - 85, groundTop - 150);
    ctx.quadraticCurveTo(WIDTH * 0.5, groundTop - 245, WIDTH * 0.5 + 85, groundTop - 150);
    ctx.lineTo(WIDTH * 0.5 + 85, groundTop);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Courtyard tile band
    ctx.fillStyle = isNight ? '#3B3063' : '#3B82F6';
    ctx.fillRect(40, groundTop - 32, WIDTH - 80, 32);
    // Warm hanging wall lantern
    ctx.fillStyle = '#FBBF24';
    ctx.beginPath();
    ctx.arc(135, groundTop - 165, 16, 0, Math.PI * 2);
    ctx.fill();
  } else if (setting === 'village') {
    // Cozy village cottages
    const drawHouse = (hx: number, hw: number, hh: number) => {
      ctx.fillStyle = isNight ? '#34304E' : '#F5D6A7';
      ctx.strokeStyle = '#1E1B2E';
      ctx.lineWidth = 4;
      ctx.fillRect(hx, groundTop - hh, hw, hh);
      ctx.strokeRect(hx, groundTop - hh, hw, hh);
      // Warm lit window
      ctx.fillStyle = '#FBBF24';
      ctx.fillRect(hx + hw * 0.35, groundTop - hh * 0.62, hw * 0.3, hw * 0.25);
      ctx.strokeRect(hx + hw * 0.35, groundTop - hh * 0.62, hw * 0.3, hw * 0.25);
      // Roof
      ctx.fillStyle = isNight ? '#4C2E4F' : '#C2410C';
      ctx.beginPath();
      ctx.moveTo(hx - 14, groundTop - hh);
      ctx.lineTo(hx + hw * 0.5, groundTop - hh - 65);
      ctx.lineTo(hx + hw + 14, groundTop - hh);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    drawHouse(70, 170, 155);
    drawHouse(475, 165, 135);
    drawTree(ctx, 645, groundTop + 10, 0.85, isNight);
  } else if (setting === 'riverside') {
    // Shimmering winding river
    ctx.fillStyle = isNight ? '#1D4E89' : '#38BDF8';
    ctx.beginPath();
    ctx.moveTo(0, groundTop + 70);
    ctx.bezierCurveTo(WIDTH * 0.35, groundTop + 20, WIDTH * 0.55, groundTop + 160, WIDTH, groundTop + 95);
    ctx.lineTo(WIDTH, groundTop + 245);
    ctx.bezierCurveTo(WIDTH * 0.55, groundTop + 290, WIDTH * 0.35, groundTop + 140, 0, groundTop + 195);
    ctx.closePath();
    ctx.fill();
    drawTree(ctx, 110, groundTop + 20, 0.95, isNight);
    drawTree(ctx, 610, groundTop + 10, 0.85, isNight);
  } else {
    // Forest or Meadow
    drawTree(ctx, 115, groundTop + 15, 1.05, isNight);
    drawTree(ctx, 605, groundTop + 20, 0.95, isNight);
  }

  // Foreground grass tufts
  ctx.fillStyle = isNight ? '#133128' : '#2D7A3A';
  for (let i = 0; i < 6; i++) {
    const gx = 75 + i * 115;
    ctx.beginPath();
    ctx.arc(gx, HEIGHT - 28, 38, Math.PI, 0);
    ctx.fill();
  }
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  char: CharacterSheetItem,
  x: number,
  y: number,
  scale: number,
  pose: CharacterPose,
  expression: CharacterExpression,
  facingRight: boolean
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facingRight ? scale : -scale, scale);

  const primary = safeColor(char.primaryColor, '#4F46E5');
  const secondary = safeColor(char.secondaryColor, '#F59E0B');
  const accent = safeColor(char.accentColor, '#EC4899');
  const arch: CharacterArchetype = char.archetype || 'boy';

  // Soft ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 12, 58, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#18181B';
  ctx.lineWidth = 4.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const bounceY = pose === 'celebrating' ? -18 : pose === 'walking' ? -6 : 0;
  ctx.translate(0, bounceY);

  if (arch === 'bird') {
    // Expressive cartoon bird (sparrow / hoopoe / crow style)
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.ellipse(0, -68, 44, 36, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Belly highlight
    ctx.fillStyle = secondary;
    ctx.beginPath();
    ctx.ellipse(8, -58, 26, 22, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wing
    const wingAngle = pose === 'celebrating' || pose === 'pointing' ? -0.65 : 0.15;
    ctx.save();
    ctx.translate(-12, -72);
    ctx.rotate(wingAngle);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.ellipse(-18, 8, 28, 16, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Crest feathers
    ctx.fillStyle = secondary;
    ctx.beginPath();
    ctx.moveTo(-8, -104);
    ctx.lineTo(-20, -132);
    ctx.lineTo(0, -118);
    ctx.lineTo(12, -134);
    ctx.lineTo(14, -102);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Beak
    ctx.fillStyle = '#F59E0B';
    ctx.beginPath();
    ctx.moveTo(36, -82);
    ctx.lineTo(66, -74);
    ctx.lineTo(36, -64);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Eye
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(20, -82, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(23, -82, 5.5, 0, Math.PI * 2);
    ctx.fill();

    // Legs
    ctx.beginPath();
    ctx.moveTo(-8, -32);
    ctx.lineTo(-10, 4);
    ctx.moveTo(10, -32);
    ctx.lineTo(12, 4);
    ctx.stroke();

    ctx.restore();
    return;
  }

  if (arch === 'cat' || arch === 'rabbit' || arch === 'donkey') {
    // Friendly upright animal character
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.ellipse(0, -78, 42, 52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Belly / outfit scarf
    ctx.fillStyle = secondary;
    ctx.beginPath();
    ctx.ellipse(0, -70, 26, 34, 0, 0, Math.PI * 2);
    ctx.fill();

    // Scarf around neck
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(-30, -124, 60, 18, 8);
    ctx.fill();
    ctx.stroke();

    // Head
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.arc(0, -162, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Ears
    const earHeight = arch === 'rabbit' ? 68 : arch === 'donkey' ? 54 : 34;
    ctx.fillStyle = primary;
    for (const ex of [-24, 24]) {
      ctx.beginPath();
      ctx.ellipse(ex, -198 - earHeight * 0.35, 13, earHeight * 0.55, ex < 0 ? -0.15 : 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Eyes & Smile
    for (const ex of [-14, 14]) {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(ex, -166, 9.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(ex + 2, -166, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#FB7185';
    ctx.beginPath();
    ctx.arc(0, -152, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    if (expression === 'worried') {
      ctx.arc(0, -133, 10, Math.PI * 1.15, Math.PI * 1.85);
    } else {
      ctx.arc(0, -142, 11, 0.15 * Math.PI, 0.85 * Math.PI);
    }
    ctx.stroke();

    // Feet
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.ellipse(-18, -14, 15, 10, 0, 0, Math.PI * 2);
    ctx.ellipse(18, -14, 15, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Human storybook character: boy, girl, elder
  const skinColor = arch === 'elder' ? '#E2B48D' : '#F3C69F';

  // Legs
  ctx.fillStyle = '#F8FAFC';
  const leftLegX = pose === 'walking' ? -24 : -16;
  const rightLegX = pose === 'walking' ? 22 : 16;
  ctx.beginPath();
  ctx.roundRect(leftLegX - 10, -58, 20, 56, 8);
  ctx.roundRect(rightLegX - 10, -58, 20, 56, 8);
  ctx.fill();
  ctx.stroke();

  // Shoes
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.ellipse(leftLegX + 4, -2, 16, 9, 0, 0, Math.PI * 2);
  ctx.ellipse(rightLegX + 4, -2, 16, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Traditional Kurta / Tunic
  ctx.fillStyle = primary;
  ctx.beginPath();
  ctx.moveTo(-34, -148);
  ctx.lineTo(34, -148);
  ctx.lineTo(44, -52);
  ctx.lineTo(-44, -52);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Waist sash or collar trim
  ctx.fillStyle = secondary;
  ctx.beginPath();
  ctx.roundRect(-10, -148, 20, 42, 6);
  ctx.fill();
  ctx.stroke();

  // Arms
  const rightArmLift = pose === 'celebrating' ? -1.1 : pose === 'pointing' ? -0.5 : 0.3;
  const leftArmLift = pose === 'celebrating' ? 1.1 : pose === 'thinking' ? 0.8 : -0.3;

  ctx.save();
  ctx.translate(-34, -136);
  ctx.rotate(leftArmLift);
  ctx.fillStyle = primary;
  ctx.beginPath();
  ctx.roundRect(-10, 0, 20, 58, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.arc(0, 62, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(34, -136);
  ctx.rotate(rightArmLift);
  ctx.fillStyle = primary;
  ctx.beginPath();
  ctx.roundRect(-10, 0, 20, 58, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.arc(0, 62, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Head
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.arc(0, -196, 48, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Hair or Scarf/Beard
  if (arch === 'girl') {
    ctx.fillStyle = secondary;
    ctx.beginPath();
    ctx.arc(0, -206, 52, Math.PI * 0.9, Math.PI * 2.1);
    ctx.lineTo(48, -145);
    ctx.quadraticCurveTo(0, -155, -48, -145);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Face cutout re-draw
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.arc(0, -192, 40, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = arch === 'elder' ? '#E5E7EB' : '#271E1B';
    ctx.beginPath();
    ctx.arc(0, -206, 49, Math.PI * 0.95, Math.PI * 2.05);
    ctx.quadraticCurveTo(22, -225, 0, -214);
    ctx.quadraticCurveTo(-24, -225, -49, -202);
    ctx.fill();
    ctx.stroke();

    if (arch === 'elder') {
      // Friendly white beard
      ctx.fillStyle = '#F3F4F6';
      ctx.beginPath();
      ctx.moveTo(-30, -178);
      ctx.quadraticCurveTo(0, -132, 30, -178);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  // Cheeks
  ctx.fillStyle = 'rgba(251, 113, 133, 0.35)';
  ctx.beginPath();
  ctx.ellipse(-22, -182, 8, 5, 0, 0, Math.PI * 2);
  ctx.ellipse(22, -182, 8, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Expressive Eyes
  for (const ex of [-16, 16]) {
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(ex, -198, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#18181B';
    ctx.beginPath();
    ctx.arc(ex + 2.5, -198, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(ex + 4, -200, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Eyebrows
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  if (expression === 'worried') {
    ctx.moveTo(-25, -213);
    ctx.lineTo(-8, -218);
    ctx.moveTo(8, -218);
    ctx.lineTo(25, -213);
  } else {
    ctx.moveTo(-25, -216);
    ctx.lineTo(-8, -218);
    ctx.moveTo(8, -218);
    ctx.lineTo(25, -216);
  }
  ctx.stroke();

  // Mouth
  ctx.beginPath();
  if (expression === 'worried') {
    ctx.arc(0, -165, 11, Math.PI * 1.15, Math.PI * 1.85);
  } else if (expression === 'excited') {
    ctx.fillStyle = '#991B1B';
    ctx.arc(0, -173, 12, 0, Math.PI);
    ctx.fill();
  } else {
    ctx.arc(0, -176, 12, 0.12 * Math.PI, 0.88 * Math.PI);
  }
  ctx.stroke();

  ctx.restore();
}

function drawProp(ctx: CanvasRenderingContext2D, prop: SceneProp, x: number, y: number) {
  if (!prop || prop === 'none') return;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#18181B';
  ctx.lineWidth = 4;

  if (prop === 'lantern') {
    // Glowing purple/golden lantern
    const glow = ctx.createRadialGradient(0, 0, 8, 0, 0, 110);
    glow.addColorStop(0, 'rgba(253, 224, 71, 0.65)');
    glow.addColorStop(0.5, 'rgba(139, 92, 246, 0.35)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 110, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#A855F7';
    ctx.beginPath();
    ctx.roundRect(-22, -30, 44, 58, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#FEF08A';
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 18, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (prop === 'mango') {
    ctx.fillStyle = '#F59E0B';
    ctx.beginPath();
    ctx.ellipse(0, 0, 26, 34, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#22C55E';
    ctx.beginPath();
    ctx.ellipse(12, -32, 14, 7, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (prop === 'book') {
    ctx.fillStyle = '#7C3AED';
    ctx.beginPath();
    ctx.roundRect(-34, -22, 68, 44, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#FEF3C7';
    ctx.fillRect(-26, -15, 22, 30);
    ctx.fillRect(4, -15, 22, 30);
  } else if (prop === 'nest') {
    ctx.fillStyle = '#92400E';
    ctx.beginPath();
    ctx.ellipse(0, 8, 48, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (prop === 'pot') {
    ctx.fillStyle = '#C2410C';
    ctx.beginPath();
    ctx.arc(0, 6, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#EA580C';
    ctx.fillRect(-18, -32, 36, 12);
    ctx.strokeRect(-18, -32, 36, 12);
  } else if (prop === 'coin_pouch') {
    ctx.fillStyle = '#D97706';
    ctx.beginPath();
    ctx.arc(0, 8, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#FDE047';
    ctx.fillRect(-14, -22, 28, 8);
    ctx.strokeRect(-14, -22, 28, 8);
  }

  ctx.restore();
}

export function renderSceneCartoonImage(
  episode: EpisodePack,
  scene: EpisodeScene
): string {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const bp = scene.visualBlueprint || {
    setting: 'courtyard',
    timeOfDay: 'afternoon',
    cameraShot: 'medium',
    primaryCharacterPose: 'standing',
    primaryCharacterExpression: 'happy',
    includeSecondaryCharacter: true,
    secondaryCharacterPose: 'standing',
    prop: 'none',
    moodColor: '#8B5CF6',
  };

  drawSky(ctx, bp.timeOfDay, bp.moodColor);
  drawEnvironment(ctx, bp.setting, bp.timeOfDay);

  const primaryChar: CharacterSheetItem = episode.characterSheet[0] || {
    name: 'Hero',
    role: 'Main Character',
    visualDescription: '',
    archetype: 'boy',
    primaryColor: '#4F46E5',
    secondaryColor: '#F59E0B',
    accentColor: '#7C3AED',
    accessory: 'lantern',
  };

  const secondaryChar = episode.characterSheet[1];

  const shotScale =
    bp.cameraShot === 'closeup' ? 1.55 : bp.cameraShot === 'wide' ? 0.92 : 1.22;

  const groundY = HEIGHT * 0.84;

  if (bp.includeSecondaryCharacter && secondaryChar) {
    drawCharacter(
      ctx,
      primaryChar,
      WIDTH * 0.34,
      groundY,
      shotScale,
      bp.primaryCharacterPose,
      bp.primaryCharacterExpression,
      true
    );
    drawCharacter(
      ctx,
      secondaryChar,
      WIDTH * 0.69,
      groundY - 12,
      shotScale * 0.9,
      bp.secondaryCharacterPose,
      'curious',
      false
    );
    drawProp(ctx, bp.prop, WIDTH * 0.52, groundY - 88 * shotScale);
  } else {
    drawCharacter(
      ctx,
      primaryChar,
      WIDTH * 0.48,
      groundY,
      shotScale * 1.05,
      bp.primaryCharacterPose,
      bp.primaryCharacterExpression,
      true
    );
    drawProp(ctx, bp.prop, WIDTH * 0.72, groundY - 95 * shotScale);
  }

  return canvas.toDataURL('image/jpeg', 0.9);
}

export function hydrateEpisodeSceneImages(episode: EpisodePack): EpisodePack {
  if (typeof document === 'undefined') return episode;
  const scenes = episode.scenes.map((scene) => {
    if (scene.imageDataUrl) return scene;
    return {
      ...scene,
      imageDataUrl: renderSceneCartoonImage(episode, scene),
    };
  });
  return { ...episode, scenes };
}

export function stripLargeSceneImagesForStorage(episode: EpisodePack): EpisodePack {
  return {
    ...episode,
    scenes: episode.scenes.map(({ imageDataUrl: _omitted, ...rest }) => rest),
  };
}
