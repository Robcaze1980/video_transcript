
import { Subtitle, SubtitleHighlight, SubtitleStyle } from "../types";

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

const opacityLayers = new WeakMap<CanvasRenderingContext2D, CanvasRenderingContext2D>();

function lineHighlights(source: string, lines: string[], highlights: SubtitleHighlight[]) {
  const sourceOffsets = [...source.matchAll(/\S/g)].map(match => match.index);
  let offset = 0;
  return lines.map(line => {
    const lineOffsets = [...line.matchAll(/\S/g)].map(match => match.index);
    const first = offset;
    offset += lineOffsets.length;
    return highlights.flatMap(mark => {
      const selected = lineOffsets.filter((_, index) => {
        const original = sourceOffsets[first + index];
        return original >= mark.start && original < mark.end;
      });
      return selected.length ? [{ start: selected[0], end: selected.at(-1)! + 1 }] : [];
    });
  });
}

// The browser lays out the whole line so bidi ordering and joined letters stay intact.
function drawHighlights(ctx: CanvasRenderingContext2D, line: string, ranges: SubtitleHighlight[],
  left: number, y: number, fontSize: number) {
  if (!ranges.length) return;
  const span = document.createElement('span');
  span.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;white-space:pre;pointer-events:none;';
  span.style.font = ctx.font;
  span.style.letterSpacing = ctx.letterSpacing ?? '0px';
  span.dir = ctx.direction;
  span.textContent = line;
  document.body.append(span);
  const range = document.createRange();
  try {
    const origin = span.getBoundingClientRect().left;
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#b86d00';
    for (const { start, end } of ranges) {
      range.setStart(span.firstChild!, start);
      range.setEnd(span.firstChild!, end);
      for (const rect of range.getClientRects()) {
        ctx.fillRect(left + rect.left - origin, y - fontSize * 0.53, rect.width, fontSize * 1.06);
      }
    }
    ctx.restore();
  } finally { span.remove(); }
}

export const drawSubtitlesToCanvas = (
  ctx: CanvasRenderingContext2D,
  text: string,
  style: SubtitleStyle,
  width: number,
  height: number,
  highlights?: SubtitleHighlight[],
): { x: number; y: number; width: number; height: number } => {
  const opacity = style.opacity ?? 1;
  if (opacity < 1) {
    let layer = opacityLayers.get(ctx);
    if (!layer) {
      layer = document.createElement('canvas').getContext('2d')!;
      opacityLayers.set(ctx, layer);
    }
    if (layer.canvas.width !== width) layer.canvas.width = width;
    if (layer.canvas.height !== height) layer.canvas.height = height;
    layer.clearRect(0, 0, width, height);
    const box = drawSubtitlesToCanvas(layer, text, { ...style, opacity: 1 }, width, height, highlights);
    ctx.save();
    ctx.globalAlpha *= opacity;
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
    return box;
  }
  const { fontSize, fontFamily, textColor, backgroundColor, backgroundOpacity, position } = style;
  ctx.save();
  
  const isPortrait = height > width;
  const sizeRef = Math.min(width, height);
  const scale = sizeRef / 400; 
  const baseFontSize = fontSize * scale * 0.9;
  const zoom = style.scale ?? 1;
  const rotation = (style.rotation ?? 0) * Math.PI / 180;
  const maxWidth = (isPortrait ? width * 0.82 : width * 0.7) / Math.max(1, zoom);

  let scaledFontSize = baseFontSize;
  let lines: string[] = [];

  // Shrink only when needed so a long translation remains inside the frame.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${scaledFontSize}px ${fontFamily}`;
    if (style.letterSpacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${style.letterSpacing * scale}px`;
    lines = text.split(/\r?\n/).flatMap(line => wrapCanvasText(ctx, line, maxWidth));
    if (lines.length <= 4 || scaledFontSize <= baseFontSize * 0.6) break;
    scaledFontSize *= 0.9;
  }

  const alignment = style.alignment ?? 'center';
  ctx.textAlign = alignment;
  ctx.textBaseline = 'middle';

  const lineHeight = scaledFontSize * (style.lineSpacing ?? 1.3);
  const totalHeight = lines.length * lineHeight;
  const padding = scaledFontSize * 0.5;
  
  const margin = 8 * scale;
  const boxWidth = Math.min(width - 2 * margin, Math.max(...lines.map(line => ctx.measureText(line).width)) + padding * 4);
  const boxHeight = totalHeight + padding * 2;
  const defaultMargin = Math.max(height * 0.08, 40 * scale);
  const defaultY = position === 'bottom' ? height - defaultMargin - totalHeight / 2 : defaultMargin + totalHeight / 2;
  const clampCenter = (value: number, extent: number, size: number) => {
    const min = Math.min(extent / 2, size / 2 + margin);
    return Math.max(min, Math.min(extent - min, value));
  };
  const cosine = Math.abs(Math.cos(rotation));
  const sine = Math.abs(Math.sin(rotation));
  const boundsWidth = zoom * (cosine * boxWidth + sine * boxHeight);
  const boundsHeight = zoom * (sine * boxWidth + cosine * boxHeight);
  const xBase = clampCenter((style.anchor?.x ?? 0.5) * width, width, boundsWidth);
  const yBase = clampCenter(style.anchor ? style.anchor.y * height : defaultY, height, boundsHeight);
  const boxX = xBase - boxWidth / 2;
  const boxY = yBase - boxHeight / 2;
  ctx.translate(xBase, yBase);
  ctx.rotate(rotation);
  ctx.scale(zoom, zoom);
  ctx.translate(-xBase, -yBase);

  // Draw background box
  if (style.showBackground) {
    ctx.fillStyle = hexToRgba(backgroundColor, backgroundOpacity);
    ctx.beginPath();
    const boxW = boxWidth;
    const boxH = boxHeight;
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

  const markedLines = highlights?.length ? lineHighlights(text, lines, highlights) : [];
  lines.forEach((line, i) => {
    const firstLetter = line.match(/\p{Letter}/u)?.[0] ?? '';
    ctx.direction = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/.test(firstLetter) ? 'rtl' : 'ltr';
    const x = alignment === 'left' ? boxX + padding * 2 :
      alignment === 'right' ? boxX + boxWidth - padding * 2 : xBase;
    const y = yBase - (totalHeight / 2) + (lineHeight / 2) + (i * lineHeight);
    const textWidth = ctx.measureText(line.trim()).width;
    const left = alignment === 'left' ? x : alignment === 'right' ? x - textWidth : x - textWidth / 2;
    if (markedLines[i]?.length) drawHighlights(ctx, line, markedLines[i], left, y, scaledFontSize);
    
    if (style.textOutline) {
      ctx.lineWidth = 1.5 * scale;
      ctx.strokeStyle = '#000000';
      ctx.strokeText(line.trim(), x, y);
    }
    
    ctx.fillStyle = textColor;
    ctx.fillText(line.trim(), x, y);
    if (style.underline) {
      ctx.fillRect(left, y + scaledFontSize * 0.48, textWidth, Math.max(scale, scaledFontSize * 0.055));
    }
  });
  ctx.restore();
  ctx.restore();
  return { x: (xBase - boundsWidth / 2) / width, y: (yBase - boundsHeight / 2) / height,
    width: boundsWidth / width, height: boundsHeight / height };
};
