import {afterEach, describe, expect, it} from 'vitest';

import {AppHost, getAppHost, isDesktopHost} from './app_host.js';

const host = globalThis as { dashqlElectron?: object };

describe('application host detection', () => {
    afterEach(() => {
        delete host.dashqlElectron;
    });

    it('detects the web host', () => {
        expect(getAppHost()).toBe(AppHost.WEB);
        expect(isDesktopHost()).toBe(false);
    });

    it('detects Electron as the desktop host', () => {
        host.dashqlElectron = {};
        expect(getAppHost()).toBe(AppHost.ELECTRON);
        expect(isDesktopHost()).toBe(true);
    });
});
