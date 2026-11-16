import { afterEach, describe, expect, it, vi } from 'vitest';

import { encodeWorkbookAppEvent } from '../../tests/mocks/app_events.js';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { ElectronPlatformEventListener } from './electron_event_listener.js';
import { SETUP_WORKBOOK, SETUP_WORKBOOK_URL, type SetupEventVariant } from './event.js';

type DeepLink = { type: 'event' | 'workbook'; value: string };

/// Let the Electron bridge hand out the initial deep links and record the deep link subscription
function installDeepLinks(initial: DeepLink[]) {
    const bridge = { listener: null as ((link: DeepLink) => void) | null, unsubscribe: vi.fn() };
    globalThis.dashqlElectron = {
        getInitialDeepLinks: async () => initial,
        onDeepLink: (listener: (link: DeepLink) => void) => {
            bridge.listener = listener;
            return bridge.unsubscribe;
        },
    } as unknown as DashQLElectronBridge;
    return bridge;
}

describe('ElectronPlatformEventListener', () => {
    let listener: ElectronPlatformEventListener | null = null;
    afterEach(() => {
        listener?.dispose();
        listener = null;
        delete globalThis.dashqlElectron;
    });

    it('dispatches the initial and later deep links and unsubscribes on dispose', async () => {
        const bridge = installDeepLinks([{ type: 'workbook', value: 'https://dashql.app/?workbook=abc' }]);
        listener = new ElectronPlatformEventListener(new TestLogger());
        const events: SetupEventVariant[] = [];
        listener.subscribeSetupEvents(event => events.push(event));
        await listener.setup();
        expect(events).toEqual([{ type: SETUP_WORKBOOK_URL, value: 'https://dashql.app/?workbook=abc' }]);

        const zip = new Uint8Array([80, 75, 3, 4]);
        bridge.listener!({ type: 'event', value: encodeWorkbookAppEvent(zip) });
        expect(events[1]).toEqual({ type: SETUP_WORKBOOK, value: zip });

        listener.dispose();
        expect(bridge.unsubscribe).toHaveBeenCalledOnce();
    });

    it('listens only to the web events without the bridge', async () => {
        listener = new ElectronPlatformEventListener(new TestLogger());
        await expect(listener.setup()).resolves.toBeUndefined();
    });
});
