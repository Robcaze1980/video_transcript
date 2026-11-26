import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtempDisposable, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { reviewOpenRouterOnce } from './reviewOpenRouterOnce.mjs';

const model = '~z-ai/glm-flash-latest';
const report = [
  '=== RESUMEN FINAL ===',
  'RESULTADO: FALLA',
  'EVIDENCIA: El fragmento deja sin validar el campo de prueba.',
  'NEGATIVOS: Un campo vacío no aparece en la evidencia.',
  'BLOQUEOS: Falta una prueba negativa.',
  '=== FIN RESUMEN ===',
].join('\n');

async function fixture(t) {
  const parent = await realpath(tmpdir());
  const temp = await mkdtempDisposable(path.join(parent, 'vistavo-review-'));
  const root = await realpath(temp.path);
  assert.equal(path.dirname(root), parent);
  t.after(() => temp.remove());
  const brief = 'outputs/brief.txt';
  const binding = path.join(root, 'outputs', 'vistavo-stabilization');
  const projectKey = 'fake-project-key-for-local-test';
  await mkdir(binding, { recursive: true });
  await writeFile(path.join(root, brief), 'Revisa este fragmento ficticio de una línea.');
  await writeFile(path.join(binding, 'recovery-key-binding.json'), JSON.stringify({
    project: 'LinguistVision',
    confirmedBy: 'Rob',
    credentialFingerprintSha256: createHash('sha256').update(projectKey).digest('hex'),
  }));
  return { root, brief, model, projectKey };
}

test('la vista previa y una clave ajena no contactan al proveedor', async (t) => {
  const options = await fixture(t);
  const request = t.mock.fn();
  const preview = await reviewOpenRouterOnce({ ...options, request });
  assert.equal(preview.state, 'PREVIEW');
  await assert.rejects(
    reviewOpenRouterOnce({ ...options, send: true, request, projectKey: 'otro-proyecto-ficticio' }),
    /vinculación/,
  );
  assert.equal(request.mock.callCount(), 0);
});

test('un encargo repetido en paralelo hace un solo envío de texto y guarda el cargo', async (t) => {
  const options = await fixture(t);
  const request = t.mock.fn(async () => Response.json({
    id: 'gen-test',
    model: 'z-ai/glm-test',
    choices: [{ finish_reason: 'stop', message: { content: report } }],
    usage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 70 }, completion_tokens: 50, cost: 0.003 },
  }));
  const send = () => reviewOpenRouterOnce({ ...options, request, send: true });
  const attempts = await Promise.allSettled([send(), send()]);
  const finished = attempts.find((attempt) => attempt.status === 'fulfilled').value;
  assert.match(attempts.find((attempt) => attempt.status === 'rejected').reason.message, /ya tiene un intento/);
  assert.equal(request.mock.callCount(), 1);
  const [url, init] = request.mock.calls[0].arguments;
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  const body = JSON.parse(init.body);
  assert.equal(body.model, model);
  assert.equal(body.tool_choice, 'none');
  assert.equal(body.tools, undefined);
  assert.equal(body.messages.length, 2);
  assert.equal(body.max_completion_tokens, undefined);
  assert.equal(finished.verdict, 'FALLA');
  const receipt = JSON.parse(await readFile(path.join(finished.folder, 'receipt.json'), 'utf8'));
  assert.equal(receipt.cost, 0.003);
  assert.equal(receipt.cachedInputTokens, 70);
  assert.equal(receipt.generationId, 'gen-test');
  assert.equal(await readFile(path.join(finished.folder, 'report.txt'), 'utf8'), report + '\n');
});

test('un envío con confirmación incierta conserva el intento sin repetirlo', async (t) => {
  const options = await fixture(t);
  const request = t.mock.fn(async () => { throw new Error('conexión de prueba interrumpida'); });
  const send = () => reviewOpenRouterOnce({ ...options, request, send: true });
  const result = await send();
  assert.equal(result.state, 'INCONCLUSIVE');
  assert.equal(result.cost, null);
  await assert.rejects(send(), /ya tiene un intento/);
  assert.equal(request.mock.callCount(), 1);
});

test('una respuesta rechazada, truncada o sin evidencia queda inconcluyente', async (t) => {
  for (const [payload, status] of [
    [{ error: { code: 402 } }, 402],
    [{ choices: [{ finish_reason: 'length', message: { content: report } }] }, 200],
    [{ choices: [{ finish_reason: 'stop', message: { content: report.replace(/^EVIDENCIA: .*$/m, 'EVIDENCIA:  ') } }] }, 200],
  ]) {
    const options = await fixture(t);
    const request = t.mock.fn(async () => Response.json(payload, { status }));
    const result = await reviewOpenRouterOnce({ ...options, request, send: true });
    assert.equal(result.verdict, 'INCONCLUYENTE');
    assert.equal(result.httpStatus, status);
    assert.equal(request.mock.callCount(), 1);
  }
});
