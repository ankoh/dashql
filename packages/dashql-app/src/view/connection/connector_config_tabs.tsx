import * as React from 'react';
import icons from '@ankoh/dashql-svg-symbols';

import { VerticalTabs, VerticalTabVariant } from '../foundations/vertical_tabs.js';
import { CONNECTOR_INFOS, ConnectorType, CONNECTOR_TYPES } from '../../connection/connector_info.js';
import { HyperConnectorSettings } from './hyper_connection_settings.js';
import { SalesforceConnectorSettings } from './salesforce_connection_settings.js';
import { DatalessConnectorSettings } from './dataless_connection_settings.js';
import { TrinoConnectorSettings } from './trino_connection_settings.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { ConnectionHealth, ConnectionStatus, SWITCH_CONNECTOR_TYPE } from '../../connection/connection_state.js';

interface Props {
    sessionId: string | null;
    selectedConnectorType: ConnectorType;
    setSelectedConnectorType: (type: ConnectorType) => void;
    onClose?: () => void;
    lockConnectorType?: boolean;
}

export const ConnectorConfigTabs: React.FC<Props> = (props: Props) => {
    const [conn, modifyConn] = useConnectionState(props.sessionId);

    // Check if connection is online or configured
    const isOnline = conn?.connectionHealth === ConnectionHealth.ONLINE;
    const isUnconfigured = conn?.connectionStatus === ConnectionStatus.NOT_STARTED;

    // Handle tab selection: switch the connection's type when unconfigured
    const handleSelectTab = React.useCallback((newType: ConnectorType) => {
        props.setSelectedConnectorType(newType);
        if (isUnconfigured && conn?.connectorInfo.connectorType !== newType) {
            modifyConn({ type: SWITCH_CONNECTOR_TYPE, value: newType });
        }
    }, [props.setSelectedConnectorType, isUnconfigured, conn?.connectorInfo.connectorType, modifyConn]);

    // Build tab props for all connector types
    const tabProps = {} as Record<ConnectorType, any>;
    const tabRenderers = {} as Record<ConnectorType, () => React.ReactElement>;

    CONNECTOR_TYPES.forEach(connectorType => {
        const info = CONNECTOR_INFOS[connectorType];
        const isCurrentConnection = conn?.connectorInfo.connectorType === connectorType;
        const isDisabled = (isOnline || props.lockConnectorType) && !isCurrentConnection;

        tabProps[connectorType] = {
            tabId: connectorType,
            icon: `${icons}#${info.icons.outlines}`,
            iconActive: `${icons}#${info.icons.colored}`,
            labelShort: info.names.displayShort,
            ariaLabel: info.names.displayLong,
            disabled: isDisabled,
        };

        tabRenderers[connectorType] = () => {
            // Pass session to matching tab, or to all tabs when unconfigured
            // (since SWITCH_CONNECTOR_TYPE ensures the type matches the selected tab)
            const sessionId = (isCurrentConnection || isUnconfigured) ? props.sessionId : null;

            switch (connectorType) {
                case ConnectorType.TRINO:
                    return <TrinoConnectorSettings sessionId={sessionId} onClose={props.onClose} />;
                case ConnectorType.SALESFORCE_DATA_CLOUD:
                    return <SalesforceConnectorSettings sessionId={sessionId} onClose={props.onClose} />;
                case ConnectorType.HYPER:
                    return <HyperConnectorSettings sessionId={sessionId} onClose={props.onClose} />;
                case ConnectorType.DATALESS:
                default:
                    return <DatalessConnectorSettings sessionId={sessionId} onClose={props.onClose} />;
            }
        };
    });

    return (
        <VerticalTabs
            variant={VerticalTabVariant.Stacked}
            selectedTab={props.selectedConnectorType}
            selectTab={handleSelectTab}
            tabProps={tabProps}
            tabKeys={CONNECTOR_TYPES}
            tabRenderers={tabRenderers}
        />
    );
};
