import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { APP_EVENT_POST_MESSAGE_KIND, OAUTH_BROADCAST_CHANNEL } from '../platform/events/event.js';
import { BASE64URL_CODEC } from '../utils/base64.js';
import { RedirectPage } from './oauth_redirect.js';
import type { AppEventData, OAuthState } from './oauth_types.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const PAGE_ORIGIN = 'https://dashql.app';
const AUTO_TRIGGER_DELAY = 2000;
const CODE_LIFETIME = 60_000;

function encodeState(state: unknown): string {
    return BASE64URL_CODEC.encode(new TextEncoder().encode(JSON.stringify(state)).buffer);
}

function decodeEvent(encoded: string): AppEventData {
    return JSON.parse(new TextDecoder().decode(BASE64URL_CODEC.decode(encoded))) as AppEventData;
}

function oauthState(overrides: Partial<OAuthState> = {}): OAuthState {
    return {
        flowId: 'flow-1',
        flowVariant: 'WEB_OPENER_FLOW',
        debugMode: false,
        salesforceProvider: {
            instanceUrl: 'https://login.salesforce.example',
            appConsumerKey: 'consumer-key',
            requestedAt: Date.now(),
            expiresAt: Date.now() + CODE_LIFETIME,
        },
        ...overrides,
    };
}

describe('the OAuth redirect page', () => {
    let container: HTMLDivElement;
    let root: Root | null;
    let replaceLocation: ReturnType<typeof vi.fn<(url: string) => void>>;
    let windowOpen: ReturnType<typeof vi.spyOn>;
    let windowClose: ReturnType<typeof vi.spyOn>;
    let channels: Array<{ name: string; messages: unknown[]; closed: boolean }>;
    const OriginalBroadcastChannel = globalThis.BroadcastChannel;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        replaceLocation = vi.fn<(url: string) => void>();
        // Opening the deep link and closing the popup would navigate the test frame away
        windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
        windowClose = vi.spyOn(window, 'close').mockImplementation(() => { });
        channels = [];
        vi.stubGlobal('BroadcastChannel', class {
            private readonly record: { name: string; messages: unknown[]; closed: boolean };
            constructor(name: string) {
                this.record = { name, messages: [], closed: false };
                channels.push(this.record);
            }
            postMessage(message: unknown) { this.record.messages.push(message); }
            close() { this.record.closed = true; }
        });
    });
    afterEach(() => {
        if (root != null) act(() => root!.unmount());
        container.remove();
        windowOpen.mockRestore();
        windowClose.mockRestore();
        vi.useRealTimers();
        vi.stubGlobal('BroadcastChannel', OriginalBroadcastChannel);
        (window as { opener: unknown }).opener = null;
    });

    /// Render the page for the query of a redirect
    async function renderPage(query: URLSearchParams): Promise<void> {
        const dependencies = {
            currentUrl: () => new URL(`${PAGE_ORIGIN}/oauth.html?${query.toString()}`),
            replaceLocation,
        };
        await act(async () => {
            root!.render(
                <MemoryRouter initialEntries={[`/oauth.html?${query.toString()}`]}>
                    <LoggerProvider>
                        <RedirectPage dependencies={dependencies} />
                    </LoggerProvider>
                </MemoryRouter>,
            );
        });
    }
    const renderState = (state: OAuthState, params: Record<string, string> = { code: 'the-code' }) =>
        renderPage(new URLSearchParams({ ...params, state: encodeState(state) }));
    const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
    const inputValues = () => [...container.querySelectorAll('input')].map(input => input.value);
    const buttonWithText = (text: string) => [...container.querySelectorAll('button')].find(button => button.textContent?.includes(text));

    describe('a popup of the web app', () => {
        it('sends the code to the app after the delay and closes itself', async () => {
            const state = oauthState();
            const opener = { postMessage: vi.fn() };
            (window as { opener: unknown }).opener = opener;
            await renderState(state);
            expect(container.textContent).toContain('Authorization Succeeded');

            await advance(AUTO_TRIGGER_DELAY - 1);
            expect(channels).toEqual([]);
            expect(windowClose).not.toHaveBeenCalled();

            await advance(1);
            expect(channels.map(channel => channel.name)).toEqual([OAUTH_BROADCAST_CHANNEL]);
            expect(channels[0].closed).toBe(true);
            const event = decodeEvent(channels[0].messages[0] as string);
            expect(event.oauthRedirect?.code).toBe('the-code');
            expect(event.oauthRedirect?.state.flowId).toBe('flow-1');
            // The result only goes to an opener of the same origin
            expect(opener.postMessage).toHaveBeenCalledWith(
                { kind: APP_EVENT_POST_MESSAGE_KIND, data: channels[0].messages[0] },
                window.location.origin,
            );
            expect(windowClose).toHaveBeenCalledOnce();
            expect(windowOpen).not.toHaveBeenCalled();
        });

        it('uses the broadcast channel alone when the opener is gone', async () => {
            await renderState(oauthState());
            await advance(AUTO_TRIGGER_DELAY);
            expect(channels[0].messages.length).toBe(1);
            expect(windowClose).toHaveBeenCalledOnce();
        });

        it('offers the event data to copy when the app did not get it', async () => {
            await renderState(oauthState());
            expect(container.textContent).toContain('copy the event data');
            const encoded = inputValues().find(value => decodeEventOrNull(value)?.oauthRedirect != null);
            expect(decodeEvent(encoded!).oauthRedirect?.code).toBe('the-code');
            expect(container.querySelector('[aria-label="copy-event-data"]')).not.toBeNull();
        });

        it('does not send anything once the page is gone', async () => {
            await renderState(oauthState());
            act(() => root!.unmount());
            root = null;
            await advance(AUTO_TRIGGER_DELAY);
            expect(channels).toEqual([]);
            expect(windowClose).not.toHaveBeenCalled();
        });
    });

    describe('a native app', () => {
        it('opens the deep link after the delay', async () => {
            await renderState(oauthState({ flowVariant: 'NATIVE_LINK_FLOW' }));
            expect(buttonWithText('Open in App')?.textContent).toContain('2');
            await advance(AUTO_TRIGGER_DELAY);
            expect(windowOpen).toHaveBeenCalledOnce();
            const [link, target] = windowOpen.mock.calls[0] as [string, string];
            expect(target).toBe('_self');
            const url = new URL(link);
            expect(url.protocol).toBe('dashql:');
            expect(decodeEvent(url.searchParams.get('data')!).oauthRedirect?.code).toBe('the-code');
            expect(windowClose).not.toHaveBeenCalled();
        });

        it('counts down to the deep link and offers to open it again', async () => {
            await renderState(oauthState({ flowVariant: 'NATIVE_LINK_FLOW' }));
            await advance(1000);
            expect(buttonWithText('Open in App')?.textContent).toBe('Open in App1');
            await advance(1000);
            expect(buttonWithText('Open in App')?.textContent).toBe('Open in App');
            await act(async () => buttonWithText('Open in App')!.click());
            expect(windowOpen).toHaveBeenCalledTimes(2);
            expect(container.querySelector('[aria-label="copy-deeplink"]')).not.toBeNull();
        });

        it('opens the deep link at once with the button', async () => {
            await renderState(oauthState({ flowVariant: 'NATIVE_LINK_FLOW' }));
            await act(async () => buttonWithText('Open in App')!.click());
            expect(windowOpen).toHaveBeenCalledOnce();
        });

        it('shows the link instead of opening it in debug mode, a debug build has no deep link handler', async () => {
            await renderState(oauthState({ flowVariant: 'NATIVE_LINK_FLOW', debugMode: true }));
            await advance(AUTO_TRIGGER_DELAY * 2);
            expect(windowOpen).not.toHaveBeenCalled();
            expect(container.textContent).toContain('cannot register as deep link handler');
            const link = inputValues().find(value => value.startsWith('dashql://'));
            expect(decodeEvent(new URL(link!).searchParams.get('data')!).oauthRedirect?.code).toBe('the-code');
        });
    });

    describe('the result of the provider', () => {
        it('reports an error of the provider and sends it to the app', async () => {
            await renderState(oauthState(), { error: 'access_denied', error_description: 'The user said no' });
            expect(container.textContent).toContain('Authorization Failed');
            expect(container.textContent).toContain('The user said no');
            await advance(AUTO_TRIGGER_DELAY);
            const event = decodeEvent(channels[0].messages[0] as string);
            expect(event.oauthRedirect?.code).toBeUndefined();
            expect(event.oauthRedirect?.error).toBe('access_denied');
            expect(event.oauthRedirect?.errorDescription).toBe('The user said no');
        });

        it('shows the error code without a description', async () => {
            await renderState(oauthState(), { error: 'access_denied' });
            expect(container.textContent).toContain('access_denied');
        });

        it('reports a missing code', async () => {
            await renderState(oauthState(), {});
            expect(container.textContent).toContain('Code is empty');
        });

        it('shows the provider of the code and when the code expires', async () => {
            await renderState(oauthState());
            expect(inputValues()).toEqual(expect.arrayContaining(['https://login.salesforce.example', 'consumer-key', 'the-code']));
            expect(container.textContent).toContain('Code expires');
            expect(container.textContent).not.toContain('Code is expired');
        });

        it('marks the code as expired once its time ran out', async () => {
            await renderState(oauthState({ flowVariant: 'NATIVE_LINK_FLOW', debugMode: true }));
            await advance(CODE_LIFETIME + 1);
            expect(container.textContent).toContain('Code is expired');
        });
    });

    describe('a state that cannot be trusted', () => {
        const expectFailed = (message: string) => {
            expect(container.textContent).toContain('Authorization Failed');
            expect(container.textContent).toContain(message);
            expect(replaceLocation).not.toHaveBeenCalled();
        };

        afterEach(async () => {
            // A failed page never hands anything to an app
            await advance(AUTO_TRIGGER_DELAY);
            expect(channels).toEqual([]);
            expect(windowOpen).not.toHaveBeenCalled();
            expect(windowClose).not.toHaveBeenCalled();
        });

        it('fails without a state', async () => {
            await renderPage(new URLSearchParams({ code: 'the-code' }));
            expect(container.textContent).toContain('Authorization Failed');
        });

        it('fails with a state that is no JSON', async () => {
            await renderPage(new URLSearchParams({ code: 'the-code', state: 'bm90IGpzb24' }));
            expect(container.textContent).toContain('Authorization Failed');
        });

        it('fails with an expired state', async () => {
            const state = oauthState();
            state.salesforceProvider!.expiresAt = Date.now() - 1;
            await renderState(state);
            expectFailed('OAuth state has expired');
        });

        it('fails with an unspecified flow', async () => {
            await renderState(oauthState({ flowVariant: 'UNSPECIFIED_FLOW' }));
            expectFailed('OAuth state has an invalid flow variant');
        });

        it('does not forward the code to a foreign origin', async () => {
            await renderState(oauthState({ callbackUrl: 'https://attacker.example/oauth.html' }));
            expectFailed('OAuth callback URL is not allowed');
        });

        it('does not forward the code to another page of an allowed origin', async () => {
            await renderState(oauthState({ callbackUrl: 'https://hyperdb.sh/steal.html' }));
            expectFailed('OAuth callback URL is not allowed');
        });

        it('does not forward the code to an url that is none', async () => {
            await renderState(oauthState({ callbackUrl: 'not a url' }));
            expectFailed('OAuth callback URL is not allowed');
        });
    });

    describe('a callback url', () => {
        it('forwards every parameter of the redirect to an allowed origin', async () => {
            const state = oauthState({ callbackUrl: 'http://localhost:9002/oauth.html' });
            const query = new URLSearchParams({ code: 'the-code', state: encodeState(state) });
            await renderPage(query);
            expect(replaceLocation).toHaveBeenCalledWith(`http://localhost:9002/oauth.html?${query.toString()}`);
            expect(container.textContent).toBe('');
            // The page at the callback url finishes the flow
            await advance(AUTO_TRIGGER_DELAY);
            expect(channels).toEqual([]);
            expect(windowClose).not.toHaveBeenCalled();
        });

        it('stays on the page for its own origin', async () => {
            await renderState(oauthState({ callbackUrl: `${PAGE_ORIGIN}/oauth.html` }));
            expect(replaceLocation).not.toHaveBeenCalled();
            expect(container.textContent).toContain('Authorization Succeeded');
        });
    });

    it('opens the logs', async () => {
        await renderState(oauthState());
        const logs = container.querySelector('[aria-label="open-logs"]') as HTMLButtonElement;
        const viewerIsOpen = () => document.querySelector('[aria-label="Download Logs as JSON"]') != null;
        expect(viewerIsOpen()).toBe(false);
        await act(async () => logs.click());
        expect(viewerIsOpen()).toBe(true);
    });
});

/// The event of a text field value, null if the value is no event
function decodeEventOrNull(value: string): AppEventData | null {
    try {
        return decodeEvent(value);
    } catch {
        return null;
    }
}
