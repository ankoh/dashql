import type { OAuthFlow, OAuthFlowEvent, OAuthLoopbackCallback } from '@ankoh/dashql-runtime/oauth/oauth_flow';
import type { OAuthRedirectData } from '@ankoh/dashql-runtime/oauth/oauth_types';
import { isDebugBuild } from '../globals.js';
import type { PlatformEventListener } from '../platform/events/event_listener.js';
import { PlatformType } from '../platform/platform_type.js';

const OAUTH_POPUP_NAME = 'DashQL OAuth';
const OAUTH_POPUP_SETTINGS = 'toolbar=no, menubar=no, width=600, height=700, top=100, left=100';

/// The OAuth flow of the app. In a browser the authorization page opens in a popup and the redirect page posts the
/// callback back to it. In the desktop app it opens in the browser of the system, and the redirect page hands the
/// callback back as a link of the app or the loopback server of the desktop app receives it.
export class AppOAuthFlow implements OAuthFlow {
    constructor(
        protected readonly appEvents: PlatformEventListener,
        protected readonly platformType: PlatformType,
        /// A window that a dialog opened during the click, a browser opens one only during a user gesture
        protected readonly reservedPopup: Window | null = null,
    ) {}

    get redirectVariant(): OAuthFlow['redirectVariant'] {
        return this.platformType === PlatformType.WEB ? 'WEB_OPENER_FLOW' : 'NATIVE_LINK_FLOW';
    }
    get redirectCallbackUrl(): string | null {
        return this.platformType === PlatformType.WEB ? new URL('/oauth.html', window.location.origin).toString() : null;
    }
    get debugMode(): boolean {
        return isDebugBuild();
    }
    get flavor(): string | null {
        // The redirect page cannot see the flavor of the app, the url of the redirect is fixed by the connected app.
        // The flavor provider brands the document with the resolved flavor, pass that one through the state.
        return globalThis.document?.documentElement.dataset.flavor ?? null;
    }

    async authorizeWithRedirectPage(
        authorizationUrl: URL,
        accepts: (callback: OAuthRedirectData) => boolean,
        signal: AbortSignal,
        onEvent: (event: OAuthFlowEvent) => void,
    ): Promise<OAuthRedirectData> {
        let popup: Window | null = this.reservedPopup;
        try {
            if (this.platformType !== PlatformType.WEB) {
                const bridge = globalThis.dashqlElectron;
                if (!bridge) throw new Error('desktop OAuth bridge is unavailable');
                await bridge.openExternal(authorizationUrl.toString());
                onEvent('EXTERNAL_BROWSER_OPENED');
            } else {
                if (popup) {
                    popup.location.replace(authorizationUrl.toString());
                } else {
                    popup = window.open(authorizationUrl, OAUTH_POPUP_NAME, OAUTH_POPUP_SETTINGS);
                    if (!popup) throw new Error('could not open oauth window');
                }
                popup.focus();
                onEvent('WINDOW_OPENED');
            }
            return await this.appEvents.waitForOAuthRedirect(signal, accepts as never) as OAuthRedirectData;
        } finally {
            if (popup) {
                if (!popup.closed) popup.close();
                onEvent('WINDOW_CLOSED');
            }
        }
    }

    async authorizeWithLoopback(
        authorizationUrl: URL,
        callbackUrl: string,
        signal: AbortSignal,
        onEvent: (event: OAuthFlowEvent) => void,
    ): Promise<OAuthLoopbackCallback> {
        const bridge = globalThis.dashqlElectron;
        if (!bridge) throw new Error('the OAuth redirect to a loopback address requires the DashQL desktop app');
        const loopbackId = await bridge.oauthLoopback.listen(callbackUrl);
        const onAbort = () => void bridge.oauthLoopback.close(loopbackId);
        signal.addEventListener('abort', onAbort, { once: true });
        try {
            signal.throwIfAborted();
            await bridge.openExternal(authorizationUrl.toString());
            onEvent('EXTERNAL_BROWSER_OPENED');
            signal.throwIfAborted();
            try {
                return await bridge.oauthLoopback.wait(loopbackId);
            } catch (e) {
                signal.throwIfAborted();
                throw e;
            }
        } finally {
            signal.removeEventListener('abort', onAbort);
            void bridge.oauthLoopback.close(loopbackId).catch(() => { });
        }
    }
}
