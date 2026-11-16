import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { JobError } from './jobs';
export const PIPELINE_STAGES = ['transcript', 'translation', 'narration', 'render'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export const PIPELINE_STATES = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'unknown'] as const;
export type PipelineState = (typeof PIPELINE_STATES)[number];
export const PIPELINE_LANGUAGES = ['es', 'en'] as const;
export type PipelineLanguage = (typeof PIPELINE_LANGUAGES)[number];
export const PIPELINE_VOICE_GENDERS = ['female', 'male'] as const;
export type PipelineVoiceGender = (typeof PIPELINE_VOICE_GENDERS)[number];
export const PIPELINE_ARTIFACT_KINDS = ['transcript_es', 'translation_en', 'subtitle_srt_en', 'voice_preview_en', 'voice_full_en', 'render_mp4_en'] as const;
export type PipelineArtifactKind = (typeof PIPELINE_ARTIFACT_KINDS)[number];
export const PIPELINE_ARTIFACT_STATES = ['staged', 'ready', 'failed'] as const;
export type PipelineArtifactState = (typeof PIPELINE_ARTIFACT_STATES)[number];
export interface PipelineTranscriptConfig {
    readonly stage: 'transcript';
    readonly provider: 'gemini';
    readonly model: string;
    readonly sourceLanguage: 'es';
    readonly targetLanguage: 'en';
}
export interface PipelineTranslationConfig {
    readonly stage: 'translation';
    readonly provider: 'gemini';
    readonly model: string;
    readonly sourceLanguage: 'es';
    readonly targetLanguage: 'en';
}
export interface PipelineNarrationConfig {
    readonly stage: 'narration';
    readonly provider: 'gemini';
    readonly model: string;
    readonly voiceId: string;
    readonly voiceGender: PipelineVoiceGender;
    readonly sourceLanguage: 'es';
    readonly targetLanguage: 'en';
}
export interface PipelineRenderConfig {
    readonly stage: 'render';
    readonly provider: 'ffmpeg';
    readonly videoCodec: 'h264';
    readonly audioCodec: 'aac';
    readonly subtitleMode: 'burned';
    readonly sourceLanguage: 'es';
    readonly targetLanguage: 'en';
}
export type PipelineStageConfig = PipelineTranscriptConfig | PipelineTranslationConfig | PipelineNarrationConfig | PipelineRenderConfig;
export interface PipelineProjectSnapshot {
    readonly revision: number;
    readonly draft: string;
    readonly originalDraft: string | null;
    readonly duration: number;
    readonly style: Record<string, unknown> | null;
    readonly highlights: Record<string, unknown>;
}
export interface CreatePipelineJobRequest {
    readonly requestKey: string;
    readonly expectedRevision: number;
    readonly dependencies: readonly string[];
    readonly inputId: string;
    readonly stage: PipelineStage;
    readonly config: PipelineStageConfig;
}
export interface PublishPipelineArtifactInput {
    readonly kind: PipelineArtifactKind;
    readonly state: 'staged' | 'ready';
    readonly mimeType: string;
    readonly byteSize: number | null;
    readonly durationMs: number | null;
    readonly sha256: string | null;
    readonly storageKey: string | null;
}
export interface PipelineArtifactMetadataDto {
    readonly id: string;
    readonly kind: PipelineArtifactKind;
    readonly state: PipelineArtifactState;
    readonly revision: number;
    readonly mimeType: string;
    readonly byteSize: number | null;
    readonly durationMs: number | null;
    readonly sha256: string | null;
    readonly createdAt: string;
    readonly readyAt: string | null;
    readonly expiresAt: string;
    readonly current: boolean;
}
export interface PipelineJobDto {
    readonly id: string;
    readonly inputId: string;
    readonly projectId: string;
    readonly stage: PipelineStage;
    readonly state: PipelineState;
    readonly requestKey: string;
    readonly config: PipelineStageConfig;
    readonly revision: number;
    readonly snapshotHash: string;
    readonly snapshotId: string;
    readonly configHash: string;
    readonly dependencies: readonly string[];
    readonly stale: boolean;
    readonly currentRevision: number | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly expiresAt: string;
    readonly artifacts: readonly PipelineArtifactMetadataDto[];
}
export interface PipelineJobAttempt {
    readonly jobId: string;
    readonly accountId: string;
    readonly stage: PipelineStage;
    readonly attemptId: string;
    readonly leaseUntil: string;
    readonly revision: number;
    readonly snapshotHash: string;
    readonly config: PipelineStageConfig;
    readonly snapshot: PipelineProjectSnapshot;
    readonly expiresAt: string;
}
export interface PipelineApiService {
    createJob(accountId: string, request: unknown): Promise<PipelineJobDto>;
    getJob(accountId: string, jobId: string): Promise<PipelineJobDto | null>;
    listJobs(accountId: string, limit?: number): Promise<readonly PipelineJobDto[]>;
    cancelJob(accountId: string, jobId: string): Promise<boolean>;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DRAFT_BYTES = 65536;
const MAX_DURATION = 600;
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function assertExactObject(value: unknown, field: string, allowed: readonly string[]): Record<string, unknown> {
    if (!isPlainObject(value))
        throw new JobError('invalid_input', `${field} must be an object.`);
    for (const key of Object.keys(value))
        if (!allowed.includes(key))
            throw new JobError('invalid_input', `${field} contains unknown field ${key}.`);
    return value;
}
function assertString(value: unknown, field: string, min: number, max: number): string {
    if (typeof value !== 'string' || value.length < min || value.length > max)
        throw new JobError('invalid_input', `${field} must be a string between ${min} and ${max} characters.`);
    return value;
}
function assertToken(value: unknown, field: string, max: number): string {
    const s = assertString(value, field, 1, max);
    if (/[\u0000-\u001f\u007f]/.test(s))
        throw new JobError('invalid_input', `${field} contains control characters.`);
    return s;
}
function assertInteger(value: unknown, field: string, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
        throw new JobError('invalid_input', `${field} must be an integer between ${min} and ${max}.`);
    return value;
}
function assertFiniteNumber(value: unknown, field: string, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
        throw new JobError('invalid_input', `${field} must be a finite number between ${min} and ${max}.`);
    return value;
}
function assertUtf8String(value: unknown, field: string, maxBytes: number): string {
    if (typeof value !== 'string')
        throw new JobError('invalid_input', `${field} must be a string.`);
    if (Buffer.byteLength(value, 'utf8') > maxBytes)
        throw new JobError('invalid_input', `${field} exceeds ${maxBytes} bytes.`);
    return value;
}
function assertSha256(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
        throw new JobError('invalid_input', `${field} must be a lowercase SHA-256 hex string.`);
    return value;
}
function assertUuid(value: unknown, field: string): string {
    if (typeof value !== 'string' || !UUID_RE.test(value))
        throw new JobError('invalid_input', `${field} must be a UUID.`);
    return value.toLowerCase();
}
function assertJsonObject(value: unknown, field: string): Record<string, unknown> {
    if (!isPlainObject(value))
        throw new JobError('invalid_input', `${field} must be an object.`);
    stableStringify(value);
    return value;
}
export function isPipelineStage(value: unknown): value is PipelineStage {
    return typeof value === 'string' && (PIPELINE_STAGES as readonly string[]).includes(value);
}
export function isPipelineState(value: unknown): value is PipelineState {
    return typeof value === 'string' && (PIPELINE_STATES as readonly string[]).includes(value);
}
export function isPipelineArtifactKind(value: unknown): value is PipelineArtifactKind {
    return typeof value === 'string' && (PIPELINE_ARTIFACT_KINDS as readonly string[]).includes(value);
}
export function isPipelineArtifactState(value: unknown): value is PipelineArtifactState {
    return typeof value === 'string' && (PIPELINE_ARTIFACT_STATES as readonly string[]).includes(value);
}
/** Canonical JSON v1: exact Unicode, sorted object keys, ordered arrays; no coercion. */
export function stableStringify(value: unknown): string {
    const seen = new Set<object>();
    function encode(item: unknown, depth: number): string {
        if (depth > 32)
            throw new JobError('invalid_input', 'JSON nesting too deep.');
        if (item === null || typeof item === 'boolean' || typeof item === 'string')
            return JSON.stringify(item);
        if (typeof item === 'number' && Number.isFinite(item))
            return JSON.stringify(item);
        if (typeof item !== 'object' || item === null || seen.has(item))
            throw new JobError('invalid_input', 'Invalid JSON value.');
        if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
            throw new JobError('invalid_input', 'Expected plain JSON.');
        seen.add(item);
        const result = Array.isArray(item) ? '[' + item.map(v => encode(v, depth + 1)).join(',') + ']' :
            '{' + Object.keys(item).sort().map(key => JSON.stringify(key) + ':' + encode((item as Record<string, unknown>)[key], depth + 1)).join(',') + '}';
        seen.delete(item);
        return result;
    }
    return encode(value, 0);
}
export function parseStageConfig(stage: PipelineStage, value: unknown): PipelineStageConfig {
    if (stage === 'transcript') {
        const obj = assertExactObject(value, 'config', ['stage', 'provider', 'model', 'sourceLanguage', 'targetLanguage']);
        if (obj.stage !== 'transcript')
            throw new JobError('invalid_input', 'config.stage must match transcript.');
        if (obj.provider !== 'gemini')
            throw new JobError('invalid_input', 'config.provider must be gemini for transcript.');
        if (obj.sourceLanguage !== 'es' || obj.targetLanguage !== 'en')
            throw new JobError('invalid_input', 'Only ES -> EN is supported in this phase.');
        return Object.freeze({ stage: 'transcript' as const, provider: 'gemini' as const, model: assertToken(obj.model, 'config.model', 100), sourceLanguage: 'es' as const, targetLanguage: 'en' as const });
    }
    if (stage === 'translation') {
        const obj = assertExactObject(value, 'config', ['stage', 'provider', 'model', 'sourceLanguage', 'targetLanguage']);
        if (obj.stage !== 'translation')
            throw new JobError('invalid_input', 'config.stage must match translation.');
        if (obj.provider !== 'gemini')
            throw new JobError('invalid_input', 'config.provider must be gemini for translation.');
        if (obj.sourceLanguage !== 'es' || obj.targetLanguage !== 'en')
            throw new JobError('invalid_input', 'Only ES -> EN is supported in this phase.');
        return Object.freeze({ stage: 'translation' as const, provider: 'gemini' as const, model: assertToken(obj.model, 'config.model', 100), sourceLanguage: 'es' as const, targetLanguage: 'en' as const });
    }
    if (stage === 'narration') {
        const obj = assertExactObject(value, 'config', ['stage', 'provider', 'model', 'voiceId', 'voiceGender', 'sourceLanguage', 'targetLanguage']);
        if (obj.stage !== 'narration')
            throw new JobError('invalid_input', 'config.stage must match narration.');
        if (obj.provider !== 'gemini')
            throw new JobError('invalid_input', 'config.provider must be gemini for narration.');
        if (obj.sourceLanguage !== 'es' || obj.targetLanguage !== 'en')
            throw new JobError('invalid_input', 'Only ES -> EN is supported in this phase.');
        if (obj.voiceGender !== 'female' && obj.voiceGender !== 'male')
            throw new JobError('invalid_input', 'config.voiceGender must be female or male.');
        return Object.freeze({ stage: 'narration' as const, provider: 'gemini' as const, model: assertToken(obj.model, 'config.model', 100), voiceId: assertToken(obj.voiceId, 'config.voiceId', 100), voiceGender: obj.voiceGender, sourceLanguage: 'es' as const, targetLanguage: 'en' as const });
    }
    const obj = assertExactObject(value, 'config', ['stage', 'provider', 'videoCodec', 'audioCodec', 'subtitleMode', 'sourceLanguage', 'targetLanguage']);
    if (obj.stage !== 'render')
        throw new JobError('invalid_input', 'config.stage must match render.');
    if (obj.provider !== 'ffmpeg')
        throw new JobError('invalid_input', 'config.provider must be ffmpeg for render.');
    if (obj.videoCodec !== 'h264' || obj.audioCodec !== 'aac' || obj.subtitleMode !== 'burned')
        throw new JobError('invalid_input', 'render config must be h264/aac/burned.');
    if (obj.sourceLanguage !== 'es' || obj.targetLanguage !== 'en')
        throw new JobError('invalid_input', 'Only ES -> EN is supported in this phase.');
    return Object.freeze({ stage: 'render' as const, provider: 'ffmpeg' as const, videoCodec: 'h264' as const, audioCodec: 'aac' as const, subtitleMode: 'burned' as const, sourceLanguage: 'es' as const, targetLanguage: 'en' as const });
}
export function parseCreatePipelineJobRequest(value: unknown): CreatePipelineJobRequest {
    const obj = assertExactObject(value, 'request', ['requestKey', 'expectedRevision', 'inputId', 'stage', 'config', 'dependencies']);
    const stage = obj.stage;
    if (obj.dependencies !== undefined && (!Array.isArray(obj.dependencies) || obj.dependencies.length > 8))
        throw new JobError('invalid_input', 'Invalid dependencies.');
    const dependencies = ((obj.dependencies ?? []) as unknown[]).map(v => assertUuid(v, 'dependency'));
    if (new Set(dependencies).size !== dependencies.length)
        throw new JobError('invalid_input', 'Duplicate dependencies.');
    if (!isPipelineStage(stage))
        throw new JobError('invalid_input', 'request.stage is invalid.');
    return Object.freeze({ dependencies: Object.freeze(dependencies), requestKey: assertToken(obj.requestKey, 'request.requestKey', 200), expectedRevision: assertInteger(obj.expectedRevision, 'request.expectedRevision', 1, 2147483647), inputId: assertUuid(obj.inputId, 'request.inputId'), stage, config: parseStageConfig(stage, obj.config) });
}
export function parsePipelineSnapshot(value: unknown): PipelineProjectSnapshot {
    const obj = assertExactObject(value, 'snapshot', ['revision', 'draft', 'originalDraft', 'duration', 'style', 'highlights']);
    if (obj.originalDraft === '') throw new JobError('invalid_input', 'Original draft must be null or nonempty.');
    const originalDraft = obj.originalDraft === null ? null : assertUtf8String(obj.originalDraft, 'snapshot.originalDraft', MAX_DRAFT_BYTES);
    const style = obj.style === null ? null : assertJsonObject(obj.style, 'snapshot.style');
    return Object.freeze({ revision: assertInteger(obj.revision, 'snapshot.revision', 1, Number.MAX_SAFE_INTEGER), draft: assertUtf8String(obj.draft, 'snapshot.draft', MAX_DRAFT_BYTES), originalDraft, duration: assertFiniteNumber(obj.duration, 'snapshot.duration', 0.000001, MAX_DURATION), highlights: assertJsonObject(obj.highlights ?? {}, 'snapshot.highlights'), style });
}
export function snapshotHash(snapshot: PipelineProjectSnapshot): string {
    const validated = parsePipelineSnapshot(snapshot);
    return createHash('sha256').update('lv016-snapshot-v1\0').update(stableStringify({ revision: validated.revision, draft: validated.draft, originalDraft: validated.originalDraft, duration: validated.duration, style: validated.style, highlights: validated.highlights }), 'utf8').digest('hex');
}
export function canonicalizeConfig(config: PipelineStageConfig): string {
    return stableStringify(parseStageConfig(config.stage, config));
}
export function parsePublishPipelineArtifactInput(value: unknown): PublishPipelineArtifactInput {
    const obj = assertExactObject(value, 'artifact', ['kind', 'state', 'mimeType', 'byteSize', 'durationMs', 'sha256', 'storageKey']);
    if (!isPipelineArtifactKind(obj.kind))
        throw new JobError('invalid_input', 'artifact.kind is invalid.');
    if (obj.state !== 'staged' && obj.state !== 'ready')
        throw new JobError('invalid_input', 'artifact.state must be staged or ready.');
    const expectedMime = obj.kind === 'render_mp4_en' ? 'video/mp4' : obj.kind.startsWith('voice_') ? 'audio/wav' : obj.kind === 'subtitle_srt_en' ? 'application/x-subrip' : 'text/plain';
    if (obj.mimeType !== expectedMime)
        throw new JobError('invalid_input', 'Unexpected MIME for artifact kind.');
    const byteSize = obj.byteSize === null || obj.byteSize === undefined ? null : assertInteger(obj.byteSize, 'artifact.byteSize', 1, Number.MAX_SAFE_INTEGER);
    const durationMs = obj.durationMs === null || obj.durationMs === undefined ? null : assertInteger(obj.durationMs, 'artifact.durationMs', 1, 600000);
    if ((obj.kind.startsWith('voice_') || obj.kind === 'render_mp4_en') && (durationMs === null || durationMs > 600000))
        throw new JobError('invalid_input', 'Media artifact needs valid duration.');
    const sha256 = obj.sha256 === null || obj.sha256 === undefined ? null : assertSha256(obj.sha256, 'artifact.sha256');
    const storageKey = obj.storageKey === null || obj.storageKey === undefined ? null : assertToken(obj.storageKey, 'artifact.storageKey', 200);
    if (storageKey !== null && !/^[a-zA-Z0-9_-]{1,200}$/.test(storageKey))
        throw new JobError('invalid_input', 'Storage key must be opaque.');
    if ((obj.state === 'ready' || obj.state === 'staged') && (byteSize === null || sha256 === null || storageKey === null))
        throw new JobError('invalid_input', 'Artifacts require size, hash and opaque storage key.');
    return Object.freeze({ kind: obj.kind, state: obj.state, mimeType: assertToken(obj.mimeType, 'artifact.mimeType', 100), byteSize, durationMs, sha256, storageKey });
}
const PIPELINE_TRANSITIONS: Record<PipelineState, readonly PipelineState[]> = { queued: ['running', 'cancelled', 'failed'], running: ['succeeded', 'failed', 'cancelled', 'unknown'], unknown: ['succeeded', 'failed', 'cancelled'], succeeded: [], failed: [], cancelled: [] };
export function canTransition(from: PipelineState, to: PipelineState): boolean {
    return PIPELINE_TRANSITIONS[from].includes(to);
}
export function assertTransition(from: PipelineState, to: PipelineState): void {
    if (!canTransition(from, to))
        throw new JobError('conflict', `Invalid pipeline transition ${from} -> ${to}.`);
}
export function isTerminalState(state: PipelineState): boolean {
    return state === 'succeeded' || state === 'failed' || state === 'cancelled';
}
export function allowsAutomaticRetry(state: PipelineState): boolean {
    return state === 'queued';
}
