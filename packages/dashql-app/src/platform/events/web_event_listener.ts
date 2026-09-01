import { Logger } from '../logger/logger.js';
import { PlatformEventListener } from "./event_listener.js";
import { WebFile } from '../file/web_file.js';
import { DRAG_EVENT, DRAG_STOP_EVENT, DROP_EVENT, OAUTH_BROADCAST_CHANNEL, PlatformDragEvent, PlatformDropEvent, isAppEventPostMessage } from './event.js';

const DRAG_TIMEOUT = 100;

export class WebPlatformEventListener extends PlatformEventListener {
    private readonly onWindowMessage: (event: any) => void;
    private readonly oauthBroadcastChannel: BroadcastChannel;
    private readonly onWindowDragOver: (event: DragEvent) => void;
    private readonly onWindowDragEnd: (event: DragEvent) => void;
    private readonly onWindowDrop: (event: DragEvent) => void;
    private dragTimeoutId: ReturnType<typeof setTimeout> | null;

    constructor(logger: Logger) {
        super(logger);
        this.onWindowMessage = this.processMessageEvent.bind(this);
        this.oauthBroadcastChannel = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
        this.onWindowDragOver = this.processDragOverEvent.bind(this);
        this.onWindowDragEnd = this.processDragEndEvent.bind(this);
        this.onWindowDrop = this.processDropEvent.bind(this);
        this.dragTimeoutId = null;
    }

    public async listenForAppEvents(): Promise<void> {
        this.oauthBroadcastChannel.onmessage = (event: MessageEvent) => {
            const data = this.readAppEvent(event.data, `broadcast channel`);
            if (data != null) {
                super.dispatchAppEvent(data);
            }
        };
        window.addEventListener("message", this.onWindowMessage);
        // Capture drop events before stale hot-reload listeners can process the same file.
        window.addEventListener("dragover", this.onWindowDragOver, true);
        window.addEventListener("dragend", this.onWindowDragEnd, true);
        window.addEventListener("drop", this.onWindowDrop, true);
    }

    protected stopListeningForAppEvents(): void {
        this.oauthBroadcastChannel.onmessage = null;
        window.removeEventListener("message", this.onWindowMessage);
        window.removeEventListener("dragover", this.onWindowDragOver, true);
        window.removeEventListener("dragend", this.onWindowDragEnd, true);
        window.removeEventListener("drop", this.onWindowDrop, true);
        this.clearDragTimeout();
    }

    private clearDragTimeout(): void {
        if (this.dragTimeoutId == null) return;
        clearTimeout(this.dragTimeoutId);
        this.dragTimeoutId = null;
    }

    private processDragOverEvent(event: DragEvent): void {
        event.preventDefault();
        this.clearDragTimeout();
        const dragEvent: PlatformDragEvent = { pageX: event.pageX, pageY: event.pageY };
        this.dispatchDragDrop({ type: DRAG_EVENT, value: dragEvent });
        this.dragTimeoutId = setTimeout(() => {
            this.dragTimeoutId = null;
            this.dispatchDragDrop({ type: DRAG_STOP_EVENT, value: null });
        }, DRAG_TIMEOUT);
    }

    private processDragEndEvent(event: DragEvent): void {
        event.preventDefault();
        this.clearDragTimeout();
        this.dispatchDragDrop({ type: DRAG_STOP_EVENT, value: null });
    }

    private processDropEvent(event: DragEvent): void {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.clearDragTimeout();
        const file = event.dataTransfer?.files.item(0);
        if (file == null) {
            this.dispatchDragDrop({ type: DRAG_STOP_EVENT, value: null });
            return;
        }
        const dropEvent: PlatformDropEvent = {
            pageX: event.pageX,
            pageY: event.pageY,
            file: new WebFile(file, file.name),
        };
        this.dispatchDragDrop({ type: DROP_EVENT, value: dropEvent });
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
