import { Logger } from '@akohn/dashql/platform/logger/logger';
import { PlatformEventListener } from "./event_listener.js";
import { OAUTH_BROADCAST_CHANNEL, isAppEventPostMessage } from './event.js';

export class WebPlatformEventListener extends PlatformEventListener {
    private readonly onWindowMessage: (event: MessageEvent) => void;
    private readonly oauthBroadcastChannel: BroadcastChannel;

    constructor(logger: Logger) {
        super(logger);
        this.onWindowMessage = this.processMessageEvent.bind(this);
        this.oauthBroadcastChannel = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
    }

    public async listenForAppEvents(): Promise<void> {
        this.oauthBroadcastChannel.onmessage = (event: MessageEvent) => {
            const data = this.readAppEvent(event.data, `broadcast channel`);
            if (data != null) {
                super.dispatchAppEvent(data);
            }
        };
        window.addEventListener("message", this.onWindowMessage);
    }

    protected stopListeningForAppEvents(): void {
        this.oauthBroadcastChannel.onmessage = null;
        window.removeEventListener("message", this.onWindowMessage);
    }

    protected processMessageEvent(event: MessageEvent) {
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
            super.dispatchAppEvent(data);
        }
    }
}
