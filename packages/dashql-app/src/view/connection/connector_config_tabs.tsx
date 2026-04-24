import * as React from 'react';
import icons from '@ankoh/dashql-svg-symbols';

import { VerticalTabs, VerticalTabVariant } from '../foundations/vertical_tabs.js';
import { CONNECTOR_INFOS, ConnectorType, CONNECTOR_TYPES } from '../../connection/connector_info.js';
import { HyperConnectorSettings } from './hyper_connection_settings.js';
import { SalesforceConnectorSettings } from './salesforce_connection_settings.js';
import { DatalessConnectorSettings } from './dataless_connection_settings.js';
import { TrinoConnectorSettings } from './trino_connection_settings.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { ConnectionHealth } from '../../connection/connection_state.js';

interface Props {
    sessionId: string | null;
    selectedConnectorType: ConnectorType;
    setSelectedConnectorType: (type: ConnectorType) => void;
    onClose?: () => void;
}

export const ConnectorConfigTabs: React.FC<Props> = (props: Props) => {
    const [conn, _modifyConn] = useConnectionState(props.sessionId);

    // Check if connection is online
    const isOnline = conn?.connectionHealth === ConnectionHealth.ONLINE;

    // Build tab props for all connector types
    const tabProps = {} as Record<ConnectorType, any>;
    const tabRenderers = {} as Record<ConnectorType, () => React.ReactElement>;

    CONNECTOR_TYPES.forEach(connectorType => {
        const info = CONNECTOR_INFOS[connectorType];
        const isCurrentConnection = conn?.connectorInfo.connectorType === connectorType;
        const isDisabled = isOnline && !isCurrentConnection;

        tabProps[connectorType] = {
            tabId: connectorType,
            icon: `${icons}#${info.icons.outlines}`,
            iconActive: `${icons}#${info.icons.colored}`,
            labelShort: info.names.displayShort,
            ariaLabel: info.names.displayLong,
            disabled: isDisabled,
        };

        tabRenderers[connectorType] = () => {
            // Use current session if this is the current connector type
            const sessionId = isCurrentConnection ? props.sessionId : null;

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
            selectTab={props.setSelectedConnectorType}
            tabProps={tabProps}
            tabKeys={CONNECTOR_TYPES}
            tabRenderers={tabRenderers}
        />
    );
};
