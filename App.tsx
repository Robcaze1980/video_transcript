
import React, { useState, useRef, useEffect } from 'react';
import {
  AppState,
  ProcessingProgress,
  Subtitle,
  SubtitleStyle,
  TranscriptionReport,
  UploadedVideoSource,
} from './types';
import {
  deleteVideoSource,
  getApiAccess,
  uploadVideoSource,
} from './services/geminiClient';
import {
  TranscriptionSession,
  transcribeRangeWithSource,
} from './services/transcriptionSession';
import {
  generateSRT,
  parseSRT,
  downloadFile,
  downloadBlob,
  formatTime,
  drawSubtitlesToCanvas,
  hexToRgba,
} from './utils/helpers';
import {
  findActiveSubtitle,
  getPrimarySpeaker,
  mergeSubtitleCues,
} from './utils/subtitles';
import { formatApiError, isAbortError, readVideoDuration } from './utils/media';
import { convertWebmToMp4 } from './utils/ffmpegUtil';
import { recordVideoWithSubtitles } from './utils/videoExport';

const DEFAULT_STYLE: SubtitleStyle = {
  fontSize: 20,
  fontFamily: 'sans-serif',
  textColor: '#ffff00',
  backgroundColor: '#000000',
  backgroundOpacity: 0.7,
  position: 'bottom',
  showBackground: true,
  textOutline: false,
  textShadow: true,
};

const FONT_OPTIONS = [
  { name: 'Sans Serif', value: 'sans-serif' },
  { name: 'Serif', value: 'serif' },
  { name: 'Monospace', value: 'monospace' },
  { name: 'Rounded', value: 'ui-rounded, sans-serif' },
  { name: 'Impact', value: 'Impact, sans-serif' },
];

const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Chinese', 'Japanese', 'Arabic', 'Portuguese', 'Italian', 'Russian'];

const MAX_FILE_SIZE_MB = 300;

type Tab = 'video' | 'transcript' | 'style';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState<Subtitle | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [sourceLang, setSourceLang] = useState('Auto-detect');
  const [targetLang, setTargetLang] = useState('English');
  const [error, setError] = useState<string | null>(null);
  const [apiMessage, setApiMessage] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(DEFAULT_STYLE);
  const [activeTab, setActiveTab] = useState<Tab>('video');
  const [exportProgress, setExportProgress] = useState(0);
  const [isConverting, setIsConverting] = useState(false);
  const [convertProgress, setConvertProgress] = useState(0);
  const [exportWarning, setExportWarning] = useState<string | null>(null);
  const [lastExportedBlob, setLastExportedBlob] = useState<Blob | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null);
  const [continuousMode, setContinuousMode] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null);
  const [transcriptionReport, setTranscriptionReport] = useState<TranscriptionReport | null>(null);
  const [transcriptionWarning, setTranscriptionWarning] = useState<string | null>(null);
  const [isRetryingSections, setIsRetryingSections] = useState(false);
  const [aiTranscribingGapKey, setAiTranscribingGapKey] = useState<string | null>(null);
  const [gapMessage, setGapMessage] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [inlineGapKey, setInlineGapKey] = useState<string | null>(null);
  const [inlineGapText, setInlineGapText] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoUrlRef = useRef<string | null>(null);
  const transcriptionSessionRef = useRef<TranscriptionSession | null>(null);
  const uploadedSourceRef = useRef<UploadedVideoSource | null>(null);
  const processingAbortRef = useRef<AbortController | null>(null);
  const gapJobInFlightRef = useRef(false);

  const refreshApiAccess = async () => {
    const access = await getApiAccess();
    setHasKey(access.available);
    setApiMessage(access.message);
  };

  useEffect(() => {
    void refreshApiAccess();
    return () => {
      processingAbortRef.current?.abort();
      transcriptionSessionRef.current = null;
      const source = uploadedSourceRef.current;
      uploadedSourceRef.current = null;
      void deleteVideoSource(source);
      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
        videoUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!currentSubtitle) return;
    const latest = subtitles.find((subtitle) => subtitle.id === currentSubtitle.id) || null;
    if (latest !== currentSubtitle) setCurrentSubtitle(latest);
  }, [subtitles, currentSubtitle]);

  useEffect(() => {
    if (!videoRef.current) return;
    setCurrentSubtitle(
      findActiveSubtitle(subtitles, videoRef.current.currentTime, continuousMode)
    );
  }, [continuousMode]);

  const handleOpenKey = async () => {
    const aistudio = (window as unknown as {
      aistudio?: { openSelectKey?: () => Promise<void> };
    }).aistudio;
    if (!aistudio?.openSelectKey) {
      setError(apiMessage || 'Configure GEMINI_API_KEY in .env.local and restart the app.');
      return;
    }
    await aistudio.openSelectKey();
    await refreshApiAccess();
  };

  const disposeCurrentSource = () => {
    const source = uploadedSourceRef.current;
    uploadedSourceRef.current = null;
    transcriptionSessionRef.current = null;
    void deleteVideoSource(source);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(
        `File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Please choose a clip under ${MAX_FILE_SIZE_MB}MB.`
      );
      setState(AppState.ERROR);
      return;
    }
    if (!file.type.startsWith('video/')) {
      setError('Please select a supported video file.');
      setState(AppState.ERROR);
      return;
    }

    processingAbortRef.current?.abort();
    disposeCurrentSource();
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);

    const nextUrl = URL.createObjectURL(file);
    videoUrlRef.current = nextUrl;
    setVideoFile(file);
    setVideoUrl(nextUrl);
    setState(AppState.IDLE);
    setSubtitles([]);
    setCurrentSubtitle(null);
    setCurrentTime(0);
    setTranscriptionReport(null);
    setTranscriptionWarning(null);
    setProcessingProgress(null);
    setLastExportedBlob(null);
    setExportWarning(null);
    setError(null);
    setActiveTab('video');
  };

  const handleProgress = (progress: ProcessingProgress) => {
    setProcessingProgress({
      ...progress,
      percent: Math.min(100, Math.max(0, 25 + Math.round(progress.percent * 0.7))),
    });
  };

  const applyTranscriptionResult = (
    result: Awaited<ReturnType<TranscriptionSession['transcribePending']>>
  ) => {
    setSubtitles(result.subtitles);
    setTranscriptionReport(result.report);

    if (result.report.failedSections > 0) {
      setTranscriptionWarning(
        `${result.report.failedSections} section${result.report.failedSections === 1 ? '' : 's'} could not be transcribed. Review the coverage report and retry failed sections.`
      );
    } else if (result.subtitles.length === 0) {
      setTranscriptionWarning('No human speech was detected in any section.');
    } else if (result.report.uncaptionedRanges.length > 0) {
      setTranscriptionWarning(
        `${result.report.uncaptionedRanges.length} range${result.report.uncaptionedRanges.length === 1 ? '' : 's'} contain no subtitle cues. They may be silence, but they can also contain missed speech.`
      );
    } else {
      setTranscriptionWarning(null);
    }
  };

  const startProcessing = async () => {
    if (!videoFile) return;
    const controller = new AbortController();
    processingAbortRef.current = controller;

    try {
      setError(null);
      setSubtitles([]);
      setTranscriptionReport(null);
      setTranscriptionWarning(null);
      setState(AppState.PROCESSING);
      setProcessingProgress({
        phase: 'upload',
        percent: 0,
        completedSections: 0,
        totalSections: 0,
        message: 'Reading video metadata...',
      });

      const duration = await readVideoDuration(videoFile);
      setProcessingProgress({
        phase: 'upload',
        percent: 2,
        completedSections: 0,
        totalSections: 0,
        message: 'Uploading the video once through Files API...',
      });

      const session = await TranscriptionSession.create({
        file: videoFile,
        duration,
        targetLanguage: targetLang,
        sourceLanguage: sourceLang,
        existingSource: uploadedSourceRef.current,
        signal: controller.signal,
        onUploadProgress: (fraction) => {
          setProcessingProgress({
            phase: 'upload',
            percent: Math.round(fraction * 25),
            completedSections: 0,
            totalSections: 0,
            message: `Uploading video: ${Math.round(fraction * 100)}%`,
          });
        },
      });

      if (controller.signal.aborted) {
        await deleteVideoSource(session.source);
        return;
      }

      uploadedSourceRef.current = session.source;
      transcriptionSessionRef.current = session;

      const result = await session.transcribePending({
        signal: controller.signal,
        onProgress: handleProgress,
      });

      setProcessingProgress({
        phase: 'merge',
        percent: 98,
        completedSections: result.report.completedSections,
        totalSections: result.report.sections.length,
        message: 'Validating and merging subtitle sections...',
      });
      applyTranscriptionResult(result);
      setProcessingProgress(null);
      setState(AppState.REVIEW);
      setActiveTab('transcript');
    } catch (err) {
      console.error(err);
      setProcessingProgress(null);
      if (isAbortError(err)) {
        setState(AppState.IDLE);
        return;
      }
      setError(formatApiError(err));
      setState(AppState.ERROR);
    } finally {
      if (processingAbortRef.current === controller) processingAbortRef.current = null;
    }
  };

  const retryFailedSections = async () => {
    const session = transcriptionSessionRef.current;
    if (!session || isRetryingSections) return;

    setIsRetryingSections(true);
    setError(null);
    try {
      const result = await session.retryFailed({ onProgress: handleProgress });
      applyTranscriptionResult(result);
      setGapMessage('Failed sections were retried. Review the remaining coverage warnings.');
      window.setTimeout(() => setGapMessage(null), 5000);
    } catch (err) {
      if (!isAbortError(err)) setError(formatApiError(err));
    } finally {
      setIsRetryingSections(false);
      setProcessingProgress(null);
    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const time = videoRef.current.currentTime;
    const active = findActiveSubtitle(subtitles, time, continuousMode);
    setCurrentTime(time);

    if (active?.id !== currentSubtitle?.id) {
      setCurrentSubtitle(active);
      if (active && transcriptRef.current) {
        const activeElement = document.getElementById(active.id);
        if (activeElement) {
          activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  };

  const burnAndExport = async (targetFormat: 'mp4' | 'fast' = 'mp4') => {
    if (!videoRef.current || !videoUrl || !exportCanvasRef.current || subtitles.length === 0) {
      setError('Export requirements not met. Load video and subtitles first.');
      return;
    }

    setState(AppState.EXPORTING);
    setActiveTab('video');
    setExportProgress(0);
    setIsConverting(false);
    setExportWarning(null);

    try {
      const recorded = await recordVideoWithSubtitles({
        video: videoRef.current,
        canvas: exportCanvasRef.current,
        subtitles,
        style: subtitleStyle,
        continuousMode,
        onProgress: setExportProgress,
      });
      setLastExportedBlob(recorded.blob);

      if (!recorded.audioCaptured) {
        setExportWarning('Audio capture was unavailable. The exported video is silent.');
      }

      if (targetFormat === 'mp4' && recorded.ext === 'webm') {
        setIsConverting(true);
        setConvertProgress(0);
        try {
          const mp4Blob = await convertWebmToMp4(recorded.blob, (progress) => {
            setConvertProgress(progress * 100);
          });
          downloadBlob(mp4Blob, 'linguist_vision_export.mp4');
        } catch (conversionError) {
          console.error('Failed to convert to MP4', conversionError);
          setError('MP4 conversion failed. The WebM file was downloaded instead.');
          downloadBlob(recorded.blob, 'linguist_vision_export.webm');
        }
      } else {
        downloadBlob(recorded.blob, `linguist_vision_export.${recorded.ext}`);
        if (recorded.ext === 'webm') {
          setExportWarning(
            'The browser exported WebM. Some WhatsApp or SMS clients may not play this format.'
          );
        }
      }
    } catch (exportError) {
      if (!isAbortError(exportError)) setError(formatApiError(exportError));
    } finally {
      setIsConverting(false);
      setState(AppState.REVIEW);
    }
  };

  const updateSubtitleText = (id: string, newText: string) => {
    setSubtitles(subs => subs.map(s => s.id === id ? { ...s, translatedText: newText } : s));
  };

  const handleUpdateSubtitle = (id: string, updates: Partial<Subtitle>) => {
    setSubtitles(subs => subs.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const handleAddSubtitle = (targetStart?: number, targetEnd?: number) => {
    const videoDuration = videoRef.current?.duration || Number.POSITIVE_INFINITY;
    const start =
      targetStart !== undefined
        ? Number(targetStart)
        : Number((videoRef.current?.currentTime || 0).toFixed(3));
    let end =
      targetEnd !== undefined
        ? Number(targetEnd)
        : Number.isFinite(videoDuration)
          ? Math.min(videoDuration, start + 2.5)
          : start + 2.5;

    if (
      !Number.isFinite(start) ||
      start < 0 ||
      (Number.isFinite(videoDuration) && start >= videoDuration)
    ) {
      setError('A subtitle cannot start outside the video.');
      return;
    }
    end = Math.min(videoDuration, Math.max(start + 0.3, end));
    if (!Number.isFinite(end) || end <= start) {
      setError('A subtitle needs a valid start and end time.');
      return;
    }

    const newSub: Subtitle = {
      id: `manual-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      originalText: '',
      translatedText: 'New subtitle text...',
      speaker: 'Speaker',
    };
    setSubtitles((previous) => mergeSubtitleCues([...previous, newSub], videoDuration));
    setTranscriptionReport(null);
    setEditingId(newSub.id);
    jumpToTime(newSub.start);
  };

  const handleInsertAfter = (sub: Subtitle, nextSub?: Subtitle) => {
    const start = sub.end;
    const end = nextSub ? nextSub.start : start + 2.5;
    if (end - start < 0.25) {
      setError('There is no room between these subtitles. Move the next cue first.');
      return;
    }
    handleAddSubtitle(start, end);
  };

  const handleBridgeAllGaps = () => {
    setSubtitles((previous) => {
      const sorted = [...previous].sort((a, b) => a.start - b.start);
      return sorted.map((subtitle, index) => {
        const next = sorted[index + 1];
        if (next && next.start > subtitle.end) {
          return { ...subtitle, end: Number(next.start.toFixed(3)) };
        }
        return subtitle;
      });
    });
    setTranscriptionReport(null);
    setGapMessage(
      'Cues were extended across gaps. This changes timing only; missing dialogue still requires transcription.'
    );
    window.setTimeout(() => setGapMessage(null), 7000);
  };

  const handleBridgeSingleGap = (subId: string, nextSubStart: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!Number.isFinite(nextSubStart)) return;
    setSubtitles((previous) =>
      previous.map((subtitle) =>
        subtitle.id === subId && nextSubStart > subtitle.start + 0.1
          ? { ...subtitle, end: Number(nextSubStart.toFixed(3)) }
          : subtitle
      )
    );
    setTranscriptionReport(null);
    setGapMessage('Cue timing extended. No transcript text was invented.');
    window.setTimeout(() => setGapMessage(null), 5000);
  };

  const handleAddInlineGapCue = (gapStart: number, gapEnd: number) => {
    const text = inlineGapText.trim();
    if (!text) return;
    const videoDuration = videoRef.current?.duration || Number.POSITIVE_INFINITY;
    const start = Math.max(0, Math.min(gapStart, videoDuration));
    const end = Math.min(videoDuration, Math.max(start + 0.25, gapEnd));
    if (end <= start) {
      setError('The selected gap is too short for a subtitle.');
      return;
    }
    const newSub: Subtitle = {
      id: `manual-gap-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      originalText: '',
      translatedText: text,
      speaker: 'Speaker',
    };
    setSubtitles((previous) => mergeSubtitleCues([...previous, newSub], videoDuration));
    setTranscriptionReport(null);
    setInlineGapKey(null);
    setInlineGapText('');
    setGapMessage('Subtitle added to the selected gap.');
    window.setTimeout(() => setGapMessage(null), 4000);
  };

  const getOrCreateVideoSource = async (): Promise<UploadedVideoSource> => {
    if (uploadedSourceRef.current) return uploadedSourceRef.current;
    if (!videoFile) throw new Error('Load a video before transcribing a gap.');
    const source = await uploadVideoSource(videoFile);
    uploadedSourceRef.current = source;
    return source;
  };

  const handleApplyImportedSRT = () => {
    if (!importText.trim()) return;
    const parsed = parseSRT(importText);
    if (parsed.length > 0) {
      if (
        subtitles.length > 0 &&
        !window.confirm('Replace the current subtitles with this SRT import?')
      ) {
        return;
      }
      setSubtitles(parsed);
      setTranscriptionReport(null);
      setTranscriptionWarning(null);
      setShowImportModal(false);
      setImportText('');
      setGapMessage(`Imported ${parsed.length} subtitles successfully!`);
      setTimeout(() => setGapMessage(null), 5000);
    } else {
      setError("Could not parse subtitles. Please ensure timestamps are in format: 00:00:01 --> 00:00:04");
    }
  };

  const handleImportSRTFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const parsed = parseSRT(content);
        if (parsed.length > 0) {
          if (
            subtitles.length > 0 &&
            !window.confirm('Replace the current subtitles with this SRT file?')
          ) {
            return;
          }
          setSubtitles(parsed);
          setTranscriptionReport(null);
          setTranscriptionWarning(null);
          setShowImportModal(false);
          setGapMessage(`Imported ${parsed.length} subtitles from file!`);
          setTimeout(() => setGapMessage(null), 5000);
        } else {
          setError("No valid subtitle cues found in file.");
        }
      }
    };
    reader.readAsText(file);
  };

  const handleAiTranscribeGap = async (sub: Subtitle, nextSub: Subtitle, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!videoFile || gapJobInFlightRef.current) return;
    if (nextSub.start - sub.end < 0.2) {
      setError('The selected gap is too short to transcribe.');
      return;
    }

    const gapKey = `${sub.id}_${nextSub.id}`;
    gapJobInFlightRef.current = true;
    setAiTranscribingGapKey(gapKey);
    setGapMessage(null);
    setError(null);

    try {
      const source = await getOrCreateVideoSource();
      const duration = videoRef.current?.duration || (await readVideoDuration(videoFile));
      const result = await transcribeRangeWithSource(source, {
        start: sub.end,
        end: nextSub.start,
        duration,
        targetLanguage: targetLang,
        sourceLanguage: sourceLang,
      });

      if (!result.hasSpeech || result.cues.length === 0) {
        setGapMessage('Gemini found no human speech in this gap. No subtitles were changed.');
      } else {
        const newSubtitles: Subtitle[] = result.cues.map((cue, index) => ({
          ...cue,
          id: `ai-gap-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 6)}`,
          speaker: cue.speaker || getPrimarySpeaker(sub.speaker),
        }));
        setSubtitles((previous) =>
          mergeSubtitleCues([...previous, ...newSubtitles], duration)
        );
        setTranscriptionReport(null);
        setGapMessage(
          `Added ${newSubtitles.length} recovered subtitle cue${newSubtitles.length === 1 ? '' : 's'} to the gap.`
        );
      }
    } catch (err) {
      if (!isAbortError(err)) {
        const message = formatApiError(err);
        setError(`Gap transcription failed: ${message}`);
        setGapMessage('The gap was left unchanged. Fix the error and retry.');
      }
    } finally {
      gapJobInFlightRef.current = false;
      setAiTranscribingGapKey(null);
      window.setTimeout(() => setGapMessage(null), 7000);
    }
  };

  const handleDeleteSubtitle = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSubtitles(prev => prev.filter(s => s.id !== id));
    if (editingId === id) setEditingId(null);
    if (currentSubtitle?.id === id) setCurrentSubtitle(null);
  };

  const handleUpdateSubtitleTime = (id: string, field: 'start' | 'end', val: number) => {
    if (!Number.isFinite(val)) return;
    const targetIndex = subtitles.findIndex((subtitle) => subtitle.id === id);
    if (targetIndex < 0) return;

    const target = subtitles[targetIndex];
    const previous = subtitles[targetIndex - 1];
    const next = subtitles[targetIndex + 1];
    const videoDuration = videoRef.current?.duration || Number.POSITIVE_INFINITY;
    const cleanValue = Number(
      Math.min(videoDuration, Math.max(0, val)).toFixed(3)
    );

    if (field === 'start') {
      if (cleanValue >= target.end - 0.05) {
        setError('Start time must be lower than end time. Adjust the end time first.');
        return;
      }
      if (previous && cleanValue < previous.end + 0.05) {
        setError('This cue cannot overlap the previous subtitle.');
        return;
      }
    } else {
      if (cleanValue <= target.start + 0.05) {
        setError('End time must be greater than start time.');
        return;
      }
      if (next && cleanValue > next.start - 0.05) {
        setError('This cue cannot overlap the next subtitle.');
        return;
      }
    }

    setSubtitles((current) =>
      current
        .map((subtitle) =>
          subtitle.id === id
            ? { ...subtitle, [field]: cleanValue }
            : subtitle
        )
        .sort((a, b) => a.start - b.start)
    );
    setTranscriptionReport(null);
  };

  const handleSetTimeToCurrent = (id: string, field: 'start' | 'end', e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!videoRef.current) return;
    const current = Number(videoRef.current.currentTime.toFixed(3));
    handleUpdateSubtitleTime(id, field, current);
  };

  const jumpToTime = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, time);
      void videoRef.current.play().catch(() => undefined);
      setActiveTab('video');
    }
  };

  const handleConvertToMp4 = async () => {
    if (!lastExportedBlob) return;
    setIsConverting(true);
    setConvertProgress(0);
    try {
      const mp4Blob = await convertWebmToMp4(lastExportedBlob, (progress) => {
        setConvertProgress(progress * 100);
      });
      downloadBlob(mp4Blob, 'linguist_vision_export_converted.mp4');
      setExportWarning(null); // Clear warning after successful conversion
    } catch (e) {
      console.error("Failed to convert to MP4", e);
      setError("Failed to convert the video to MP4. Please try again.");
    } finally {
      setIsConverting(false);
    }
  };

  if (!hasKey) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-950 p-6 text-center">
        <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mb-6 shadow-2xl shadow-indigo-500/20">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778z"/><path d="M12 12l.663-.663"/><path d="M18 10l-2-2"/><path d="M22 6l-2-2"/></svg>
        </div>
        <h1 className="text-2xl font-bold mb-4">Gemini API Key Required</h1>
        <p className="text-slate-400 max-w-md mb-3 text-sm leading-relaxed">
          {apiMessage || 'Configure GEMINI_API_KEY in .env.local and run npm run dev.'}
        </p>
        <p className="text-slate-500 max-w-md mb-8 text-xs leading-relaxed">
          The local server keeps the key out of the browser bundle. AI Studio users can instead
          select a key from a billing-enabled project.
        </p>
        <button 
          onClick={handleOpenKey}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-full font-bold shadow-xl active:scale-95 transition-all"
        >
          SELECT AI STUDIO KEY
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      <header className="h-14 border-b border-slate-800 bg-slate-900/90 backdrop-blur-xl px-4 flex items-center justify-between shrink-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded flex items-center justify-center shadow-lg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m16 16 3-8 3 8"/><path d="M17 14h4"/><path d="M7 2h1"/><path d="m2 22 5-10 5 10"/><path d="M14 18h1"/><path d="M2 5h12"/></svg>
          </div>
          <h1 className="text-sm font-bold tracking-tight">LinguistVision</h1>
        </div>
        {videoUrl && state === AppState.REVIEW && (
          <div className="flex gap-2">
            <button onClick={() => burnAndExport('mp4')} className="bg-[#25D366] hover:bg-[#128C7E] text-white px-3 md:px-4 py-1.5 md:py-2 rounded-full text-[9px] md:text-[10px] font-black uppercase flex items-center gap-1.5 shadow-lg active:scale-95 transition-all">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Save for WhatsApp
            </button>
            <button onClick={() => burnAndExport('fast')} className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-full text-[10px] font-black uppercase flex items-center gap-1 shadow-lg active:scale-95 transition-all hidden md:flex">
              Fast Download (WebM)
            </button>
          </div>
        )}
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative min-h-0">
        <div className={`flex-1 flex flex-col bg-slate-950 p-2 md:p-6 min-h-0 ${activeTab === 'video' ? 'flex' : 'hidden md:flex'}`}>
          {!videoUrl && state !== AppState.ERROR ? (
            <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
              <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center mb-3 text-slate-500">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </div>
              <h2 className="text-sm font-bold mb-1">Select Video</h2>
              <p className="text-slate-500 text-[10px] mb-4 text-center px-6">Maximum {MAX_FILE_SIZE_MB}MB video files supported.</p>
              <label className="bg-white text-slate-950 px-6 py-2 rounded-full text-xs font-black cursor-pointer shadow-xl active:scale-95">
                CHOOSE
                <input type="file" className="hidden" accept="video/*" onChange={handleFileChange} />
              </label>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 space-y-3">
              <div className="flex-1 min-h-0 relative bg-black rounded-xl border border-slate-800 shadow-2xl overflow-hidden group flex items-center justify-center">
                {videoUrl && (
                  <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
                    <video 
                      ref={videoRef}
                      src={videoUrl} 
                      className={`max-w-full max-h-full object-contain ${state === AppState.EXPORTING ? 'opacity-30' : ''}`}
                      onTimeUpdate={handleTimeUpdate}
                      onLoadedMetadata={(e) => {
                        const target = e.target as HTMLVideoElement;
                        if (target.videoWidth && target.videoHeight) {
                          setVideoAspectRatio(target.videoWidth / target.videoHeight);
                        }
                      }}
                      playsInline
                      controls={state !== AppState.EXPORTING}
                    />
                    
                    {currentSubtitle && state !== AppState.EXPORTING && (
                      <div className={`absolute ${subtitleStyle.position === 'bottom' ? 'bottom-16 md:bottom-20' : 'top-6 md:top-10'} left-0 right-0 px-4 pointer-events-none transition-all flex justify-center w-full z-30`}>
                        <div 
                          className={`px-4 py-2 rounded-lg max-w-[92%] md:max-w-[70%] text-center ${subtitleStyle.showBackground ? 'backdrop-blur-sm shadow-2xl' : ''}`}
                          style={{
                            backgroundColor: subtitleStyle.showBackground ? hexToRgba(subtitleStyle.backgroundColor, subtitleStyle.backgroundOpacity) : 'transparent',
                            color: subtitleStyle.textColor,
                            fontSize: `${Math.max(14, subtitleStyle.fontSize * 0.9)}px`,
                            fontFamily: subtitleStyle.fontFamily,
                            textShadow: subtitleStyle.textShadow ? '2px 2px 4px rgba(0,0,0,0.85)' : 'none',
                            WebkitTextStroke: subtitleStyle.textOutline ? '1.5px #000' : 'none',
                          }}
                        >
                          <p dir="auto" className="font-semibold leading-snug">
                            {currentSubtitle.translatedText}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <canvas ref={exportCanvasRef} className="fixed top-0 left-0 opacity-0 pointer-events-none -z-50" />
                
                {(state === AppState.PROCESSING || state === AppState.EXPORTING) && (
                  <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center z-10 p-4 text-center">
                    <div className="relative w-12 h-12 mb-3">
                      <div className="absolute inset-0 border-3 border-indigo-500/20 rounded-full"></div>
                      <div className="absolute inset-0 border-3 border-indigo-500 rounded-full animate-spin border-t-transparent"></div>
                    </div>
                    <h3 className="text-xs font-bold text-white mb-1 text-center">
                      {state === AppState.PROCESSING
                        ? processingProgress?.message || 'Preparing transcription...'
                        : isConverting
                          ? 'Converting to MP4 format...'
                          : 'Burning Subtitles...'}
                    </h3>
                    <div className="w-full max-w-xs bg-slate-800 rounded-full h-1.5 overflow-hidden mt-2">
                      <div
                        className="bg-indigo-500 h-1.5 transition-all"
                        style={{
                          width: `${Math.max(
                            2,
                            state === AppState.PROCESSING
                              ? processingProgress?.percent || 0
                              : isConverting
                                ? convertProgress
                                : exportProgress
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="text-[10px] font-mono text-indigo-400 mt-2">
                      {state === AppState.PROCESSING
                        ? `${Math.round(processingProgress?.percent || 0)}%`
                        : `${Math.round(isConverting ? convertProgress : exportProgress)}% Done`}
                    </div>
                    {state === AppState.PROCESSING && (
                      <button
                        onClick={() => processingAbortRef.current?.abort()}
                        className="mt-3 text-[9px] font-bold uppercase tracking-wider text-slate-300 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg"
                      >
                        Cancel
                      </button>
                    )}
                    <p className="text-[9px] text-slate-500 mt-2 text-center max-w-xs">
                      {state === AppState.EXPORTING
                        ? 'Keep this tab active while the video records in real time.'
                        : 'Each section is validated and retried independently.'}
                    </p>
                  </div>
                )}
              </div>

              {state === AppState.IDLE && videoUrl && (
                <div className="shrink-0 bg-slate-900 border border-slate-800 p-3 rounded-2xl shadow-xl space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest pl-1">Original Audio</label>
                      <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} className="w-full bg-slate-800 text-[11px] font-bold p-2.5 rounded-xl border border-slate-700 outline-none">
                        <option value="Auto-detect">Detect Automatically</option>
                        {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest pl-1">Subtitle Language</label>
                      <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} className="w-full bg-slate-800 text-[11px] font-bold p-2.5 rounded-xl border border-slate-700 outline-none">
                        {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>
                  </div>
                  <button onClick={startProcessing} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl text-xs font-black tracking-widest active:scale-[0.98] shadow-lg transition-all">
                    GENERATE SUBTITLES
                  </button>
                </div>
              )}

              {state === AppState.REVIEW && (
                <div className="flex flex-col gap-3 shrink-0">
                  <div className="h-4 bg-slate-900 rounded-full border border-slate-800 relative overflow-hidden shrink-0">
                    {subtitles.map(sub => (
                      <div 
                        key={sub.id}
                        className={`absolute top-0 bottom-0 ${currentSubtitle?.id === sub.id ? 'bg-indigo-500' : 'bg-indigo-500/20'}`}
                        style={{ 
                          left: `${(sub.start / (videoRef.current?.duration || 1)) * 100}%`,
                          width: `${((sub.end - sub.start) / (videoRef.current?.duration || 1)) * 100}%`
                        }}
                      />
                    ))}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-20 pointer-events-none"
                      style={{
                        left: `${(currentTime / (videoRef.current?.duration || 1)) * 100}%`,
                      }}
                    />
                  </div>
                  {transcriptionWarning && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-2">
                      <p className="text-[11px] text-amber-200 leading-relaxed">
                        {transcriptionWarning}
                      </p>
                      {transcriptionReport && (
                        <p className="text-[9px] font-mono text-amber-300/80">
                          {transcriptionReport.completedSections} transcribed ·{' '}
                          {transcriptionReport.noSpeechSections} verified silent ·{' '}
                          {transcriptionReport.failedSections} failed ·{' '}
                          {transcriptionReport.uncaptionedRanges.length} uncaptioned ranges
                        </p>
                      )}
                      {Boolean(transcriptionReport?.failedSections) && (
                        <button
                          onClick={retryFailedSections}
                          disabled={isRetryingSections}
                          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider"
                        >
                          {isRetryingSections ? 'Retrying...' : 'Retry failed sections'}
                        </button>
                      )}
                    </div>
                  )}
                  {isRetryingSections && processingProgress && (
                    <div className="text-[9px] text-indigo-300 font-mono">
                      {processingProgress.message}
                    </div>
                  )}
                  {exportWarning && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-start gap-3">
                      <div className="text-amber-500 mt-0.5">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      </div>
                      <div className="flex-1 space-y-2">
                        <p className="text-xs text-amber-200/90 leading-relaxed">{exportWarning}</p>
                        {isConverting ? (
                          <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
                            <div className="bg-indigo-500 h-1.5 transition-all duration-300" style={{ width: `${convertProgress}%` }} />
                          </div>
                        ) : (
                          <button 
                            onClick={handleConvertToMp4}
                            disabled={!lastExportedBlob}
                            className="text-[10px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg active:scale-95 transition-all mt-1"
                          >
                            CONVERT TO MP4
                          </button>
                        )}
                      </div>
                      <button onClick={() => setExportWarning(null)} className="text-amber-500/50 hover:text-amber-500 transition-colors">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className={`md:w-96 border-l border-slate-800 bg-slate-900/40 flex flex-col shrink-0 overflow-hidden ${activeTab === 'video' ? 'hidden md:flex' : 'flex'}`}>
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex border-b border-slate-800 bg-slate-900/60 backdrop-blur-sm shrink-0">
               <button onClick={() => setActiveTab('transcript')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-wider ${activeTab !== 'style' ? 'text-indigo-400 bg-indigo-500/5 border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-300'}`}>Transcript</button>
               <button onClick={() => setActiveTab('style')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-wider ${activeTab === 'style' ? 'text-indigo-400 bg-indigo-500/5 border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-300'}`}>Style</button>
            </div>

            <div ref={transcriptRef} className="flex-1 overflow-y-auto custom-scrollbar p-4 min-h-0">
              {activeTab === 'style' ? (
                <div className="space-y-6">
                  <div className="bg-slate-950/50 rounded-xl overflow-hidden border border-slate-800 relative aspect-video flex items-center justify-center p-4">
                    <span className="absolute top-2 left-3 text-[9px] font-black text-slate-600 uppercase tracking-widest">Live Preview</span>
                    <div 
                      className={`px-4 py-2 rounded-lg max-w-[90%] text-center tracking-wide ${subtitleStyle.showBackground ? 'backdrop-blur-sm shadow-2xl' : ''} ${subtitleStyle.position === 'top' ? 'absolute top-10' : 'absolute bottom-6'}`}
                      style={{
                        backgroundColor: subtitleStyle.showBackground ? hexToRgba(subtitleStyle.backgroundColor, subtitleStyle.backgroundOpacity) : 'transparent',
                        color: subtitleStyle.textColor,
                        fontSize: `${Math.min(subtitleStyle.fontSize * 0.8, 24)}px`,
                        fontFamily: subtitleStyle.fontFamily,
                        textShadow: subtitleStyle.textShadow ? '2px 2px 4px rgba(0,0,0,0.8)' : 'none',
                        WebkitTextStroke: subtitleStyle.textOutline ? '1px #000' : 'none',
                      }}
                    >
                      <p className="font-medium leading-tight select-none">Sample subtitle preview</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Font Family</label>
                    <select value={subtitleStyle.fontFamily} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, fontFamily: e.target.value })} className="w-full bg-slate-800 border border-slate-700 text-xs rounded-lg p-3 outline-none">
                      {FONT_OPTIONS.map(font => <option key={font.value} value={font.value}>{font.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center"><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Size</label><span className="text-[10px] font-mono text-indigo-400">{subtitleStyle.fontSize}px</span></div>
                    <input type="range" min="12" max="64" value={subtitleStyle.fontSize} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, fontSize: parseInt(e.target.value) })} className="w-full h-1 bg-slate-800 rounded-lg appearance-none accent-indigo-500"/>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <span className="text-[9px] font-black text-slate-600 uppercase">Text</span>
                      <input type="color" value={subtitleStyle.textColor} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, textColor: e.target.value })} className="w-full h-10 rounded-lg border-none bg-slate-800 cursor-pointer p-0"/>
                    </div>
                    <div className="space-y-2">
                      <span className="text-[9px] font-black text-slate-600 uppercase">Box</span>
                      <input type="color" value={subtitleStyle.backgroundColor} onChange={(e) => setSubtitleStyle({ ...subtitleStyle, backgroundColor: e.target.value })} className="w-full h-10 rounded-lg border-none bg-slate-800 cursor-pointer p-0"/>
                    </div>
                  </div>
                  <div className="space-y-3 pt-3 border-t border-slate-800">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Effects</label>
                    
                    <div className="flex items-center justify-between bg-slate-800/50 p-3 rounded-xl border border-slate-800">
                      <span className="text-xs font-bold text-slate-300">Background Box</span>
                      <button onClick={() => setSubtitleStyle({...subtitleStyle, showBackground: !subtitleStyle.showBackground})} className={`w-10 h-5 rounded-full relative transition-colors ${subtitleStyle.showBackground ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                        <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${subtitleStyle.showBackground ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between bg-slate-800/50 p-3 rounded-xl border border-slate-800">
                      <span className="text-xs font-bold text-slate-300">Drop Shadow</span>
                      <button onClick={() => setSubtitleStyle({...subtitleStyle, textShadow: !subtitleStyle.textShadow})} className={`w-10 h-5 rounded-full relative transition-colors ${subtitleStyle.textShadow ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                        <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${subtitleStyle.textShadow ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between bg-slate-800/50 p-3 rounded-xl border border-slate-800">
                      <span className="text-xs font-bold text-slate-300">Black Outline</span>
                      <button onClick={() => setSubtitleStyle({...subtitleStyle, textOutline: !subtitleStyle.textOutline})} className={`w-10 h-5 rounded-full relative transition-colors ${subtitleStyle.textOutline ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                        <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${subtitleStyle.textOutline ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3 pt-3 border-t border-slate-800">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Position</label>
                    <div className="flex bg-slate-800 p-1 rounded-xl">
                      <button onClick={() => setSubtitleStyle({ ...subtitleStyle, position: 'top' })} className={`flex-1 py-3 text-[10px] font-bold rounded-lg ${subtitleStyle.position === 'top' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400'}`}>TOP</button>
                      <button onClick={() => setSubtitleStyle({ ...subtitleStyle, position: 'bottom' })} className={`flex-1 py-3 text-[10px] font-bold rounded-lg ${subtitleStyle.position === 'bottom' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400'}`}>BOTTOM</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Status / gap toast message */}
                  {gapMessage && (
                    <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[10px] flex items-center gap-2 animate-fade-in shadow-sm">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-400 shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
                      <span className="flex-1 font-medium">{gapMessage}</span>
                      <button onClick={() => setGapMessage(null)} className="text-emerald-400 hover:text-white text-xs px-1">✕</button>
                    </div>
                  )}

                  {/* Header bar: Count, Bridge All Gaps, Continuous Display, Add Subtitle */}
                  <div className="flex flex-col gap-2 pb-2.5 border-b border-slate-800">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cues</span>
                        <span className="bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full text-[9px] font-mono font-bold">
                          {subtitles.length}
                        </span>
                        {(() => {
                          const gapCount = subtitles.reduce((acc, sub, idx) => {
                            const next = subtitles[idx + 1];
                            return acc + (next && (next.start - sub.end) >= 1.0 ? 1 : 0);
                          }, 0);
                          return gapCount > 0 ? (
                            <span className="bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full text-[9px] font-mono font-bold">
                              {gapCount} gap{gapCount > 1 ? 's' : ''}
                            </span>
                          ) : null;
                        })()}
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        <button
                          onClick={() => setShowImportModal(true)}
                          className="bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/30 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center gap-1 shadow transition-all active:scale-95"
                          title="Import or paste complete SRT subtitle text"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          Import SRT
                        </button>

                        <button
                          onClick={() =>
                            downloadFile(
                              generateSRT(subtitles),
                              'translated_subtitles.srt',
                              'text/plain;charset=utf-8'
                            )
                          }
                          disabled={subtitles.length === 0}
                          className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-300 border border-emerald-500/30 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center gap-1 shadow transition-all active:scale-95"
                          title="Download the translated subtitles as SRT"
                        >
                          Download SRT
                        </button>

                        {subtitles.some((sub, idx) => {
                          const next = subtitles[idx + 1];
                          return next && (next.start - sub.end) >= 1.0;
                        }) && (
                          <button
                            onClick={handleBridgeAllGaps}
                            className="bg-amber-500 hover:bg-amber-400 text-slate-950 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center gap-1 shadow transition-all active:scale-95"
                            title="Extend cue timings across gaps. This does not recover missing dialogue."
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                            Bridge Gaps
                          </button>
                        )}
                        <button
                          onClick={() => handleAddSubtitle()}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center gap-1 shadow transition-all active:scale-95"
                          title="Add a new subtitle segment at current video time"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                          Add Cue
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between bg-slate-800/40 px-2.5 py-1.5 rounded-lg border border-slate-800/60">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input 
                          type="checkbox" 
                          checked={continuousMode} 
                          onChange={(e) => setContinuousMode(e.target.checked)}
                          className="w-3.5 h-3.5 accent-indigo-500 rounded bg-slate-900 border-slate-700 cursor-pointer"
                        />
                        <span className="text-[10px] text-slate-300 font-medium">Continuous Display (keeps subtitles on screen during pauses)</span>
                      </label>
                      <span
                        className={`text-[8px] uppercase tracking-wider font-bold px-1 py-0.5 rounded border ${
                          continuousMode
                            ? 'text-indigo-400 bg-indigo-950/60 border-indigo-800/40'
                            : 'text-slate-500 bg-slate-900 border-slate-700'
                        }`}
                      >
                        {continuousMode ? 'Active' : 'Off'}
                      </span>
                    </div>

                    {transcriptionReport && (
                      <details className="bg-slate-800/30 border border-slate-800 rounded-lg">
                        <summary className="cursor-pointer list-none px-2.5 py-2 text-[9px] font-black uppercase tracking-wider text-slate-300">
                          Coverage report · {transcriptionReport.sections.length} sections
                        </summary>
                        <div className="px-2.5 pb-2 space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                          {transcriptionReport.sections.map((section) => (
                            <React.Fragment key={section.index}>
                              <button
                                onClick={() => jumpToTime(section.start)}
                                className="w-full flex items-center justify-between gap-2 text-left text-[9px] py-1 border-t border-slate-800/60"
                                title={section.error || 'Jump to this section'}
                              >
                                <span className="font-mono text-slate-400">
                                  {formatTime(section.start).split(',')[0]} →{' '}
                                  {formatTime(section.end).split(',')[0]}
                                </span>
                                <span
                                  className={
                                    section.status === 'success'
                                      ? 'text-emerald-400'
                                      : section.status === 'no_speech'
                                        ? 'text-slate-500'
                                        : section.status === 'error'
                                          ? 'text-rose-400'
                                          : 'text-amber-400'
                                  }
                                >
                                  {section.status.replace('_', ' ')}
                                  {section.attempts > 1 ? ` · ${section.attempts} tries` : ''}
                                </span>
                              </button>
                              {section.error && (
                                <p className="text-[9px] leading-relaxed text-rose-300/90 bg-rose-950/20 px-1.5 py-1 rounded">
                                  {section.error}
                                </p>
                              )}
                            </React.Fragment>
                          ))}
                          {transcriptionReport.uncaptionedRanges.length > 0 && (
                            <p className="text-[9px] text-amber-300/80 pt-1 border-t border-slate-800/60">
                              Uncaptioned ranges may be silence or missed speech.
                            </p>
                          )}
                        </div>
                      </details>
                    )}
                  </div>

                  {subtitles.length > 0 ? (
                    <div className="space-y-2.5">
                      {subtitles.map((sub, index) => {
                        const nextSub = subtitles[index + 1];
                        const gapSeconds = nextSub ? Number((nextSub.start - sub.end).toFixed(2)) : 0;
                        const hasSignificantGap = gapSeconds >= 1.5;

                        return (
                          <React.Fragment key={sub.id}>
                            <div 
                              id={sub.id} 
                              onClick={() => jumpToTime(sub.start)} 
                              className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                                currentSubtitle?.id === sub.id 
                                  ? 'bg-indigo-600/20 border-indigo-500/60 ring-1 ring-indigo-500/30' 
                                  : 'bg-slate-800/30 border-slate-800/60 hover:border-slate-700'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[9px] font-black text-indigo-400 uppercase tracking-tighter bg-indigo-950/60 border border-indigo-800/40 px-1.5 py-0.5 rounded">
                                    {sub.speaker || 'Speaker'}
                                  </span>
                                  <span className="text-[9px] font-mono text-slate-400">
                                    {formatTime(sub.start).split(',')[0]} → {formatTime(sub.end).split(',')[0]}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingId(editingId === sub.id ? null : sub.id);
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase transition-colors ${
                                      editingId === sub.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                    }`}
                                    title="Edit subtitle text & timing"
                                  >
                                    {editingId === sub.id ? 'Done' : 'Edit'}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleInsertAfter(sub, nextSub);
                                    }}
                                    title="Add segment right after this subtitle"
                                    className="p-1 rounded text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition-colors"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                  </button>
                                  <button
                                    onClick={(e) => handleDeleteSubtitle(sub.id, e)}
                                    title="Delete subtitle"
                                    className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                  </button>
                                </div>
                              </div>

                              {editingId === sub.id ? (
                                <div className="space-y-2 mt-2" onClick={(e) => e.stopPropagation()}>
                                  <div className="space-y-1">
                                    <label className="text-[8px] font-black uppercase text-slate-400 tracking-wider">Subtitles ({targetLang})</label>
                                    <textarea
                                      autoFocus
                                      className="w-full bg-slate-950 border border-indigo-500 rounded p-2 text-xs text-white outline-none h-16 resize-none focus:ring-1 focus:ring-indigo-400"
                                      value={sub.translatedText}
                                      onChange={(e) => updateSubtitleText(sub.id, e.target.value)}
                                      placeholder="Type subtitle here..."
                                    />
                                  </div>
                                  {sub.originalText ? (
                                    <div className="space-y-1">
                                      <label className="text-[8px] font-black uppercase text-slate-500 tracking-wider">Original Audio</label>
                                      <input
                                        type="text"
                                        className="w-full bg-slate-950/70 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-300 outline-none"
                                        value={sub.originalText}
                                        onChange={(e) => handleUpdateSubtitle(sub.id, { originalText: e.target.value })}
                                        placeholder="Original text..."
                                      />
                                    </div>
                                  ) : null}
                                  
                                  <div className="pt-2 border-t border-slate-800/80 grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                      <div className="flex justify-between items-center text-[8px] font-bold text-slate-400 uppercase">
                                        <span>Start (sec)</span>
                                        <button 
                                          type="button"
                                          onClick={(e) => handleSetTimeToCurrent(sub.id, 'start', e)} 
                                          className="text-indigo-400 hover:text-indigo-300 text-[8px] lowercase font-mono underline"
                                          title="Set start time to current video playback time"
                                        >
                                          use now
                                        </button>
                                      </div>
                                      <input
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-white outline-none focus:border-indigo-500"
                                        value={sub.start}
                                        onChange={(e) => handleUpdateSubtitleTime(sub.id, 'start', parseFloat(e.target.value))}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <div className="flex justify-between items-center text-[8px] font-bold text-slate-400 uppercase">
                                        <span>End (sec)</span>
                                        <button 
                                          type="button"
                                          onClick={(e) => handleSetTimeToCurrent(sub.id, 'end', e)} 
                                          className="text-indigo-400 hover:text-indigo-300 text-[8px] lowercase font-mono underline"
                                          title="Set end time to current video playback time"
                                        >
                                          use now
                                        </button>
                                      </div>
                                      <input
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-white outline-none focus:border-indigo-500"
                                        value={sub.end}
                                        onChange={(e) => handleUpdateSubtitleTime(sub.id, 'end', parseFloat(e.target.value))}
                                      />
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <p className={`text-xs leading-relaxed ${currentSubtitle?.id === sub.id ? 'text-white font-medium' : 'text-slate-300'}`}>
                                    {sub.translatedText || <span className="italic text-slate-500">Empty subtitle</span>}
                                  </p>
                                  {sub.originalText ? (
                                    <p className="text-[10px] text-slate-500 mt-1 italic truncate">
                                      {sub.originalText}
                                    </p>
                                  ) : null}
                                </div>
                              )}
                            </div>

                            {hasSignificantGap && (() => {
                                                            const isGapEditing = inlineGapKey === `${sub.id}_${nextSub.id}`;

                              return (
                                <div className="my-1.5 p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col gap-2 text-[9px] text-amber-300">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-amber-400 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                      <span><strong>{gapSeconds}s uncaptioned</strong> ({formatTime(sub.end).split(',')[0]} → {formatTime(nextSub.start).split(',')[0]})</span>
                                    </div>
                                  </div>

                                  {isGapEditing ? (
                                    <div className="flex flex-col gap-1.5 pt-1 border-t border-amber-500/20" onClick={(e) => e.stopPropagation()}>
                                      <input
                                        type="text"
                                        placeholder="Type translated subtitle for this gap..."
                                        className="w-full bg-slate-950 border border-amber-500/50 rounded-lg px-2.5 py-1 text-xs text-white outline-none focus:border-amber-400 font-medium"
                                        value={inlineGapText}
                                        onChange={(e) => setInlineGapText(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') handleAddInlineGapCue(sub.end, nextSub.start);
                                        }}
                                        autoFocus
                                      />
                                      <div className="flex justify-end gap-1.5">
                                        <button
                                          onClick={() => { setInlineGapKey(null); setInlineGapText(''); }}
                                          className="px-2 py-0.5 text-[8px] text-slate-400 hover:text-white"
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          onClick={() => handleAddInlineGapCue(sub.end, nextSub.start)}
                                          className="bg-amber-500 hover:bg-amber-400 text-slate-950 px-2 py-0.5 rounded font-bold text-[8px] uppercase shadow"
                                        >
                                          Save to Gap
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5 pt-1 border-t border-amber-500/20 flex-wrap">
                                      <button
                                        onClick={(e) => handleAiTranscribeGap(sub, nextSub, e)}
                                        disabled={aiTranscribingGapKey !== null}
                                        className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded-lg font-bold tracking-wider text-[8px] uppercase flex items-center justify-center gap-1 shadow active:scale-95 transition-all disabled:opacity-50 min-w-[110px]"
                                        title="Ask Gemini to recover speech only from this gap. Failures leave the transcript unchanged."
                                      >
                                        {aiTranscribingGapKey === `${sub.id}_${nextSub.id}` ? (
                                          <>
                                            <div className="w-2.5 h-2.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            <span>Listening...</span>
                                          </>
                                        ) : (
                                          <>
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
                                            <span>AI Transcribe Gap</span>
                                          </>
                                        )}
                                      </button>

                                      <button
                                        onClick={(e) => handleBridgeSingleGap(sub.id, nextSub.start, e)}
                                        disabled={aiTranscribingGapKey !== null}
                                        className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 px-2 py-1 rounded-lg font-black tracking-wider text-[8px] uppercase flex items-center gap-1 shadow active:scale-95 transition-all"
                                        title="Extend only the cue timing; this does not transcribe the gap"
                                      >
                                        <span>Bridge to Next</span>
                                      </button>

                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setInlineGapKey(`${sub.id}_${nextSub.id}`);
                                          setInlineGapText('');
                                        }}
                                        disabled={aiTranscribingGapKey !== null}
                                        className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 px-2 py-1 rounded-lg font-bold text-[8px] uppercase flex items-center gap-1 transition-all"
                                        title="Type text directly in this gap"
                                      >
                                        <span>+ Type Here</span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="h-44 flex flex-col items-center justify-center text-slate-500 space-y-3 border border-dashed border-slate-800 rounded-xl p-4">
                      <div className="w-9 h-9 rounded-full bg-slate-800/80 flex items-center justify-center text-slate-400">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      </div>
                      <span className="text-[10px] uppercase font-black tracking-widest text-slate-400">No Subtitles Yet</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAddSubtitle()}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider shadow active:scale-95 transition-all"
                        >
                          + Add Cue
                        </button>
                        <button
                          onClick={() => setShowImportModal(true)}
                          className="bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/30 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider shadow active:scale-95 transition-all"
                        >
                          Import SRT
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>

        {showImportModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-5 shadow-2xl flex flex-col gap-4 animate-scale-up">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  </div>
                  <h3 className="text-sm font-bold text-white">Import or Paste Subtitles (SRT)</h3>
                </div>
                <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-white text-sm font-bold p-1">✕</button>
              </div>
              
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Paste any SRT subtitle block (e.g. from chat, notepad, or video transcript), or upload an <code className="text-indigo-300">.srt</code> file.
              </p>

              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={`1\n00:00:02,000 --> 00:00:07,000\nOkay, I'm making this video...\n\n2\n00:00:07,100 --> 00:00:11,000\n...we'll probably finish late.`}
                rows={7}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 outline-none focus:border-indigo-500 resize-none custom-scrollbar"
              />

              <div className="flex items-center justify-between gap-3 pt-2">
                <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Upload .srt File
                  <input type="file" accept=".srt,.vtt,.txt" className="hidden" onChange={handleImportSRTFile} />
                </label>

                <div className="flex gap-2">
                  <button
                    onClick={() => setShowImportModal(false)}
                    className="px-3 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleApplyImportedSRT}
                    disabled={!importText.trim()}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-95 transition-all"
                  >
                    Apply Subtitles
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <nav className="flex md:hidden h-14 border-t border-slate-800 bg-slate-900 px-6 items-center justify-between shrink-0 z-50">
          <button onClick={() => setActiveTab('video')} className={`flex flex-col items-center gap-1 ${activeTab === 'video' ? 'text-indigo-400' : 'text-slate-500'}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="1" y="5" width="15" height="14" rx="2"/><path d="M23 7l-7 5 7 5z"/></svg>
            <span className="text-[8px] font-black uppercase">Video</span>
          </button>
          <button onClick={() => setActiveTab('transcript')} className={`flex flex-col items-center gap-1 ${activeTab === 'transcript' ? 'text-indigo-400' : 'text-slate-500'}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span className="text-[8px] font-black uppercase">Edit</span>
          </button>
          <button onClick={() => setActiveTab('style')} className={`flex flex-col items-center gap-1 ${activeTab === 'style' ? 'text-indigo-400' : 'text-slate-500'}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
            <span className="text-[8px] font-black uppercase">Style</span>
          </button>
        </nav>

        {error && (
          <div className="absolute top-4 left-4 right-4 z-[60] p-4 bg-slate-900 border border-rose-500/50 text-white rounded-xl text-[10px] font-bold shadow-2xl flex flex-col gap-2">
            <div className="flex items-start justify-between">
              <div className="flex gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-rose-500"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <div className="flex flex-col gap-1">
                  <span className="text-rose-500 uppercase tracking-widest font-black">Error</span>
                  <span className="text-slate-300 normal-case leading-normal">{error}</span>
                </div>
              </div>
              <button
                onClick={() => {
                  setError(null);
                  setState(subtitles.length > 0 ? AppState.REVIEW : AppState.IDLE);
                }}
                className="text-slate-500 hover:text-white"
              >
                ✕
              </button>
            </div>
            {state === AppState.ERROR && videoFile && (
              <button
                onClick={() => {
                  setError(null);
                  void startProcessing();
                }}
                className="mt-1 bg-rose-500/10 text-rose-500 py-1.5 rounded-lg border border-rose-500/20 active:scale-95"
              >
                RETRY TRANSCRIPTION
              </button>
            )}
          </div>
        )}
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
        input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #6366f1; cursor: pointer; border: 2px solid white; box-shadow: 0 0 10px rgba(99, 102, 241, 0.4); }
      `}</style>
    </div>
  );
};

export default App;
