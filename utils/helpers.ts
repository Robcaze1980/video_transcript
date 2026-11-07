
import { Subtitle, SubtitleStyle } from "../types";

export const formatTime = (seconds: number, separator: string = ','): string => {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalMilliseconds = Math.round(safeSeconds * 1000);
  const h = Math.floor(totalMilliseconds / 3_600_000);
  const m = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const s = Math.floor((totalMilliseconds % 60_000) / 1000);
  const ms = totalMilliseconds % 1000;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}${separator}${ms.toString().padStart(3, '0')}`;
};

export const generateSRT = (subtitles: Subtitle[]): string => {
  return [...subtitles]
    .filter(
      (sub) =>
        Number.isFinite(sub.start) &&
        Number.isFinite(sub.end) &&
        sub.start >= 0 &&
        sub.end > sub.start
    )
    .sort((a, b) => a.start - b.start)
    .map((sub, index) => {
      return `${index + 1}\n${formatTime(sub.start)} --> ${formatTime(sub.end)}\n${sub.translatedText.trim()}\n`;
    })
    .join('\n');
};

export const parseTimeToSeconds = (timeStr: string): number => {
  const clean = timeStr.trim().replace(',', '.');
  const match = clean.match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!match) return Number.NaN;

  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = match[4] ? Number(match[4].padEnd(3, '0')) : 0;

  if (minutes >= 60 || seconds >= 60) return Number.NaN;
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
};

export const parseSRT = (content: string): Subtitle[] => {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);
  const subtitles: Subtitle[] = [];

  blocks.forEach((block, idx) => {
    const lines = block.trim().split('\n');
    if (lines.length === 0) return;

    let timingIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timingIndex = i;
        break;
      }
    }

    if (timingIndex !== -1) {
      const timingParts = lines[timingIndex].split('-->');
      if (timingParts.length !== 2) return;

      // WEBVTT can append cue settings after the end timestamp.
      const startStr = timingParts[0].trim().split(/\s+/)[0];
      const endStr = timingParts[1].trim().split(/\s+/)[0];
      const start = parseTimeToSeconds(startStr);
      const end = parseTimeToSeconds(endStr);
      const textLines = lines.slice(timingIndex + 1).join('\n').trim();

      if (Number.isFinite(start) && Number.isFinite(end) && end > start && textLines) {
        subtitles.push({
          id: `cue-${idx}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          start: Number(start.toFixed(3)),
          end: Number(end.toFixed(3)),
          originalText: '',
          translatedText: textLines,
          speaker: 'Speaker',
        });
      }
    }
  });

  return subtitles.sort((a, b) => a.start - b.start);
};

export const downloadFile = (content: string, fileName: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, fileName);
};

export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};

export const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const wrapCanvasText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of normalized.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = '';
    }

    if (ctx.measureText(word).width <= maxWidth) {
      current = word;
      continue;
    }

    // CJK text and unusually long words have no usable spaces.
    let chunk = '';
    for (const character of Array.from(word)) {
      if (chunk && ctx.measureText(chunk + character).width > maxWidth) {
        lines.push(chunk);
        chunk = character;
      } else {
        chunk += character;
      }
    }
    current = chunk;
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
};

export const drawSubtitlesToCanvas = (
  ctx: CanvasRenderingContext2D,
  text: string,
  style: SubtitleStyle,
  width: number,
  height: number
) => {
  const { fontSize, fontFamily, textColor, backgroundColor, backgroundOpacity, position } = style;
  
  const isPortrait = height > width;
  const sizeRef = Math.min(width, height);
  const scale = sizeRef / 400; 
  const baseFontSize = fontSize * scale * 0.9;
  const maxWidth = isPortrait ? width * 0.82 : width * 0.7;

  let scaledFontSize = baseFontSize;
  let lines: string[] = [];

  // Shrink only when needed so a long translation remains inside the frame.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    ctx.font = `${scaledFontSize}px ${fontFamily}`;
    lines = wrapCanvasText(ctx, text, maxWidth);
    if (lines.length <= 4 || scaledFontSize <= baseFontSize * 0.6) break;
    scaledFontSize *= 0.9;
  }

  const isRtl = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/.test(text);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = isRtl ? 'rtl' : 'ltr';

  const lineHeight = scaledFontSize * 1.3;
  const totalHeight = lines.length * lineHeight;
  const padding = scaledFontSize * 0.5;
  
  const bottomMargin = Math.max(height * 0.08, 40 * scale);
  const yBase = position === 'bottom' ? height - bottomMargin - (totalHeight / 2) : bottomMargin + (totalHeight / 2);

  // Draw background box
  if (style.showBackground) {
    const maxLineWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
    const bgWidth = Math.min(width - 16 * scale, maxLineWidth + padding * 4);
    
    ctx.fillStyle = hexToRgba(backgroundColor, backgroundOpacity);
    ctx.beginPath();
    const boxX = (width - bgWidth) / 2;
    const boxY = yBase - (totalHeight / 2) - padding;
    const boxW = bgWidth;
    const boxH = totalHeight + padding * 2;
    const radius = 12 * scale;
    
    ctx.moveTo(boxX + radius, boxY);
    ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, radius);
    ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, radius);
    ctx.arcTo(boxX, boxY + boxH, boxX, boxY, radius);
    ctx.arcTo(boxX, boxY, boxX + boxW, boxY, radius);
    ctx.closePath();
    ctx.fill();
  }

  // Draw text
  ctx.save();
  if (style.textShadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4 * scale;
    ctx.shadowOffsetX = 2 * scale;
    ctx.shadowOffsetY = 2 * scale;
  }

  lines.forEach((line, i) => {
    const x = width / 2;
    const y = yBase - (totalHeight / 2) + (lineHeight / 2) + (i * lineHeight);
    
    if (style.textOutline) {
      ctx.lineWidth = 1.5 * scale;
      ctx.strokeStyle = '#000000';
      ctx.strokeText(line.trim(), x, y);
    }
    
    ctx.fillStyle = textColor;
    ctx.fillText(line.trim(), x, y);
  });
  ctx.restore();
};
