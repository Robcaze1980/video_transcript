import { useLayoutEffect, useRef, useState } from 'react';
import type { SubtitleHighlight, SubtitleStyle } from '../types';
import { drawSubtitlesToCanvas } from '../utils/helpers';

type Anchor = NonNullable<SubtitleStyle['anchor']>;

interface CaptionOverlayProps {
  text: string;
  highlights?: SubtitleHighlight[];
  style: SubtitleStyle;
  videoSize: { width: number; height: number };
  onMove: (anchor: Anchor) => void;
  labels?: { inactive: string; move: string; help: string };
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const arrows: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

export function CaptionOverlay({ text, highlights, style, videoSize, onMove, labels }: CaptionOverlayProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ pointerId: number; offset: Anchor } | null>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState<ReturnType<typeof drawSubtitlesToCanvas> | null>(null);

  useLayoutEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const scale = Math.min(entry.contentRect.width / videoSize.width, entry.contentRect.height / videoSize.height);
      setFrame({ width: videoSize.width * scale, height: videoSize.height * scale });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [videoSize]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    setBounds(text.trim()
      ? drawSubtitlesToCanvas(context, text, style, canvas.width, canvas.height, highlights)
      : null);
  }, [text, highlights, style, videoSize]);

  const point = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return null;
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  };

  return (
    <div ref={frameRef} className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="relative shrink-0" style={frame}>
        <canvas ref={canvasRef} width={videoSize.width} height={videoSize.height}
          className="absolute inset-0 w-full h-full" role="img" aria-label={text || labels?.inactive || 'No active subtitle'} />
        {bounds && (
          <button type="button" aria-label={labels?.move ?? 'Move subtitle'} title={labels?.help ?? 'Drag to move subtitle, or use arrow keys'}
            className="absolute pointer-events-auto touch-none cursor-grab active:cursor-grabbing rounded border border-transparent hover:border-white focus-visible:border-white"
            style={{
              left: `${bounds.x * 100}%`, top: `${bounds.y * 100}%`,
              width: `${bounds.width * 100}%`, height: `${bounds.height * 100}%`,
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || drag.current) return;
              const position = point(event.clientX, event.clientY);
              if (!position) return;
              drag.current = {
                pointerId: event.pointerId,
                offset: { x: position.x - bounds.x - bounds.width / 2, y: position.y - bounds.y - bounds.height / 2 },
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const active = drag.current;
              if (!active || active.pointerId !== event.pointerId) return;
              const position = point(event.clientX, event.clientY);
              if (position) onMove({ x: clamp(position.x - active.offset.x), y: clamp(position.y - active.offset.y) });
            }}
            onLostPointerCapture={() => { drag.current = null; }}
            onKeyDown={(event) => {
              const delta = arrows[event.key];
              if (!delta) return;
              event.preventDefault();
              onMove({
                x: clamp(bounds.x + bounds.width / 2 + delta[0] * 0.02),
                y: clamp(bounds.y + bounds.height / 2 + delta[1] * 0.02),
              });
            }}
          />
        )}
      </div>
    </div>
  );
}
