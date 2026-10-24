import { afterEach, expect, it, vi } from 'vitest';
import { PageReader } from '../lib/pageReader';
import { BUILD_VERSION, READER_CHANNEL } from '../lib/readerProtocol';

function harness() {
  let version = BUILD_VERSION, mode = 'current';
  const onVersion = vi.fn();
  const send = vi.fn(async (_tab: number, raw: unknown) => {
    const m = raw as { requestId: string; channel: string };
    if (mode === 'absent') throw new Error('Receiving end does not exist');
    if (mode === 'legacy') return { ok: false, requestId: m.requestId, code: 'UNSUPPORTED_LAYOUT', message: '回复超过 120 个段落块' };
    if (mode === 'wrong-version') return { ok: true, requestId: m.requestId, channel: READER_CHANNEL, readerVersion: '1.2.2', data: null };
    return { ok: mode !== 'generating', requestId: m.requestId, channel: m.channel, readerVersion: BUILD_VERSION, data: { blocks: ['whole answer'] }, code: 'GENERATING', message: '生成中' };
  });
  const install = vi.fn(async () => { mode = 'current'; });
  const reader = new PageReader(onVersion, { loadedVersion: () => version, send, install });
  return { reader, send, install, onVersion, setMode: (value: string) => { mode = value; }, setVersion: (value: string) => { version = value; } };
}
afterEach(() => vi.unstubAllGlobals());
it('healthy captures carry a versioned channel and do not inject', async () => {
  const h = harness();
  expect(await h.reader.send(7, { type: 'CAPTURE' })).toEqual({ blocks: ['whole answer'] });
  await h.reader.send(7, { type: 'CAPTURE' });
  expect(h.install).not.toHaveBeenCalled(); expect(h.onVersion).toHaveBeenCalledWith(BUILD_VERSION);
  expect(h.send.mock.calls[0]![1]).toMatchObject({ channel: READER_CHANNEL, type: 'CAPTURE' });
});
it.each(['legacy', 'absent', 'wrong-version'])('recovers %s readers once without accepting stale errors or data', async mode => {
  const h = harness(); h.setMode(mode);
  expect(await h.reader.send(7, { type: 'CAPTURE' })).toEqual({ blocks: ['whole answer'] });
  expect(h.install).toHaveBeenCalledExactlyOnceWith(7); expect(h.send).toHaveBeenCalledTimes(2);
  await h.reader.send(7, { type: 'CAPTURE' }); expect(h.install).toHaveBeenCalledTimes(1);
});
it('failed repair does not loop every scan and can retry after page navigation', async () => {
  const h = harness(); h.setMode('absent'); h.install.mockRejectedValue(new Error('permission denied'));
  await expect(h.reader.send(7, { type: 'CAPTURE' })).rejects.toMatchObject({ code: 'READER_UPDATE' });
  await expect(h.reader.send(7, { type: 'CAPTURE' })).rejects.toMatchObject({ code: 'READER_UPDATE' });
  expect(h.install).toHaveBeenCalledTimes(1);
  h.reader.forget(7); h.install.mockImplementation(async () => { h.setMode('current'); });
  await h.reader.send(7, { type: 'CAPTURE' }); expect(h.install).toHaveBeenCalledTimes(2);
});
it('valid capture errors do not trigger injection', async () => {
  const h = harness(); h.setMode('generating');
  await expect(h.reader.send(7, { type: 'CAPTURE' })).rejects.toMatchObject({ code: 'GENERATING' });
  expect(h.install).not.toHaveBeenCalled(); expect(h.onVersion).toHaveBeenCalledWith(BUILD_VERSION);
});
it('locate and validate never reinject and silently invalidate their own snapshot', async () => {
  const h = harness(); h.setMode('absent');
  for (const payload of [{ type: 'VALIDATE_SNAPSHOT' as const, snapshotId: crypto.randomUUID() }, { type: 'LOCATE_BLOCK' as const, snapshotId: crypto.randomUUID(), blockId: 'b1005' }]) await expect(h.reader.send(7, payload)).rejects.toMatchObject({ code: 'READER_UPDATE' });
  expect(h.install).not.toHaveBeenCalled();
});
it('detects a newer panel served from an extension that has not been reloaded', async () => {
  vi.stubGlobal('chrome', { runtime: { id: 'synthetic-id' } });
  const h = harness(); h.setVersion('1.2.1');
  await expect(h.reader.send(7, { type: 'CAPTURE' })).rejects.toMatchObject({ code: 'RELOAD_EXTENSION' });
  expect(h.send).not.toHaveBeenCalled(); expect(h.install).not.toHaveBeenCalled();
});
