import { CONNECTOR_INFOS, ConnectorType, type ConnectorInfo } from '@ankoh/dashql-runtime/connections/connector_info';
import { isDesktopHost } from '../platform/native_globals.js';

/// Can the connector run in the host of the app?
export function isConnectorAvailable(info: ConnectorInfo): boolean {
    return isDesktopHost() ? info.platforms.native : info.platforms.browser;
}

/// Must the user switch to the desktop app to use the connector?
export function requiresSwitchingToNative(info: ConnectorInfo): boolean {
    return !isConnectorAvailable(info);
}

/// The connectors that the host of the app can run, in the order the app offers them
export const useConnectorList = () => {
    const connectorTypes = [ConnectorType.HYPER, ConnectorType.DBCOM, ConnectorType.SALESFORCE_DATA_CLOUD, ConnectorType.TRINO];
    return connectorTypes.map(type => CONNECTOR_INFOS[type]).filter(isConnectorAvailable);
};
