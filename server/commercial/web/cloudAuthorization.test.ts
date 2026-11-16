import { describe, expect, it, vi } from 'vitest';
import { waitForCloudAuthorization } from './cloudAuthorization';

describe('cloud authorization cancellation', () => {
  it('releases an indefinitely pending authorization without resuming after late success', async () => {
    const controller = new AbortController();
    let finish!: () => void;
    const authorize = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const upload = vi.fn();
    const pending = waitForCloudAuthorization(authorize, controller.signal).then(upload);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(authorize).toHaveBeenCalledOnce(); // Still in the originating user gesture.
    controller.abort();
    await rejected;
    finish();
    await Promise.resolve();
    expect(upload).not.toHaveBeenCalled();
  });

  it('does not open authorization for an already cancelled export', async () => {
    const controller = new AbortController();
    controller.abort();
    const authorize = vi.fn();
    await expect(waitForCloudAuthorization(authorize, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(authorize).not.toHaveBeenCalled();
  });

  it('handles an authorization rejection arriving after cancellation', async () => {
    const controller = new AbortController();
    let fail!: (error: Error) => void;
    const pending = waitForCloudAuthorization(() => new Promise<void>((_, reject) => { fail = reject; }), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    fail(new Error('late popup failure'));
    await new Promise(resolve => setTimeout(resolve, 0)); // Vitest also fails on an unhandled rejection.
  });

  it('preserves successful authorization and removes the cancellation listener', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await waitForCloudAuthorization(async () => {}, controller.signal);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('preserves authorization errors, including a synchronous popup failure', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const error = new Error('popup unavailable');
    await expect(waitForCloudAuthorization(() => { throw error; }, controller.signal)).rejects.toBe(error);
    await expect(waitForCloudAuthorization(() => Promise.reject(error), controller.signal)).rejects.toBe(error);
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
