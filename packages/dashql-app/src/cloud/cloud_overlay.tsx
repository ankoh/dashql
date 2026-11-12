import * as React from 'react';
import * as styles from './cloud_overlay.module.css';
import symbols from '@ankoh/dashql-svg-symbols';

import { AnchorAlignment, AnchorSide } from '../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../ui/foundations/anchored_overlay.js';
import { OverlaySize } from '../ui/foundations/overlay.js';
import { Button, ButtonSize, ButtonVariant, IconButton } from '../ui/foundations/button.js';
import { ToolsIcon, UnlinkIcon, XIcon } from '../ui/foundations/symbol_icon.js';
import { ConnectionHealth, type ConnectionState } from '../connections/connection_state.js';
import { useConnectionRegistry } from '../connections/connection_registry.js';
import { isCloudCapable, useCloudConnection, useSetCloudConnection } from '../connections/cloud_connection.js';
import { CloudConnectionInstaller } from './cloud_connection_installer.js';
import { CloudConnectionRow } from './cloud_connection_row.js';
import { connectionError, useCloudLogin, useLocalCloudAutoLogin } from './cloud_login.js';
import { useCloudState } from './cloud_state.js';

// The Cloud overlay of the top bar: the cloud connection, its login and the installer of DashQL in it. See
// docs/design/cloud.md.

/// Pick the cloud connection among the connections that can be one
function CloudConnectionPicker(props: { onSetup: () => void }): React.ReactElement {
    const [registry] = useConnectionRegistry();
    const setCloud = useSetCloudConnection();
    const capable = [...registry.connections.values()].filter(connection => isCloudCapable(connection.params));
    if (capable.length === 0) {
        return (
            <div className={styles.section}>
                <div className={styles.empty}>
                    <span className={styles.muted}>No cloud connection</span>
                    <Button variant={ButtonVariant.Primary} size={ButtonSize.Small} onClick={props.onSetup}>Set Up</Button>
                </div>
            </div>
        );
    }
    return (
        <div className={styles.section}>
            <div className={styles.label}>No cloud connection, use one of</div>
            {capable.map(connection => (
                <CloudConnectionRow key={connection.connectionId} connection={connection}>
                    <Button variant={ButtonVariant.Default} size={ButtonSize.Small} onClick={() => setCloud(connection.connectionId)}
                        data-testid="cloud-use-connection">
                        Use
                    </Button>
                </CloudConnectionRow>
            ))}
        </div>
    );
}

/// The cloud connection, its login and, once online, the installer
function CloudConnectionSection(props: { cloud: ConnectionState }): React.ReactElement {
    const { cloud } = props;
    const setCloud = useSetCloudConnection();
    const login = useCloudLogin(cloud.connectionId);
    useLocalCloudAutoLogin(cloud, login);
    const health = cloud.connectionHealth;
    const error = health === ConnectionHealth.FAILED ? connectionError(cloud) : null;
    return (
        <>
            <div className={styles.section}>
                <CloudConnectionRow connection={cloud}>
                    {health === ConnectionHealth.CONNECTING
                        ? <Button variant={ButtonVariant.Default} size={ButtonSize.Small} onClick={login.cancel}>Cancel</Button>
                        : health !== ConnectionHealth.ONLINE && (
                            <Button variant={ButtonVariant.Primary} size={ButtonSize.Small} disabled={!login.available}
                                onClick={() => void login.login()} data-testid="cloud-log-in">
                                Log In
                            </Button>
                        )}
                    <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label="Stop using as cloud"
                        onClick={() => setCloud(null)} data-testid="cloud-stop-using">
                        <UnlinkIcon size={16} />
                    </IconButton>
                </CloudConnectionRow>
                {error != null && <p className={styles.error} role="alert">{error}</p>}
            </div>
            {health === ConnectionHealth.ONLINE && (
                <div className={styles.section} data-testid="cloud-installation">
                    <div className={styles.label}>Installation</div>
                    <CloudConnectionInstaller cloud={cloud} />
                </div>
            )}
        </>
    );
}

export function CloudPanel(props: { onClose: () => void }): React.ReactElement {
    const cloud = useCloudConnection();
    const { openSetup } = useCloudState();
    const setup = () => {
        props.onClose();
        openSetup();
    };
    return (
        <div className={styles.root} data-testid="cloud-panel">
            <div className={styles.header}>
                <svg className={styles.title_icon} width="16px" height="16px" aria-hidden="true">
                    <use xlinkHref={`${symbols}#cloud`} />
                </svg>
                <div className={styles.title}>Cloud</div>
                <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label="Set up cloud" onClick={setup}
                    data-testid="cloud-open-setup">
                    <ToolsIcon size={16} />
                </IconButton>
                <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label="close-overlay" onClick={props.onClose}>
                    <XIcon size={16} />
                </IconButton>
            </div>
            <div className={styles.body}>
                {cloud == null ? <CloudConnectionPicker onSetup={setup} /> : <CloudConnectionSection cloud={cloud} />}
            </div>
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
