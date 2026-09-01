import * as React from 'react';

import * as styles from './connection_settings_overlay.module.css';
import { AnchoredOverlay } from '../../../../ui/foundations/anchored_overlay.js';
import { AnchorAlignment, AnchorSide } from '../../../../ui/foundations/anchored_position.js';
import { OverlaySize } from '../../../../ui/foundations/overlay.js';
import { ConnectorType } from '../connector_info.js';
import { useAttachedDatabaseById } from '../attached_database_registry.js';
import { ConnectionHealth, type AttachedDatabaseState } from '../attached_database_state.js';
import { ConnectorConfigTabs } from './connector_config_tabs.js';

interface Props {
    databaseId: string | null;
    isOpen: boolean;
    onClose: () => void;
    anchorRef: React.RefObject<HTMLElement | null>;
    onConnected?: (database: AttachedDatabaseState) => void;
}

export const ConnectionSettingsOverlay: React.FC<Props> = (props: Props) => {
    const [conn, _modifyConn] = useAttachedDatabaseById(props.databaseId);

    const currentConnectorType = conn?.connectorInfo.connectorType ?? ConnectorType.HYPER;
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

    const completedDatabaseId = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (!props.isOpen || conn?.connectionHealth !== ConnectionHealth.ONLINE || props.onConnected == null) return;
        if (completedDatabaseId.current === conn.databaseId) return;
        completedDatabaseId.current = conn.databaseId;
        void props.onConnected(conn);
    }, [conn, props.isOpen, props.onConnected]);
    React.useEffect(() => {
        if (!props.isOpen) completedDatabaseId.current = null;
    }, [props.isOpen]);

    return (
        <AnchoredOverlay
            renderAnchor={null}
            anchorRef={props.anchorRef as React.RefObject<HTMLElement | null>}
            open={props.isOpen}
            onClose={props.onClose}
            side={AnchorSide.OutsideRight}
            align={AnchorAlignment.Start}
            minWidth={OverlaySize.L}
            maxWidth={OverlaySize.XXL}
            height={OverlaySize.XL}
            maxHeight={OverlaySize.XL}
        >
            <div className={styles.overlay_container}>
                <ConnectorConfigTabs
                    className={styles.content_sized_tabs}
                    databaseId={props.databaseId}
                    selectedConnectorType={selectedConnectorType}
                    setSelectedConnectorType={setSelectedConnectorType}
                    onClose={props.onClose}
                />
            </div>
        </AnchoredOverlay>
    );
};
