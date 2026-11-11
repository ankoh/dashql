import * as React from 'react';
import * as styles from './cloud_overlay.module.css';

import { AnchorAlignment, AnchorSide } from '../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../ui/foundations/anchored_overlay.js';
import { OverlaySize } from '../ui/foundations/overlay.js';
import { Button, ButtonVariant, IconButton } from '../ui/foundations/button.js';
import { XIcon } from '../ui/foundations/symbol_icon.js';
import { ConnectionHealth } from '../connections/connection_state.js';
import { connectionLabel } from '../connections/connection_label.js';
import { useConnectionRegistry } from '../connections/connection_registry.js';
import { isCloudCapable, useCloudConnection, useSetCloudConnection } from '../connections/cloud_connection.js';
import { CloudConnectionInstaller } from './cloud_connection_installer.js';
import { useCloudState } from './cloud_state.js';

// The Cloud overlay of the top bar: the cloud connection and the installer of DashQL in it. See docs/design/cloud.md.

/// Pick the cloud connection among the connections that can be one
function CloudConnectionPicker(): React.ReactElement {
    const [registry] = useConnectionRegistry();
    const setCloud = useSetCloudConnection();
    const capable = [...registry.connections.values()].filter(connection => isCloudCapable(connection.params));
    return (
        <div className={styles.section}>
            <p className={styles.text}>
                No cloud connection. DashQL keeps the workbooks that you publish in a Hyper server or Database.com, new
                workbooks start on it.
            </p>
            {capable.length === 0
                ? <p className={styles.muted}>Add a Hyper server or Database.com in the sidebar first.</p>
                : (
                    <ul className={styles.connections}>
                        {capable.map(connection => (
                            <li key={connection.connectionId} className={styles.connection}>
                                <span className={styles.connection_name}>{connectionLabel(connection)}</span>
                                <Button variant={ButtonVariant.Default} onClick={() => setCloud(connection.connectionId)}
                                    data-testid="cloud-use-connection">
                                    Use as Cloud
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
        </div>
    );
}

export function CloudPanel(props: { onClose: () => void }): React.ReactElement {
    const cloud = useCloudConnection();
    const { openSetup } = useCloudState();
    const setCloud = useSetCloudConnection();

    let body: React.ReactElement;
    if (cloud == null) {
        body = <CloudConnectionPicker />;
    } else if (cloud.connectionHealth !== ConnectionHealth.ONLINE) {
        body = (
            <div className={styles.section}>
                <p className={styles.text}>
                    {connectionLabel(cloud)} is not connected. Log in to it with Set Up Cloud or in the sidebar to install DashQL or to look at its tables.
                </p>
            </div>
        );
    } else {
        body = <CloudConnectionInstaller cloud={cloud} />;
    }
    return (
        <div className={styles.root} data-testid="cloud-panel">
            <div className={styles.header}>
                <div className={styles.title}>Cloud</div>
                <div className={styles.header_actions}>
                    <Button variant={ButtonVariant.Invisible} onClick={() => { props.onClose(); openSetup(); }} data-testid="cloud-open-setup">
                        Set Up Cloud
                    </Button>
                    {cloud != null && (
                        <Button variant={ButtonVariant.Invisible} onClick={() => setCloud(null)} data-testid="cloud-stop-using">
                            Stop Using as Cloud
                        </Button>
                    )}
                    <IconButton variant={ButtonVariant.Invisible} aria-label="close-overlay" onClick={props.onClose}>
                        <XIcon />
                    </IconButton>
                </div>
            </div>
            <div className={styles.body}>{body}</div>
        </div>
    );
}

interface CloudOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    renderAnchor: (p: object) => React.ReactElement;
    side?: AnchorSide;
    align?: AnchorAlignment;
    anchorOffset?: number;
}

export function CloudOverlay(props: CloudOverlayProps): React.ReactElement {
    return (
        <AnchoredOverlay
            open={props.isOpen}
            onClose={props.onClose}
            renderAnchor={props.renderAnchor}
            side={props.side}
            align={props.align}
            anchorOffset={props.anchorOffset}
            overlayProps={{ width: OverlaySize.M, height: OverlaySize.AUTO }}
        >
            <CloudPanel onClose={props.onClose} />
        </AnchoredOverlay>
    );
}
