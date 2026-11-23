import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlatformEventListener } from '../host/events/event_listener.js';
import { PlatformType } from '../host/platform_type.js';
import { AppOAuthFlow } from './app_oauth_flow.js';

afterEach(() => {
    delete globalThis.dashqlElectron;
});

describe('AppOAuthFlow', () => {
    it('does not wait for the redirect when a cancel aborts while the browser of the system opens', async () => {
        const abort = new AbortController();
        globalThis.dashqlElectron = {
            openExternal: vi.fn(async () => abort.abort()),
        } as unknown as DashQLElectronBridge;
        const waitForOAuthRedirect = vi.fn();
        const flow = new AppOAuthFlow({ waitForOAuthRedirect } as unknown as PlatformEventListener, PlatformType.DESKTOP);

        await expect(flow.authorizeWithRedirectPage(new URL('https://example.com/authorize'), () => true, abort.signal, () => { }))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(waitForOAuthRedirect).not.toHaveBeenCalled();
    });
});
