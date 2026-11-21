import { afterEach, describe, expect, it } from 'vitest';

import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { APP_EVENT_POST_MESSAGE_KIND, SETUP_WORKBOOK, type SetupEventVariant } from './event.js';
import { encodeWorkbookAppEvent } from '../../tests/mocks/app_events.js';
import { WebPlatformEventListener } from './web_event_listener.js';

describe('WebPlatformEventListener messages', () => {
    let listener: WebPlatformEventListener | null = null;
    afterEach(() => {
        listener?.dispose();
        listener = null;
    });

    it('dispatches the app events that the window of the app posts', async () => {
        listener = new WebPlatformEventListener(new TestLogger());
        const events: SetupEventVariant[] = [];
        listener.subscribeSetupEvents(event => events.push(event));
        await listener.setup();
        const zip = new Uint8Array([80, 75, 3, 4]);
        const message = (data: unknown, origin = window.location.origin) => window.dispatchEvent(new MessageEvent('message', { data, origin }));

        message({ kind: 'devtools', data: 'x' });
        message({ kind: APP_EVENT_POST_MESSAGE_KIND, data: encodeWorkbookAppEvent(zip) }, 'https://evil.example');
        expect(events).toEqual([]);
        message({ kind: APP_EVENT_POST_MESSAGE_KIND, data: encodeWorkbookAppEvent(zip) });
        expect(events).toEqual([{ type: SETUP_WORKBOOK, value: zip }]);
    });
});

