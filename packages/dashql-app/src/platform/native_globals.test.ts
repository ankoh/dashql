import {afterEach, describe, expect, it} from 'vitest';

import {AppHost, getAppHost, isDesktopHost} from '@akohn/dashql-react/dom/app_host';

describe('application host detection', () => {
    afterEach(() => {
        delete (globalThis as any).dashqlElectron;
    });

    it('detects the web host', () => {
        expect(getAppHost()).toBe(AppHost.WEB);
        expect(isDesktopHost()).toBe(false);
    });

    it('detects Electron as the desktop host', () => {
        (globalThis as any).dashqlElectron = {};
        expect(getAppHost()).toBe(AppHost.ELECTRON);
        expect(isDesktopHost()).toBe(true);
    });
});
