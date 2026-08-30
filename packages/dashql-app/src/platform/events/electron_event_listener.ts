import { Logger } from '../logger/logger.js';
import { WebPlatformEventListener } from './web_event_listener.js';

const LOG_CTX = "electron_event_listener";

export class ElectronPlatformEventListener extends WebPlatformEventListener {
    public async listenForAppEvents(): Promise<void> {
        await super.listenForAppEvents();
        const bridge = globalThis.dashqlElectron;
        if (bridge === undefined) {
            this.logger.warn("Electron bridge is unavailable", {}, LOG_CTX);
            return;
        }

        const dispatch = (link: { type: "event" | "notebook"; value: string }, source: string) => {
            if (link.type === "notebook") {
                this.dispatchNotebookUrl(link.value);
                return;
            }
            const event = this.readAppEvent(link.value, source);
            if (event !== null) super.dispatchAppEvent(event);
        };
        bridge.onDeepLink((link) => dispatch(link, "Electron deep link"));
        for (const link of await bridge.getInitialDeepLinks()) {
            dispatch(link, "initial Electron deep link");
        }
    }
}
