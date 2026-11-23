import * as app_event from '@akohn/dashql-jsonschema/app_event.js';

import { BASE64URL_CODEC } from '@akohn/dashql/platform/utils/base64';
import { LEGACY_WORKBOOK_QUERY_PARAMETERS, migrateAppEventData } from './legacy_links.js';
import { Logger } from '@akohn/dashql/platform/logger/logger';
import { OAUTH_BROADCAST_CHANNEL, SETUP_WORKBOOK, SETUP_WORKBOOK_URL, SetupEventVariant, isAppEventPostMessage } from './event.js';
import { ZIP_QUERY_PARAMETER } from '../../workbook/persistence/workbook_link.js';

const LOG_CTX = "event_listener";

/// A Hyper link that points the app at a Hyper, e.g. the hyperd of `hyperd run --ui`: the base url of its HTTP API and
/// its bearer token. The link is an app event, `?data=` with the base64url JSON `{"hyperLink": {"endpoint": ..., "token": ...}}`,
/// the runtime reads its target (`Runtime.bindHyperLink`).
export interface HyperLinkEvent {
    endpoint: string;
    token: string;
}
export const EVENT_QUERY_PARAMETER = "data";
export const WORKBOOK_QUERY_PARAMETER = "workbook";

/// Read the URL of a hosted workbook from the query parameters of a link, links of older versions
/// use the legacy parameter
export function readWorkbookUrlParameter(params: URLSearchParams): string | null {
    for (const name of [WORKBOOK_QUERY_PARAMETER, ...LEGACY_WORKBOOK_QUERY_PARAMETERS]) {
        const value = params.get(name);
        if (value) return value;
    }
    return null;
}

type ClipboardSetup =
    | { type: "event", value: string }
    | { type: "workbook", value: string }
    | { type: "zip", value: string };

export function parseClipboardSetup(text: string): ClipboardSetup | null {
    let url: URL;
    try {
        url = new URL(text.trim());
    } catch {
        return null;
    }

    const isDashQLLink = url.protocol === "dashql:" && url.hostname === "localhost";
    const isProductionHost = url.hostname === "dashql.app" || url.hostname === "stable.dashql.app" ||
        url.hostname === "dev.dashql.app";
    const isProductionLink = url.protocol === "https:" && isProductionHost && url.port === "";
    const isDevelopmentLink = url.protocol === "http:" && url.hostname === "localhost" && url.port === "9002";
    if ((!isDashQLLink && !isProductionLink && !isDevelopmentLink) || url.username !== "" || url.password !== "") {
        return null;
    }

    const eventData = url.searchParams.get(EVENT_QUERY_PARAMETER);
    if (eventData) return { type: "event", value: eventData };
    const zip = url.searchParams.get(ZIP_QUERY_PARAMETER);
    if (zip) return { type: "zip", value: zip };
    const workbookUrl = readWorkbookUrlParameter(url.searchParams);
    return workbookUrl ? { type: "workbook", value: workbookUrl } : null;
}

// An oauth subscriber
interface OAuthSubscriber {
    /// Resolve the promise with oauth redirect data
    resolve: (data: app_event.OAuthRedirectData) => void;
    /// Reject with an error
    reject: (err: Error) => void;
    /// The abort signal provided by the client
    signal: AbortSignal;
    /// The listener for client cancellation
    abortListener: () => void;
    accepts: (data: app_event.OAuthRedirectData) => boolean;
}

/// The deep links of the desktop app, from the bridge of its preload script
export type DeepLinkBridge = Pick<DashQLElectronBridge, 'getInitialDeepLinks' | 'onDeepLink'>;

/// The events that reach the app from outside: app events posted by its windows or sent over the OAuth broadcast channel,
/// pasted links, and the deep links of the desktop app
export class PlatformEventListener {
    /// The logger
    protected logger: Logger;
    /// The deep links of the desktop app, null in the browser
    private readonly deepLinks: DeepLinkBridge | null;

    /// The oauth subscriber.
    /// There can only be a single OAuth subscriber at a single point in time.
    private oAuthSubscriber: OAuthSubscriber | null = null;
    /// The setup subscriber.
    /// There can only be a single navigation subscribe at a single point in time
    private setupSubscriber: ((data: SetupEventVariant) => void) | null = null;
    /// The queued workbook setup (if any)
    private queuedSetupEvent: SetupEventVariant | null = null;
    /// Subscribers for pasted text not handled as an app event
    private readonly fallbackPasteSubscribers = new Set<(text: string) => void>();
    /// The subscriber for Hyper links
    private hyperLinkSubscriber: ((target: HyperLinkEvent) => void) | null = null;
    /// The latest Hyper link that arrived without a subscriber
    private queuedHyperLink: HyperLinkEvent | null = null;
    /// Removes the global listeners, null while they are not installed
    private removeListeners: (() => void) | null = null;

    /// Constructor
    constructor(logger: Logger, deepLinks: DeepLinkBridge | null = null) {
        this.logger = logger;
        this.deepLinks = deepLinks;
    }

    /// Install the global listeners, once
    public async setup(): Promise<void> {
        if (this.removeListeners != null) return;
        const onWindowMessage = (event: MessageEvent) => this.processMessageEvent(event);
        const onPaste = (event: ClipboardEvent) => this.processClipboardEvent(event);
        const oauthBroadcastChannel = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
        oauthBroadcastChannel.onmessage = (event: MessageEvent) => {
            const data = this.readAppEvent(event.data, `broadcast channel`);
            if (data != null) this.dispatchAppEvent(data);
        };
        window.addEventListener("message", onWindowMessage);
        // Use capture phase on document so we see paste events even when an input field
        // has focus (inputs otherwise consume the event before it reaches window).
        this.logger.info("Subscribing to clipboard events", {}, LOG_CTX);
        document.addEventListener("paste", onPaste, true);
        const unsubscribeDeepLinks = this.deepLinks?.onDeepLink(link => this.dispatchDeepLink(link, "Electron deep link")) ?? null;
        this.removeListeners = () => {
            oauthBroadcastChannel.close();
            window.removeEventListener("message", onWindowMessage);
            document.removeEventListener("paste", onPaste, true);
            unsubscribeDeepLinks?.();
        };
        for (const link of await this.deepLinks?.getInitialDeepLinks() ?? []) {
            this.dispatchDeepLink(link, "initial Electron deep link");
        }
    }
    /// Remove the global listeners
    public dispose(): void {
        this.removeListeners?.();
        this.removeListeners = null;
        this.fallbackPasteSubscribers.clear();
    }

    /// Received a message posted to the window
    private processMessageEvent(event: MessageEvent) {
        // The global "message" listener also receives unrelated traffic (devtools
        // bridges, browser extensions, etc.). Only act on our own envelope.
        if (!isAppEventPostMessage(event.data)) {
            return;
        }
        if (event.origin !== window.location.origin) {
            return;
        }
        const data = this.readAppEvent(event.data.data, `event message`);
        if (data != null) {
            event.stopPropagation();
            event.preventDefault();
            this.dispatchAppEvent(data);
        }
    }

    /// Received a deep link of the desktop app
    private dispatchDeepLink(link: { type: "event" | "workbook" | "zip"; value: string }, source: string) {
        if (link.type === "workbook") {
            this.dispatchWorkbookUrl(link.value);
        } else if (link.type === "zip") {
            this.dispatchWorkbookZip(link.value);
        } else {
            const event = this.readAppEvent(link.value, source);
            if (event !== null) this.dispatchAppEvent(event);
        }
    }

    /// Received an app event
    public dispatchAppEvent(event: app_event.AppEventData) {
        if ('oauthRedirect' in event) {
            this.dispatchOAuthRedirect(event.oauthRedirect);
        } else if ('hyperLink' in event) {
            // Links are not validated against the schema, a malformed link is ignored
            const { endpoint, token } = (event.hyperLink ?? {}) as { endpoint?: unknown; token?: unknown };
            if (typeof endpoint !== 'string' || typeof token !== 'string') this.logger.warn("Ignoring an invalid Hyper link", {}, LOG_CTX);
            else this.dispatchHyperLink({ endpoint, token });
        } else if ('session' in event) {
            // Links of older versions carry the workbook ZIP in the app event, see dispatchWorkbookZip
            this.dispatchWorkbookZip(event.session);
        }
    }

    /// Received the base64url-encoded `.dashql` ZIP of a link, returns false when the text is no base64url
    public dispatchWorkbookZip(zipBase64: string): boolean {
        if (!BASE64URL_CODEC.isValidBase64(zipBase64)) {
            this.logger.warn("Ignoring a workbook link with invalid base64 data", {}, LOG_CTX);
            return false;
        }
        const setupEvent: SetupEventVariant = {
            type: SETUP_WORKBOOK,
            value: new Uint8Array(BASE64URL_CODEC.decode(zipBase64)),
        };
        this.dispatchSetup(setupEvent);
        return true;
    }

    public dispatchWorkbookUrl(url: string): void {
        this.dispatchSetup({ type: SETUP_WORKBOOK_URL, value: url });
    }

    /// Received a Hyper link, e.g. of `hyperd run --ui`
    protected dispatchHyperLink(target: HyperLinkEvent): void {
        if (this.hyperLinkSubscriber == null) {
            this.queuedHyperLink = target;
        } else {
            this.hyperLinkSubscriber(target);
        }
    }

    /// Subscribe to Hyper links, a link that arrived before is delivered right away. Returns the unsubscribe.
    public subscribeHyperLinks(handler: (target: HyperLinkEvent) => void): () => void {
        this.hyperLinkSubscriber = handler;
        const queued = this.queuedHyperLink;
        this.queuedHyperLink = null;
        if (queued != null) handler(queued);
        return () => {
            if (this.hyperLinkSubscriber === handler) this.hyperLinkSubscriber = null;
        };
    }

    /// Received navigation event
    protected dispatchSetup(event: SetupEventVariant) {
        if (!this.setupSubscriber) {
            this.logger.info("Queuing setup event since there's no registered subscriber", {}, LOG_CTX);
            this.queuedSetupEvent = event;
        } else {
            this.setupSubscriber(event);
        }
    }
    /// OAuth succeeded, let the subscriber now
    protected dispatchOAuthRedirect(data: app_event.OAuthRedirectData) {
        if (!this.oAuthSubscriber) {
            console.warn("Received oauth redirect data but there's no registered oauth subscriber", {}, LOG_CTX);
        } else {
            const sub = this.oAuthSubscriber;
            if (!sub.accepts(data)) {
                return;
            }
            sub.signal.removeEventListener("abort", sub.abortListener!);
            this.oAuthSubscriber = null;
            if (!sub.signal.aborted) {
                sub.resolve(data)
            }
        }
    }
    /// Wait for the oauth code to arrive
    public async waitForOAuthRedirect(
        signal: AbortSignal,
        accepts: (data: app_event.OAuthRedirectData) => boolean = () => true,
    ): Promise<app_event.OAuthRedirectData> {
        if (signal.aborted) {
            // An aborted signal fires no abort event, the subscriber would stay registered
            return Promise.reject(signal.reason);
        } else if (this.oAuthSubscriber != null) {
            // Just throw, we don't support multiple outstanding listeners
            return Promise.reject(new Error("duplicate oauth listener"));
        } else {
            // Setup the subscriber
            return new Promise<app_event.OAuthRedirectData>((resolve, reject) => {
                const subscriber: OAuthSubscriber = {
                    signal,
                    resolve,
                    reject,
                    accepts,
                    abortListener: () => { }
                };
                subscriber.abortListener = () => {
                    const sub = this.oAuthSubscriber;
                    if (!sub) {
                        return;
                    }
                    this.oAuthSubscriber = null;
                    sub.signal.removeEventListener("abort", sub.abortListener!);
                    sub.reject({
                        name: "AbortError",
                        message: "Waiting for oauth code was aborted"
                    });
                }
                signal.addEventListener("abort", subscriber.abortListener);
                this.oAuthSubscriber = subscriber;
            });
        }
    }

    /// Subscribe to workbook setup events, an event that arrived before is delivered right away. Returns the
    /// unsubscribe.
    public subscribeSetupEvents(handler: (data: SetupEventVariant) => void): () => void {
        if (this.setupSubscriber) {
            this.logger.warn("Tried to register more than one workbook setup subscriber", {}, LOG_CTX);
            return () => { };
        }
        this.logger.info("Subscribing to workbook setup events", {}, LOG_CTX);
        this.setupSubscriber = handler;

        // Is there a pending workbook setup?
        if (this.queuedSetupEvent != null) {
            const setup = this.queuedSetupEvent;
            this.queuedSetupEvent = null;
            this.logger.info("Dispatching buffered workbook setup event", {}, LOG_CTX);
            this.setupSubscriber(setup);
        }
        return () => {
            if (this.setupSubscriber === handler) this.setupSubscriber = null;
        };
    }

    /// Subscribe to pasted text that is not recognized as an app event. Returns the unsubscribe.
    public subscribeFallbackPasteEvents(handler: (text: string) => void): () => void {
        this.fallbackPasteSubscribers.add(handler);
        return () => { this.fallbackPasteSubscribers.delete(handler); };
    }

    /// Helper to unpack app link data
    public readAppEvent(dataBase64: unknown, fromWhat: string) {
        // Make sure everything arriving here is a valid base64 string
        if (!dataBase64 || typeof dataBase64 !== 'string') {
            this.logger.trace("Skipping app event with non-string data", {}, LOG_CTX);
            return null;
        }
        if (dataBase64.startsWith("webpackHotUpdate")) {
            this.logger.debug("Received hot update", {
                event: dataBase64,
            }, LOG_CTX);
            return null;
        }
        // Is a valid base64?
        if (!BASE64URL_CODEC.isValidBase64(dataBase64)) {
            this.logger.trace("Skipping app event with invalid base64 data", {}, LOG_CTX);
            return null;
        }
        // Try to parse as app event data
        try {
            const dataBuffer = BASE64URL_CODEC.decode(dataBase64);
            const dataJson = new TextDecoder().decode(dataBuffer);
            // Links of older versions name the event fields differently
            const event = migrateAppEventData(JSON.parse(dataJson)) as app_event.AppEventData;
            this.logger.info(`Parsed app event`, {}, LOG_CTX);
            return event;

        } catch {
            this.logger.info(`Event does not encode valid link data`, { "source": fromWhat }, LOG_CTX);

            return null;
        }
    }


    /// Helper to process a clipboard event
    private processClipboardEvent(event: ClipboardEvent) {
        const clipboardText = event.clipboardData?.getData("text/plain") ?? null;
        if (clipboardText == null) return;
        const pastedText = clipboardText.trim();

        const setup = parseClipboardSetup(pastedText);
        let eventData: string;
        if (setup?.type === "event") {
            eventData = setup.value;
        } else if (setup?.type === "workbook") {
            event.preventDefault();
            event.stopPropagation();
            this.dispatchWorkbookUrl(setup.value);
            return;
        } else if (setup?.type === "zip") {
            if (this.dispatchWorkbookZip(setup.value)) {
                event.preventDefault();
                event.stopPropagation();
            } else {
                this.dispatchFallbackPaste(event, clipboardText);
            }
            return;
        } else if (BASE64URL_CODEC.isValidBase64(pastedText)) {
            // Raw base64 event data pasted directly (web opener flow fallback)
            eventData = pastedText;
        } else {
            this.dispatchFallbackPaste(event, clipboardText);
            return;
        }

        const data = this.readAppEvent(eventData, `clipboard data`);
        if (data != null) {
            event.preventDefault();
            event.stopPropagation();
            this.dispatchAppEvent(data);
        } else {
            this.dispatchFallbackPaste(event, clipboardText);
        }
    }

    private dispatchFallbackPaste(event: ClipboardEvent, text: string): void {
        if (this.fallbackPasteSubscribers.size === 0) return;
        event.preventDefault();
        event.stopPropagation();
        for (const subscriber of this.fallbackPasteSubscribers) {
            subscriber(text);
        }
    }
}
