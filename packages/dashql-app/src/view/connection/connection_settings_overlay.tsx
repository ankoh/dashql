import * as React from 'react';
import icons from '@ankoh/dashql-svg-symbols';

import * as styles from './connection_settings_overlay.module.css';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { OverlaySize } from '../foundations/overlay.js';
import { VerticalTabs, VerticalTabVariant } from '../foundations/vertical_tabs.js';
import { CONNECTOR_INFOS, ConnectorType, CONNECTOR_TYPES } from '../../connection/connector_info.js';
import { DemoConnectorSettings } from './demo_connection_settings.js';
import { HyperConnectorSettings } from './hyper_connection_settings.js';
import { SalesforceConnectorSettings } from './salesforce_connection_settings.js';
import { DatalessConnectorSettings } from './dataless_connection_settings.js';
import { TrinoConnectorSettings } from './trino_connection_settings.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { ConnectionHealth } from '../../connection/connection_state.js';

interface Props {
    sessionId: string | null;
    isOpen: boolean;
    onClose: () => void;
    anchorRef: React.RefObject<HTMLElement | null>;
}

export const ConnectionSettingsOverlay: React.FC<Props> = (props: Props) => {
    const [conn, _modifyConn] = useConnectionState(props.sessionId);
    const [anchorReady, setAnchorReady] = React.useState(false);

    // Check if anchor ref is available
    React.useEffect(() => {
        if (props.isOpen && props.anchorRef.current) {
            setAnchorReady(true);
        } else if (!props.isOpen) {
            setAnchorReady(false);
        }
    }, [props.isOpen, props.anchorRef]);

    // Default to current connector type, or DEMO if none
    const currentConnectorType = conn?.connectorInfo.connectorType ?? ConnectorType.DEMO;
    const [selectedConnectorType, setSelectedConnectorType] = React.useState<ConnectorType>(currentConnectorType);

    // When connection changes, update selected tab if it's currently the same
    React.useEffect(() => {
        if (conn && selectedConnectorType === conn.connectorInfo.connectorType) {
            setSelectedConnectorType(conn.connectorInfo.connectorType);
        }
    }, [conn?.connectorInfo.connectorType]);

    // Reset to current connector when opening
    React.useEffect(() => {
        if (props.isOpen && conn) {
            setSelectedConnectorType(conn.connectorInfo.connectorType);
        }
    }, [props.isOpen, conn?.connectorInfo.connectorType]);

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
                    return <DatalessConnectorSettings sessionId={sessionId} onClose={props.onClose} />;
                case ConnectorType.DEMO:
                default:
                    return <DemoConnectorSettings sessionId={sessionId} onClose={props.onClose} />;
            }
        };
    });

    return (
        <AnchoredOverlay
            renderAnchor={null}
            anchorRef={props.anchorRef as React.RefObject<HTMLElement | null>}
            open={props.isOpen && anchorReady}
            onClose={props.onClose}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            width={OverlaySize.XXL}
        >
            <div className={styles.overlay_container}>
                <VerticalTabs
                    variant={VerticalTabVariant.Stacked}
                    selectedTab={selectedConnectorType}
                    selectTab={setSelectedConnectorType}
                    tabProps={tabProps}
                    tabKeys={CONNECTOR_TYPES}
                    tabRenderers={tabRenderers}
                />
            </div>
        </AnchoredOverlay>
    );
};
