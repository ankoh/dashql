import { describe, expect, it, vi } from 'vitest';

import type { SessionScripts } from '../session/scripts/session_scripts.js';
import { sessionOnConnection } from './hyper_links.js';
import { WebPlatformEventListener } from '../../platform/events/web_event_listener.js';
import { Logger } from '../../platform/logger/logger.js';
import { BASE64URL_CODEC } from '../../utils/base64.js';

class NullLogger extends Logger {
    public destroy(): void {}
    protected flushPendingRecords(): void {}
}

const FIRST_RUN = { endpoint: 'http://127.0.0.1:1111', token: 'first' };
const SECOND_RUN = { endpoint: 'http://127.0.0.1:2222', token: 'second' };

describe('the session that a link opens', () => {
    const sessions = new Map(Object.entries({ first: 'embedded', second: 'linked', third: 'linked' })
        .map(([sessionId, connectionId]) => [sessionId, { sessionId, connectionId } as SessionScripts]));

    it('stays in the open session on the connection of the link', () => {
        expect(sessionOnConnection(sessions, 'third', 'linked')).toBe('third');
    });

    it('opens the first session on the connection of the link', () => {
        expect(sessionOnConnection(sessions, 'first', 'linked')).toBe('second');
        expect(sessionOnConnection(sessions, null, 'linked')).toBe('second');
    });

    it('needs a new session without one on the connection of the link', () => {
        expect(sessionOnConnection(sessions, 'first', 'other')).toBeNull();
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
        const listener = new LinkListener(new NullLogger());
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
        const listener = new LinkListener(new NullLogger());
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
