import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';

import { downloadAppConfig } from './app_config.js';

describe('App config', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('can be parsed', async () => {
        const response = await fetch('/static/config.json');
        expect(response.ok).toBe(true);
        await expect(response.json()).resolves.toBeTypeOf('object');
    });

    it('fails to download with the status of a failed response', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }));
        await expect(downloadAppConfig(new TestLogger())).rejects.toThrow('failed with status 404');
    });
});
