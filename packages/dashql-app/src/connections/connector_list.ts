import type { ConnectorInfo } from '@akohn/dashql/platform/connections/connector_info';
import { isDesktopHost } from '@akohn/dashql-react/dom/app_host';

/// Can the connector run in the host of the app?
export function isConnectorAvailable(info: ConnectorInfo): boolean {
    return isDesktopHost() ? info.platforms.native : info.platforms.browser;
}

/// Must the user switch to the desktop app to use the connector?
export function requiresSwitchingToNative(info: ConnectorInfo): boolean {
    return !isConnectorAvailable(info);
}
