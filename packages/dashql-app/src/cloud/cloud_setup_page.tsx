import * as React from 'react';

import * as baseStyles from '../ui/foundations/banner_page.module.css';
import * as styles from './cloud_setup_page.module.css';

import { Button, ButtonSize, ButtonVariant, IconButton } from '../ui/foundations/button.js';
import { XIcon } from '../ui/foundations/symbol_icon.js';
import { CompactNavBar } from '../app/navbar.js';
import { useDashQLCoreSetup } from '../runtime/core_provider.js';
import { useConnectionAllocator, useConnectionRegistry } from '../connections/connection_registry.js';
import { createConnectionStateFromParams } from '../connections/connection_params.js';
import { ConnectionHealth, type ConnectionState } from '../connections/connection_state.js';
import { connectionLabel } from '../connections/connection_label.js';
import { CONNECTION_HEALTH_NAMES } from '../connections/connection_status.js';
import { useConnectionAttach } from '../connections/attached_connection.js';
import { ConnectorType } from '../connections/connector_info.js';
import { createLocalCloudParams, isCloudCapable, isLocalCloud, useCloudConnection, useSetCloudConnection } from '../connections/cloud_connection.js';
import { HyperConnectorSettings } from '../connections/hyper_connection_settings.js';
import { SalesforceConnectorSettings } from '../connections/salesforce_connection_settings.js';
import { CloudConnectionInstaller } from './cloud_connection_installer.js';
import { useCloudLogin } from './cloud_login.js';
import { useCloudState } from './cloud_state.js';
import type { CloudInstallation } from './cloud_store_schema.js';

// The page that sets up the cloud, a card like the one of the app loader, shown before the workbench. See
// docs/design/cloud.md.
//
// It walks through the steps that the cloud still needs: choose the cloud connection or add one, log in to it,
// install or update DashQL in it. The workbooks of the cloud are listed once the tables can be read. At the start of the
// app it shows only when a step is missing, and every step can be skipped: the app then goes on without the cloud.

/// The name of a new local cloud
const LOCAL_CLOUD_NAME = 'Local Cloud';

/// The step of the cloud setup that the page shows
export type CloudSetupStep = 'choose' | 'configure' | 'login' | 'install';

/// The step of a cloud connection
export function cloudSetupStep(cloud: ConnectionState | null, configuring: boolean): CloudSetupStep {
    if (cloud == null) return 'choose';
    if (cloud.connectionHealth === ConnectionHealth.ONLINE) return 'install';
    return configuring ? 'configure' : 'login';
}

/// The error of the last setup of a connection
function connectionError(cloud: ConnectionState): string | null {
    const proto = cloud.details.value.proto as { setupError?: { message?: string }; healthCheckError?: { message?: string } };
    return proto.setupError?.message ?? proto.healthCheckError?.message ?? null;
}

/// The number of workbooks in a phrase
function workbookCount(count: number): string {
    return count === 1 ? 'one workbook' : `${count} workbooks`;
}

export interface CloudSetupPageDependencies {
    useCloudLogin: typeof useCloudLogin;
    CompactNavBar: React.ComponentType;
}

const DEFAULT_DEPENDENCIES: CloudSetupPageDependencies = { useCloudLogin, CompactNavBar };

export interface CloudSetupPageProps {
    /// Shown at the start of the app: it closes itself once the cloud needs nothing, and skipping goes on without it
    startup: boolean;
    /// Close the page
    onDone: () => void;
    dependencies?: CloudSetupPageDependencies;
}

export function CloudSetupPage(props: CloudSetupPageProps): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const { CompactNavBar: NavBar } = dependencies;
    const cloud = useCloudConnection();
    const cloudState = useCloudState();
    const setCloud = useSetCloudConnection();
    const [configuring, setConfiguring] = React.useState(false);
    const step = cloudSetupStep(cloud, configuring);
    const login = dependencies.useCloudLogin(cloud?.connectionId ?? null);
    const [installation, setInstallation] = React.useState<CloudInstallation | null>(null);
    const { onDone, startup } = props;

    // The local cloud needs no login, it connects right away
    const embedded = isLocalCloud(cloud?.params);
    const autoLogin = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (cloud == null || !embedded || cloud.connectionHealth !== ConnectionHealth.NOT_STARTED) return;
        if (autoLogin.current === cloud.connectionId) return;
        autoLogin.current = cloud.connectionId;
        void login.login();
    }, [cloud, embedded, login]);

    // The installer looked at the tables, at the start of the app the page goes on if nothing is missing
    const onInspected = React.useCallback((found: CloudInstallation) => {
        setInstallation(found);
        if (startup && found.state === 'current') onDone();
    }, [onDone, startup]);
    React.useEffect(() => setInstallation(null), [cloud?.connectionId]);

    let content: React.ReactNode;
    switch (step) {
        case 'choose':
            content = <ChooseCloudConnection onConfigure={() => setConfiguring(true)} />;
            break;
        case 'configure':
            content = (
                <div className={styles.settings} data-testid="cloud-setup-settings">
                    {cloud!.connectorInfo.connectorType === ConnectorType.DBCOM
                        ? <SalesforceConnectorSettings connectionId={cloud!.connectionId} connector={ConnectorType.DBCOM} onClose={() => setConfiguring(false)} />
                        : <HyperConnectorSettings connectionId={cloud!.connectionId} onClose={() => setConfiguring(false)} />}
                </div>
            );
            break;
        case 'login': {
            const connecting = cloud!.connectionHealth === ConnectionHealth.CONNECTING;
            const error = cloud!.connectionHealth === ConnectionHealth.FAILED ? connectionError(cloud!) : null;
            content = (
                <div className={styles.login} data-testid="cloud-setup-login">
                    <p className={styles.text}>
                        Log in to {connectionLabel(cloud!)} to open the workbooks of the cloud and to publish yours.
                    </p>
                    <div className={styles.status} data-testid="cloud-setup-status">
                        {CONNECTION_HEALTH_NAMES[cloud!.connectionHealth]}
                    </div>
                    {error != null && <p className={styles.error} role="alert">{error}</p>}
                    <div className={styles.row_actions}>
                        <Button variant={ButtonVariant.Default} disabled={connecting} onClick={() => setConfiguring(true)}
                            data-testid="cloud-setup-edit">
                            Edit Settings
                        </Button>
                        {connecting
                            ? <Button variant={ButtonVariant.Default} onClick={login.cancel}>Cancel</Button>
                            : (
                                <Button variant={ButtonVariant.Primary} disabled={!login.available} onClick={() => void login.login()}
                                    data-testid="cloud-setup-login-button">
                                    Log In
                                </Button>
                            )}
                    </div>
                </div>
            );
            break;
        }
        case 'install':
            content = (
                <>
                    <CloudConnectionInstaller cloud={cloud!} onInspected={onInspected} />
                    {cloudState.tree != null && (
                        <p className={styles.workbooks} data-testid="cloud-setup-workbooks">
                            The cloud holds {workbookCount(cloudState.tree.workbooks.length + cloudState.tree.folders.reduce((sum, node) => sum + node.workbooks.length, 0))}
                            {cloudState.tree.folders.length > 0 ? ` in ${cloudState.tree.folders.length === 1 ? 'one folder' : `${cloudState.tree.folders.length} folders`} and at the top` : ''}.
                        </p>
                    )}
                </>
            );
            break;
    }

    const done = step === 'install' && installation != null && (installation.state === 'current' || installation.state === 'newer');
    return (
        <div className={baseStyles.page} data-electron-drag-region>
            <NavBar />
            <main className={baseStyles.banner_and_content_container}>
                <div className={baseStyles.content_container}>
                    <section className={`${baseStyles.card} ${styles.card}`} data-testid="cloud-setup-page" data-step={step} aria-labelledby="cloud-setup-title">
                        <div className={baseStyles.card_header} data-electron-drag-region>
                            <div className={baseStyles.card_header_left_container}>
                                <h1 id="cloud-setup-title" className={`${baseStyles.card_header_left_title} ${styles.title}`}>Cloud</h1>
                            </div>
                            <div className={baseStyles.card_header_right_container}>
                                <IconButton aria-label="Close" size={ButtonSize.Small} variant={ButtonVariant.Invisible} onClick={onDone}>
                                    <XIcon size={16} />
                                </IconButton>
                            </div>
                        </div>
                        <div className={baseStyles.card_section}>
                            <div className={styles.content}>{content}</div>
                            <div className={baseStyles.card_actions}>
                                <div className={baseStyles.card_actions_left}>
                                    {cloud != null && step !== 'configure' && (
                                        <Button variant={ButtonVariant.Invisible} onClick={() => setCloud(null)} data-testid="cloud-setup-stop-using">
                                            Stop Using as Cloud
                                        </Button>
                                    )}
                                    {step === 'configure' && (
                                        <Button variant={ButtonVariant.Invisible} onClick={() => setConfiguring(false)}>Back</Button>
                                    )}
                                </div>
                                <div className={baseStyles.card_actions_right}>
                                    <Button variant={done ? ButtonVariant.Primary : ButtonVariant.Default} onClick={onDone} data-testid="cloud-setup-done">
                                        {done ? 'Continue' : startup ? 'Continue Without Cloud' : 'Close'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}

/// Choose the cloud connection among the connections that can be one, or add a new one
function ChooseCloudConnection(props: { onConfigure: () => void }): React.ReactElement {
    const [registry] = useConnectionRegistry();
    const setCloud = useSetCloudConnection();
    const attach = useConnectionAttach();
    const allocate = useConnectionAllocator();
    const setupCore = useDashQLCoreSetup();
    const capable = [...registry.connections.values()].filter(connection => isCloudCapable(connection.params));
    const add = async (connector: ConnectorType) => {
        const connection = attach(await setupCore('cloud_setup'), connector);
        setCloud(connection.connectionId);
        props.onConfigure();
    };
    // There is one local cloud, a connection of the embedded Hyper to the database of the local cloud
    const hasLocalCloud = capable.some(connection => isLocalCloud(connection.params));
    const addLocalCloud = async () => {
        const state = createConnectionStateFromParams(await setupCore('cloud_setup'), createLocalCloudParams());
        const connection = allocate({ ...state, name: LOCAL_CLOUD_NAME, active: true });
        setCloud(connection.connectionId);
    };
    return (
        <div className={styles.choose} data-testid="cloud-setup-choose">
            <p className={styles.text}>
                Choose the connection that DashQL keeps published workbooks in, a Hyper server or Database.com. New
                workbooks start on it. A local cloud keeps them in a database of this browser, to try the cloud.
            </p>
            {capable.length > 0 && (
                <ul className={styles.connections}>
                    {capable.map(connection => (
                        <li key={connection.connectionId} className={styles.connection}>
                            <span className={styles.connection_name}>{connectionLabel(connection)}</span>
                            <span className={styles.status}>
                                {isLocalCloud(connection.params) ? 'In this browser' : CONNECTION_HEALTH_NAMES[connection.connectionHealth]}
                            </span>
                            <Button variant={ButtonVariant.Default} onClick={() => setCloud(connection.connectionId)} data-testid="cloud-use-connection">
                                Use as Cloud
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
            <div className={styles.row_actions}>
                <Button variant={ButtonVariant.Default} onClick={() => void add(ConnectorType.HYPER)} data-testid="cloud-setup-new-hyper">
                    New Hyper Server
                </Button>
                <Button variant={ButtonVariant.Default} onClick={() => void add(ConnectorType.DBCOM)} data-testid="cloud-setup-new-dbcom">
                    New Database.com
                </Button>
                {!hasLocalCloud && (
                    <Button variant={ButtonVariant.Default} onClick={() => void addLocalCloud()} data-testid="cloud-setup-new-local">
                        New Local Cloud
                    </Button>
                )}
            </div>
        </div>
    );
}
