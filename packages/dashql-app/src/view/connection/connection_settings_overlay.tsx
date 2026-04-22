import * as React from 'react';

import * as styles from './connection_settings_overlay.module.css';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { OverlaySize } from '../foundations/overlay.js';
import { ConnectorType } from '../../connection/connector_info.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { ConnectorConfigTabs } from './connector_config_tabs.js';

interface Props {
    sessionId: string | null;
    isOpen: boolean;
    onClose: () => void;
    anchorRef: React.RefObject<HTMLElement | null>;
}

export const ConnectionSettingsOverlay: React.FC<Props> = (props: Props) => {
    const [conn, _modifyConn] = useConnectionState(props.sessionId);

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

    return (
        <AnchoredOverlay
            renderAnchor={null}
            anchorRef={props.anchorRef as React.RefObject<HTMLElement | null>}
            open={props.isOpen}
            onClose={props.onClose}
            side={AnchorSide.OutsideLeft}
            align={AnchorAlignment.Start}
            minWidth={OverlaySize.L}
            maxWidth={OverlaySize.XXL}
        >
            <div className={styles.overlay_container}>
                <ConnectorConfigTabs
                    sessionId={props.sessionId}
                    selectedConnectorType={selectedConnectorType}
                    setSelectedConnectorType={setSelectedConnectorType}
                    onClose={props.onClose}
                />
            </div>
        </AnchoredOverlay>
    );
};
