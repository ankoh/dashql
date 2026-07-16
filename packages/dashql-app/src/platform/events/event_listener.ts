import * as app_event from '@ankoh/dashql-jsonschema/app_event.js';
import * as buf from "@bufbuild/protobuf";

import { BASE64URL_CODEC } from '../../utils/base64.js';
import { Logger, stringifyError } from '../logger/logger.js';
import { PlatformDragDropEventVariant, SETUP_SESSION, SetupEventVariant } from './event.js';

const LOG_CTX = "event_listener";
export const EVENT_QUERY_PARAMETER = "data";

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
}

export abstract class PlatformEventListener {
    /// The logger
    protected logger: Logger;

    /// The oauth subscriber.
    /// There can only be a single OAuth subscriber at a single point in time.
    private oAuthSubscriber: OAuthSubscriber | null = null;
    /// The setup subscriber.
    /// There can only be a single navigation subscribe at a single point in time
    private setupSubscriber: ((data: SetupEventVariant) => void) | null = null;
    /// The queued notebook setup (if any)
    private queuedSetupEvent: SetupEventVariant | null;
    /// The clipboard subscriber
    private clipboardEventHandler: (e: ClipboardEvent) => void;
    /// The drag event subscriber
    private dragDropEventSubscribers: Map<string, (e: PlatformDragDropEventVariant) => void>;

    /// Constructor
    constructor(logger: Logger) {
        this.logger = logger;
        this.oAuthSubscriber = null;
        this.setupSubscriber = null;
        this.queuedSetupEvent = null;
        this.clipboardEventHandler = this.processClipboardEvent.bind(this);
        this.dragDropEventSubscribers = new Map();
    }

    /// Method to setup the listener
    public async setup(): Promise<void> {
        await this.listenForAppEvents();
        this.listenForClipboardEvents();
    }

    /// Method to setup the listener for app events
    protected abstract listenForAppEvents(): Promise<void>;

    /// Called by subclasses when receiving an app event
    public dispatchAppEvent(event: app_event.AppEventData) {
        if ('oauthRedirect' in event) {
            this.dispatchOAuthRedirect(event.oauthRedirect);
        } else if ('session' in event) {
            // Decode base64url session data to Uint8Array
            const sessionBuffer = BASE64URL_CODEC.decode(event.session);
            const sessionBytes = new Uint8Array(sessionBuffer);
            const setupEvent: SetupEventVariant = {
                type: SETUP_SESSION,
                value: sessionBytes
            };
            this.dispatchSetup(setupEvent);
        }
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
            sub.signal.removeEventListener("abort", sub.abortListener!);
            this.oAuthSubscriber = null;
            if (!sub.signal.aborted) {
                sub.resolve(data)
            }
        }
    }
    /// Dispatch a drag/drop event to all subscribers
    protected dispatchDragDrop(event: PlatformDragDropEventVariant) {
        for (const [_k, v] of this.dragDropEventSubscribers) {
            v(event);
        }
    }

    /// Wait for the oauth code to arrive
    public async waitForOAuthRedirect(signal: AbortSignal): Promise<app_event.OAuthRedirectData> {
        // Already set?
        if (this.oAuthSubscriber != null) {
            // Just throw, we don't support multiple outstanding listeners
            return Promise.reject(new Error("duplicate oauth listener"));
        } else {
            // Setup the subscriber
            return new Promise<app_event.OAuthRedirectData>((resolve, reject) => {
                const subscriber: OAuthSubscriber = {
                    signal,
                    resolve,
                    reject,
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

    /// Subscribe navigation events
    public subscribeSetupEvents(handler: (data: SetupEventVariant) => void): void {
        if (this.setupSubscriber) {
            this.logger.error("Tried to register more than one notebook setup subscriber", {}, LOG_CTX);
            return;
        }
        this.logger.info("Subscribing to notebook setup events", {}, LOG_CTX);
        this.setupSubscriber = handler;

        // Is there a pending notebook setup?
        if (this.queuedSetupEvent != null) {
            const setup = this.queuedSetupEvent;
            this.queuedSetupEvent = null;
            this.logger.info("Dispatching buffered notebook setup event", {}, LOG_CTX);
            this.setupSubscriber(setup);
        }
    }
    /// Unsubscribe from notebook setup events
    public unsubscribeSetupEvents(handler: (data: SetupEventVariant) => void): void {
        if (this.setupSubscriber != handler) {
            this.logger.error("Tried to unregister a notebook setup subscriber that is not registered", {}, LOG_CTX);
        } else {
            this.setupSubscriber = null;
        }
    }

    /// Subscribe drag-drop events
    public subscribeDragDropEvents(key: string, handler: (data: PlatformDragDropEventVariant) => void): void {
        this.dragDropEventSubscribers.set(key, handler);
    }
    /// Unsubscribe drag-drop events
    public unsubscribeDragDropEvents(key: string): void {
        this.dragDropEventSubscribers.delete(key);
    }

    /// Method to listen for pasted dashql links
    private listenForClipboardEvents() {
        this.logger.info("Subscribing to clipboard events", {}, LOG_CTX);
        // Use capture phase on document so we see paste events even when an input field
        // has focus (inputs otherwise consume the event before it reaches window).
        document.addEventListener("paste", this.clipboardEventHandler, true);
    }

    /// Helper to unpack app link data
    public readAppEvent(dataBase64: any, fromWhat: string) {
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
            const event: app_event.AppEventData = JSON.parse(dataJson);
            this.logger.info(`Parsed app event`, {}, LOG_CTX);
            return event;

        } catch (error: any) {
            this.logger.info(`Event does not encode valid link data`, { "source": fromWhat }, LOG_CTX);

            return null;
        }
    }


    /// Helper to process a clipboard event
    private processClipboardEvent(event: ClipboardEvent) {
        const pastedText = event.clipboardData?.getData("text/plain") ?? null;
        if (pastedText == null) return;

        let eventData: string | null = null;
        if (pastedText.startsWith("dashql://")) {
            // Deep link format: dashql://localhost?data=<base64>
            try {
                const deepLink = new URL(pastedText);
                this.logger.info("Received deep link", { "link": deepLink.toString() }, LOG_CTX);
                eventData = deepLink.searchParams.get(EVENT_QUERY_PARAMETER);
                if (!eventData) {
                    this.logger.warn("Deep link lacks the data query parameter", {}, LOG_CTX);
                    return;
                }
            } catch (e: any) {
                this.logger.warn("Failed to parse deep link", { "error": stringifyError(e) }, LOG_CTX);
                return;
            }
        } else if (BASE64URL_CODEC.isValidBase64(pastedText.trim())) {
            // Raw base64 event data pasted directly (web opener flow fallback)
            eventData = pastedText.trim();
        } else {
            return;
        }

        const data = this.readAppEvent(eventData, `clipboard data`);
        if (data != null) {
            event.preventDefault();
            event.stopPropagation();
            this.dispatchAppEvent(data);
        }
    }
}
