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

        const dispatch = (data: string, source: string) => {
            const event = this.readAppEvent(data, source);
            if (event !== null) super.dispatchAppEvent(event);
        };
        bridge.onDeepLink((data) => dispatch(data, "Electron deep link"));
        for (const data of await bridge.getInitialDeepLinks()) {
            dispatch(data, "initial Electron deep link");
        }
    }
}
