// Private synthetic LV-015 experiment. No application, account, payment or billing changes.
// node scripts/prototypeVoiceover.mjs generate|render|qa|report [Kore|Charon] [take] [wordsPerMinute]
import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';

const repo = fileURLToPath(new URL('..', import.meta.url));
const root = join(process.env.LOCALAPPDATA, 'LinguistVision');
const voice = process.argv[3] ?? 'Kore';
if (!['Kore', 'Charon'].includes(voice)) throw new Error('Choose the approved standard prototype voice Kore or Charon.');
const take = process.argv[4] ?? '';
if (take && !/^[a-z0-9-]{1,24}$/.test(take)) throw new Error('Use a short alphanumeric take name.');
const wordsPerMinute = Number(process.argv[5] ?? 140);
if (!Number.isInteger(wordsPerMinute) || wordsPerMinute < 90 || wordsPerMinute > 180) throw new Error('Prototype pace must be90–180 words/minute.');
const runName = 'voice-prototype-20261112' + (voice === 'Charon' ? '-male' : '') + (take ? '-' + take : '');
const state = join(root, 'validation', runName);
const out = resolve(repo, 'outputs', runName);
const command = process.argv[2];
if (!['generate', 'render', 'qa', 'report'].includes(command)) throw new Error('Use generate, render, qa or report explicitly. Generation/QA call the configured project API.');
await mkdir(state, { recursive: true }); await mkdir(out, { recursive: true });
const json = async (path, value) => writeFile(path, JSON.stringify(value, null, 2));
const media = name => join(out, name);
const sanitize = value => {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    key === 'data' && typeof child === 'string'
      ? { omittedBinary: true, sha256: createHash('sha256').update(Buffer.from(child, 'base64')).digest('hex') }
      : sanitize(child)]));
};
const run = (args, options = {}) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { cwd: out, maxBuffer: 16 * 1024 * 1024, ...options });
const probe = path => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], { encoding: 'utf8' }));

async function request(model, body, name) {
  // Exclusive attempt marker prevents accidental double billing on a repeated command.
  const lock = await open(join(state, name + '-attempt.lock'), 'wx'); await lock.close();
  const config = parseEnv(await readFile(join(root, '.env'), 'utf8'));
  if (!config.GEMINI_API_KEY) throw new Error('Missing project Gemini key.');
  await json(join(state, name + '-request.json'), sanitize(body)); // No credentials or base64 in logs.
  const started = performance.now();
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': config.GEMINI_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const value = await response.json();
  await json(join(state, name + '-response.json'), sanitize(value));
  const metadata = { model, status: response.status, responseId: value.responseId, modelVersion: value.modelVersion,
    latencySeconds: (performance.now() - started) / 1000, usage: value.usageMetadata, invoiceCharge: 'not reported by API' };
  await json(join(state, name + '-metadata.json'), metadata);
  if (!response.ok) throw new Error(`${name} failed HTTP ${response.status}; provider error preserved privately. No automatic retry.`);
  return { value, metadata };
}

function audioStats(path) {
  const samples = run(['-i', path, '-map', '0:a:0', '-ac', '1', '-ar', '24000', '-f', 'f32le', '-']);
  let peak = 0, squares = 0, clipped = 0;
  for (let i = 0; i < samples.length; i += 4) {
    const value = samples.readFloatLE(i); peak = Math.max(peak, Math.abs(value)); squares += value * value;
    if (Math.abs(value) >= 0.9999) clipped++;
  }
  const count = samples.length / 4;
  return { seconds: count / 24000, samplePeakDbfs: peak ? 20 * Math.log10(peak) : null,
    rmsDbfs: squares ? 10 * Math.log10(squares / count) : null, clippedSamples: clipped, samples: count };
}

if (command === 'generate') {
  const text = (await readFile(new URL('./fixtures/voice-prototype-es.txt', import.meta.url), 'utf8')).trim();
  const { value, metadata } = await request('gemini-3.8-flash-tts', {
    contents: [{ role: 'user', parts: [{ text, speech_metadata: {
      style: `Español latinoamericano neutro. Narración clara, cálida y profesional, ritmo natural de unas ${wordsPerMinute} palabras por minuto. Pronuncia con claridad nombres, medidas y términos de construcción. Sin música, efectos ni comentarios adicionales.`,
    } }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice } } },
  }, 'tts');
  const parts = value.candidates?.[0]?.content?.parts?.filter(part => part.inlineData) ?? [];
  if (parts.length !== 1) throw new Error('Expected one audio part; response retained for inspection.');
  const { data, mimeType } = parts[0].inlineData;
  const bytes = Buffer.from(data, 'base64');
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') {
    await writeFile(media('narracion-original.wav'), bytes);
  } else if (/^audio\/L16\b/i.test(mimeType) && /rate=24000\b/.test(mimeType)) {
    // Gemini's legacy raw PCM contract: signed16 little endian,24kHz,mono.
    await writeFile(media('narracion-original.pcm'), bytes);
    run(['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', media('narracion-original.pcm'), media('narracion-original.wav')]);
  } else throw new Error('Unexpected audio encoding; no assumed conversion.');
  await writeFile(media('texto.txt'), text + '\n');
  const info = probe(media('narracion-original.wav'));
  const stats = audioStats(media('narracion-original.wav'));
  const usage = metadata.usage ?? {};
  const estimate = Number.isFinite(usage.promptTokenCount) && Number.isFinite(usage.candidatesTokenCount)
    ? (usage.promptTokenCount * 0.5 + (usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0)) * 9) / 1e6 : null;
  await json(media('generacion.json'), { ...metadata, voice, wordsPerMinuteRequested: wordsPerMinute, mimeType, textCharacters: [...text].length,
    words: text.split(/\s+/).length, format: info, stats, target20to30: stats.seconds >= 20 && stats.seconds <= 30,
    ttsEstimatedUsd: estimate, estimateBasis: 'Standard published rate through2026-12-31:0.50/Mtext,9/Maudio;not invoice',
    humanListeningApproval: 'pending' });
  console.log(JSON.stringify({ command, seconds: stats.seconds, ttsEstimatedUsd: estimate, target20to30: stats.seconds >= 20 && stats.seconds <= 30 }));
}

if (command === 'render') {
  const generation = JSON.parse(await readFile(media('generacion.json'), 'utf8'));
  if (!generation.target20to30 || generation.stats.clippedSamples) throw new Error('Original narration fails duration/clipping. Do not stretch, truncate or conceal it with normalization.');
  const result = spawnSync('ffmpeg', ['-hide_banner', '-i', media('narracion-original.wav'), '-af',
    'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-ar', '24000', media('narracion.wav')], { cwd: out, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Audio normalization failed.');
  const loudness = JSON.parse(result.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0] ?? '{}');
  run(['-i', media('narracion.wav'), '-c:a', 'libmp3lame', '-b:a', '64k', media('narracion.mp3')]);
  await writeFile(media('titulo.txt'), 'LinguistVision | Prototipo de voz AI');
  await writeFile(media('datos.txt'), 'Elena Robles\n5 cm junto al bajante\n6 pies de distancia\nMembrana impermeable');
  await writeFile(media('aviso.txt'), 'DEMOSTRACION SINTETICA - SIN DATOS DE CLIENTES');
  const filter = "drawbox=x=70:y=175:w=1140:h=355:color=0x193c54:t=fill," +
    "drawtext=fontfile='/Windows/Fonts/arial.ttf':textfile=titulo.txt:fontsize=40:fontcolor=white:x=70:y=85," +
    "drawtext=fontfile='/Windows/Fonts/arial.ttf':textfile=datos.txt:fontsize=42:fontcolor=0x8de4d0:line_spacing=24:x=110:y=210," +
    "drawtext=fontfile='/Windows/Fonts/arial.ttf':textfile=aviso.txt:fontsize=23:fontcolor=white:x=70:y=610";
  const seconds = generation.stats.seconds;
  run(['-f', 'lavfi', '-i', 'color=c=0x102437:s=1280x720:r=25', '-t', String(seconds), '-vf', filter,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', media('video-sintetico.mp4')]);
  const started = performance.now();
  run(['-i', media('video-sintetico.mp4'), '-i', media('narracion.wav'), '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', media('voice-over-demo.mp4')]);
  const renderSeconds = (performance.now() - started) / 1000;
  for (const [input, name] of [['video-sintetico.mp4', 'source-frames.txt'], ['voice-over-demo.mp4', 'final-frames.txt']]) {
    run(['-i', media(input), '-map', '0:v:0', '-f', 'framemd5', media(name)]);
  }
  const frameLines = async name => (await readFile(media(name), 'utf8')).split('\n').filter(line => line && !line.startsWith('#')).join('\n');
  const preserved = await frameLines('source-frames.txt') === await frameLines('final-frames.txt');
  run(['-i', media('voice-over-demo.mp4'), '-f', 'null', '-']);
  run(['-ss', '2', '-i', media('voice-over-demo.mp4'), '-frames:v', '1', media('poster.png')]);
  const stats = audioStats(media('narracion.wav'));
  const mixed = audioStats(media('voice-over-demo.mp4'));
  const info = probe(media('voice-over-demo.mp4'));
  await json(media('verificacion.json'), { videoFramesPreserved: preserved, renderSeconds, loudness, stats, mixed, format: info,
    deliveryClippingPass: stats.clippedSamples === 0 && mixed.clippedSamples === 0,
    actualPlayback: 'full ffmpeg decoding passed;human playback pending', noSpeedChangeOrTruncation: true });
  if (!preserved || stats.clippedSamples || mixed.clippedSamples) throw new Error('Media verification failed.');
  console.log(JSON.stringify({ command, videoFramesPreserved: preserved, audioSeconds: stats.seconds, renderSeconds, clippedSamples: mixed.clippedSamples }));
}

if (command === 'qa') {
  const { value, metadata } = await request('gemini-3.8-flash', { contents: [{ role: 'user', parts: [
    { text: 'Escucha este audio sin texto de referencia. Devuelve JSON con transcript literal en español (sin corregir ni inventar), language, intelligibility de1a5, audibleIssues (lista), y description breve de pronunciación/ruidos. No supongas que son datos reales.' },
    { inlineData: { mimeType: 'audio/wav', data: (await readFile(media('narracion.wav'))).toString('base64') } },
  ] }], generationConfig: { responseMimeType: 'application/json' } }, 'qa');
  const result = JSON.parse(value.candidates[0].content.parts.filter(part => part.text && !part.thought).map(part => part.text).join(''));
  const transcript = String(result.transcript ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const checks = Object.fromEntries([['nombre', /elena robles/], ['material', /membrana impermeable/], ['bajante', /bajante/],
    ['medidaCentimetros', /\b(?:cinco|5)\s*(?:centimetros|cm)\b/], ['medidaPies', /\b(?:seis|6) pies\b/]].map(([key, regex]) => [key, regex.test(transcript)]));
  const u = metadata.usage ?? {};
  const estimatedUsd = Number.isFinite(u.promptTokenCount) && Number.isFinite(u.candidatesTokenCount)
    ? (u.promptTokenCount * 0.75 + (u.candidatesTokenCount + (u.thoughtsTokenCount ?? 0)) * 3.75) / 1e6 : null;
  await json(media('revision-audio.json'), { ...metadata, ...result, checks, estimatedUsd,
    referenceTranscriptSent: false, method: 'separate multimodal model;not independent human approval' });
  console.log(JSON.stringify({ command, checks, intelligibility: result.intelligibility, estimatedUsd }));
}

if (command === 'report') {
  const generation = JSON.parse(await readFile(media('generacion.json'), 'utf8'));
  const verification = JSON.parse(await readFile(media('verificacion.json'), 'utf8'));
  const qa = JSON.parse(await readFile(media('revision-audio.json'), 'utf8'));
  const transcript = qa.transcript.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const terms = Object.fromEntries([['Elena Robles', /elena robles/], ['membrana impermeable', /membrana impermeable/],
    ['bajante', /bajante/], ['cinco centimetros', /\b(?:cinco|5)\s*(?:centimetros|cm)\b/],
    ['seis pies', /\b(?:seis|6) pies\b/], ['tornillos', /tornillos/], ['cubierta', /cubierta/]]
    .map(([term, regex]) => [term, regex.test(transcript)]));
  const hashes = {};
  for (const name of ['texto.txt', 'narracion-original.wav', 'narracion.wav', 'narracion.mp3', 'video-sintetico.mp4', 'voice-over-demo.mp4']) {
    hashes[name] = createHash('sha256').update(await readFile(media(name))).digest('hex');
  }
  const streams = verification.format.streams;
  const video = streams.filter(stream => stream.codec_type === 'video');
  const sound = streams.filter(stream => stream.codec_type === 'audio');
  const tolerance = 1 / 25 + 1024 / 24000;
  const reference = run(['-i', media('narracion.wav'), '-ac', '1', '-ar', '24000', '-f', 'f32le', '-']);
  const codecChecks = {};
  for (const name of ['narracion.mp3', 'voice-over-demo.mp4']) {
    const decoded = run(['-i', media(name), '-map', '0:a:0', '-ac', '1', '-ar', '24000', '-f', 'f32le', '-']);
    let signalEnergy = 0, errorEnergy = 0;
    for (let i = 0; i < Math.min(reference.length, decoded.length); i += 4) {
      const expected = reference.readFloatLE(i), actual = decoded.readFloatLE(i);
      signalEnergy += expected ** 2; errorEnergy += (actual - expected) ** 2;
    }
    codecChecks[name] = { sampleCountPreserved: decoded.length === reference.length,
      snrDb: errorEnergy && signalEnergy ? 10 * Math.log10(signalEnergy / errorEnergy) : null };
  }
  const mediaPass = video.length === 1 && sound.length === 1 && video[0].codec_name === 'h264' && sound[0].codec_name === 'aac'
    && Math.abs(Number(video[0].duration) - generation.stats.seconds) <= tolerance
    && Math.abs(Number(sound[0].duration) - generation.stats.seconds) <= tolerance
    && verification.videoFramesPreserved && verification.deliveryClippingPass && generation.stats.clippedSamples === 0;
  const report = { model: generation.model, voice: generation.voice, language: 'es', audioSeconds: generation.stats.seconds,
    target20to30: generation.target20to30, terms, automatedAudioIssues: qa.audibleIssues,
    cost: { ttsEstimatedUsd: generation.ttsEstimatedUsd, qaEstimatedUsd: qa.estimatedUsd,
      estimatedTotalUsd: generation.ttsEstimatedUsd === null || qa.estimatedUsd === null ? null : generation.ttsEstimatedUsd + qa.estimatedUsd,
      invoiceCharge: 'not available;estimates at published Standard rates through2026-12-31;reviewers separate' },
    mediaPass, durationToleranceSeconds: tolerance, hashes, codecChecks,
    audioDurationPreserved: generation.stats.samples === verification.stats.samples && generation.stats.samples === verification.mixed.samples,
    decodedVideoFrames: Number(video[0].nb_frames),
    humanListeningApproval: 'pending;assistant audio-input relay unsupported, automatic audio analysis only',
    note: qa.checks?.medidaCentimetros === false && terms['cinco centimetros']
      ? 'Historical evaluator rejected ASR5cm; unit normalization corrected locally without another API request. Original transcript/checks retained.'
      : 'Terms checked with explicit quantity/unit equivalence. No reference transcript sent to QA; no human pronunciation approval inferred.' };
  await json(media('informe.json'), report);
  console.log(JSON.stringify(report));
  if (!mediaPass || !generation.target20to30 || Object.values(terms).some(value => !value)) process.exitCode = 1;
}
