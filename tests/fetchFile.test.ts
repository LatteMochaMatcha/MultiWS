// 取工坊自带的数据文件：连不上、取到一半断了、文件不在，各报什么
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfflineError, fetchFile } from '../src/io/fetchFile';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('取数据文件', () => {
  it('取到了：返回整个文件', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    vi.stubGlobal('fetch', async () => new Response(bytes));
    expect(new Uint8Array(await fetchFile('/a.bin', '数据'))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('连不上（工坊的程序关掉了）：报一句知道该怎么办的话，不是浏览器的 Failed to fetch', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = await fetchFile('/a.bin', '数据').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OfflineError);
    expect((err as Error).message).toContain('重新打开');
    expect((err as Error).message).not.toContain('Failed to fetch');
  });

  it('取到一半断了：也算连不上', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      arrayBuffer: async () => {
        throw new TypeError('network error');
      },
    }));
    await expect(fetchFile('/a.bin', '数据')).rejects.toBeInstanceOf(OfflineError);
  });

  it('文件不在：说出是哪个文件、什么状态码，不算连不上', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    const err = await fetchFile('/a.bin', '角色文件').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(OfflineError);
    expect((err as Error).message).toBe('角色文件没取到（404）');
  });
});
