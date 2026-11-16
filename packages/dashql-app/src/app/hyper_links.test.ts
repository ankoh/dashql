import { describe, expect, it, vi } from 'vitest';

import type { WorkbookScripts } from '@ankoh/dashql/platform/workbook/workbook_scripts';
import { workbookOnConnection } from './hyper_links.js';
import { WebPlatformEventListener } from '../platform/events/web_event_listener.js';
import { TestLogger } from '@ankoh/dashql/platform/testing/test_logger';
import { BASE64URL_CODEC } from '@ankoh/dashql/platform/utils/base64';

const FIRST_RUN = { endpoint: 'http://127.0.0.1:1111', token: 'first' };
const SECOND_RUN = { endpoint: 'http://127.0.0.1:2222', token: 'second' };

describe('the workbook that a link opens', () => {
    const workbooks = new Map(Object.entries({ first: 'embedded', second: 'linked', third: 'linked' })
        .map(([workbookId, connectionId]) => [workbookId, {
            workbookId, ephemeral: false, scriptRefs: {}, scriptOrder: [], pendingConnectionId: connectionId, connectionIds: [connectionId],
        } as unknown as WorkbookScripts]));

    it('stays in the open workbook on the connection of the link', () => {
        expect(workbookOnConnection(workbooks, 'third', 'linked')).toBe('third');
    });

    it('opens the first workbook on the connection of the link', () => {
        expect(workbookOnConnection(workbooks, 'first', 'linked')).toBe('second');
        expect(workbookOnConnection(workbooks, null, 'linked')).toBe('second');
    });

    it('needs a new workbook without one on the connection of the link', () => {
        expect(workbookOnConnection(workbooks, 'first', 'other')).toBeNull();
    });
});

describe('Hyper links of the platform', () => {
    /// A listener that receives links like the native app does
    class LinkListener extends WebPlatformEventListener {
        receive(endpoint: string, token: string) {
            this.dispatchHyperLink({ endpoint, token });
        }
    }

    it('delivers the latest link that arrived before the subscriber', () => {
        const listener = new LinkListener(new TestLogger());
        listener.receive(FIRST_RUN.endpoint, FIRST_RUN.token);
        listener.receive(SECOND_RUN.endpoint, SECOND_RUN.token);
        const handler = vi.fn();
        const unsubscribe = listener.subscribeHyperLinks(handler);
        expect(handler.mock.calls).toEqual([[SECOND_RUN]]);

        listener.receive(FIRST_RUN.endpoint, FIRST_RUN.token);
        expect(handler).toHaveBeenLastCalledWith(FIRST_RUN);
        unsubscribe();
        listener.receive(SECOND_RUN.endpoint, SECOND_RUN.token);
        expect(handler).toHaveBeenCalledTimes(2);
    });

    it('reads Hyper links from the data parameter of app links', () => {
        const listener = new LinkListener(new TestLogger());
        const handler = vi.fn();
        listener.subscribeHyperLinks(handler);
        const encode = (event: unknown) => BASE64URL_CODEC.encode(new TextEncoder().encode(JSON.stringify(event)).buffer);
        for (const data of [
            encode({ hyperLink: { endpoint: 'http://127.0.0.1:7484/', token: 'secret' } }),
            encode({ hyperLink: { endpoint: 'http://hyper.example', token: 'secret' } }),
        ]) {
            const event = listener.readAppEvent(data, 'test');
            if (event != null) listener.dispatchAppEvent(event);
        }
        expect(handler.mock.calls).toEqual([[{ endpoint: 'http://127.0.0.1:7484', token: 'secret' }]]);
    });
});
