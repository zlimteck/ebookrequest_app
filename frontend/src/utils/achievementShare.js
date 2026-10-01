// Génère une image de partage pour un succès débloqué, dessinée directement en Canvas 2D
// (pas de dépendance html-to-image) — même esprit visuel que la carte de partage de
// l'app iOS (AchievementShareCard.swift) : fond dégradé sombre teinté par la couleur du
// palier, médaillon circulaire, nom du succès, palier, branding EbookRequest.

export const TIER_HEX = {
  bronze: '#b8763b',
  silver: '#a7b0bd',
  gold: '#e6b93d',
  platinum: '#5fd0d6',
  diamond: '#9b8cf2',
  diamondBlue: '#3b82f6',
  diamondRed: '#ef4444',
  diamondBlack: '#52525b',
  legend: '#c026d3',
};

export const GENERIC_ACCENT_HEX = '#6366f1';

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Charge un SVG (string complet) comme image décodée, utilisable avec ctx.drawImage.
async function loadIconImage(svgMarkup) {
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Charge une image raster (ex. logo Hardcover) telle qu'utilisée ailleurs dans l'app.
async function loadRasterImage(src) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = src;
  });
  return img;
}

export async function generateAchievementShareImage({ label, tierLabel, accentHex, thresholdLabel, iconSvgMarkup, iconImageSrc, iconImageFilter, iconText }) {
  const W = 400, H = 520;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Fond : dégradé vertical sombre teinté par la couleur du palier.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d0d1a');
  bg.addColorStop(0.55, '#17172b');
  bg.addColorStop(1, hexToRgba(accentHex, 0.4));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Halo radial derrière le médaillon.
  const glow = ctx.createRadialGradient(W / 2, 168, 10, W / 2, 168, 220);
  glow.addColorStop(0, hexToRgba(accentHex, 0.35));
  glow.addColorStop(1, hexToRgba(accentHex, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Médaillon.
  const cx = W / 2, cy = 168;
  ctx.beginPath();
  ctx.arc(cx, cy, 98, 0, Math.PI * 2);
  ctx.strokeStyle = hexToRgba(accentHex, 0.25);
  ctx.lineWidth = 14;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 80, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(accentHex, 0.16);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = accentHex;
  ctx.stroke();

  // Icône réelle du succès si fournie (SVG teinté, logo raster ou texte, dans cet ordre
  // de priorité), sinon trophée générique en dernier recours.
  let iconDrawn = false;
  if (iconSvgMarkup) {
    try {
      const img = await loadIconImage(iconSvgMarkup);
      const size = 66;
      ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
      iconDrawn = true;
    } catch {
      // fallback silencieux
    }
  } else if (iconImageSrc) {
    try {
      const img = await loadRasterImage(iconImageSrc);
      const size = 72;
      ctx.save();
      if (iconImageFilter) ctx.filter = iconImageFilter;
      ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
      ctx.restore();
      iconDrawn = true;
    } catch {
      // fallback silencieux
    }
  } else if (iconText) {
    ctx.font = 'bold 36px sans-serif';
    ctx.fillStyle = accentHex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(iconText, cx, cy);
    iconDrawn = true;
  }
  if (!iconDrawn) {
    ctx.font = '62px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏆', cx, cy + 6);
  }

  let y = 296;

  if (tierLabel) {
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = accentHex;
    ctx.textAlign = 'center';
    ctx.fillText(tierLabel.toUpperCase(), cx, y);
    y += 34;
  }

  ctx.font = 'bold 24px sans-serif';
  ctx.fillStyle = '#ffffff';
  const lines = wrapText(ctx, label, W - 64);
  for (const line of lines) {
    ctx.fillText(line, cx, y);
    y += 30;
  }
  y += 4;

  if (thresholdLabel) {
    ctx.font = '600 12px sans-serif';
    const textWidth = ctx.measureText(thresholdLabel).width;
    const pillW = textWidth + 24, pillH = 26;
    const pillX = cx - pillW / 2, pillY = y;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textBaseline = 'middle';
    ctx.fillText(thresholdLabel, cx, pillY + pillH / 2 + 1);
  }

  // Divider + branding en bas.
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(48, H - 60);
  ctx.lineTo(W - 48, H - 60);
  ctx.stroke();

  ctx.font = '600 13px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.textBaseline = 'middle';
  ctx.fillText('🏆 EbookRequest', cx, H - 32);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

export async function shareAchievementImage({ label, tierLabel, accentHex, thresholdLabel, iconSvgMarkup, iconImageSrc, iconImageFilter, iconText }) {
  const blob = await generateAchievementShareImage({ label, tierLabel, accentHex, thresholdLabel, iconSvgMarkup, iconImageSrc, iconImageFilter, iconText });
  const file = new File([blob], 'succes-ebookrequest.png', { type: 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Succès EbookRequest', text: label });
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'succes-ebookrequest.png';
  a.click();
  URL.revokeObjectURL(url);
}
