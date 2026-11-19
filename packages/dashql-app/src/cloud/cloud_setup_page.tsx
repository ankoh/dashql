import * as React from 'react';

import * as baseStyles from '../ui/foundations/banner_page.module.css';
import * as styles from './cloud_setup_page.module.css';
import symbols from '@akohn/dashql-svg-symbols';

import { Button, ButtonSize, ButtonVariant, IconButton } from '../ui/foundations/button.js';
import { PencilIcon, PlusIcon, XIcon } from '../ui/foundations/symbol_icon.js';
import { CompactNavBar } from '../app/navbar.js';
import { useDashQLCoreSetup } from '../runtime/core_provider.js';
import { useConnection, useConnections, useRuntime } from '@akohn/dashql-react/hooks';
import { newConnectionFromParams } from '@akohn/dashql/platform/connections/connection_params';
import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { useConnectionAttach } from '../connections/attached_connection.js';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { createLocalCloudParams, isCloudCapable, isLocalCloud, useCloudConnectionIds, useSetCloudConnection } from '../connections/cloud_connection.js';
import { HyperConnectorSettings } from '../connections/hyper_connection_settings.js';
import { SalesforceConnectorSettings } from '../connections/salesforce_connection_settings.js';
import { CloudCleanupLine } from './cloud_cleanup.js';
import { CloudConnectionInstaller } from './cloud_connection_installer.js';
import { connectionError, useCloudLogin, useLocalCloudAutoLogin } from './cloud_login.js';
import { CloudConnectionRow } from './cloud_connection_row.js';
import { useCloudState } from './cloud_state.js';
import { useCloudRemoval } from './cloud_deletion.js';
import type { CloudInstallation } from './cloud_store_schema.js';
import { connectorInfoOf } from '@akohn/dashql/platform/connections/connection_state';

// The page that sets up the cloud, a card like the one of the app loader, shown before the workbench. See
// docs/design/cloud.md.
//
// It walks through the steps that a cloud still needs: choose the cloud or add one, log in to it, install or update
// DashQL in it. The number of workbooks of the cloud shows once the tables can be read, and the cleanup of the cloud
// once they are current. At the start of the app it closes itself when nothing is missing, and every step can be
// skipped: the app then goes on without the cloud.

/// The name of a new local cloud
const LOCAL_CLOUD_NAME = 'Local Cloud';

/// The step of the cloud setup that the page shows
export type CloudSetupStep = 'choose' | 'configure' | 'login' | 'install';

/// The step of a cloud, null to choose one
export function cloudSetupStep(cloud: ConnectionState | null, configuring: boolean): CloudSetupStep {
    if (cloud == null) return 'choose';
    if (cloud.connectionHealth === ConnectionHealth.ONLINE) return 'install';
    return configuring ? 'configure' : 'login';
}

/// A count with its noun
function countOf(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export interface CloudSetupPageDependencies {
    useCloudLogin: typeof useCloudLogin;
    CompactNavBar: React.ComponentType;
}

const DEFAULT_DEPENDENCIES: CloudSetupPageDependencies = { useCloudLogin, CompactNavBar };

export interface CloudSetupPageProps {
    /// Shown at the start of the app: it closes itself once the cloud needs nothing, and skipping goes on without it
    startup: boolean;
    /// The cloud that the page sets up, null to choose or add one
    connectionId: string | null;
    /// Set up another cloud, null to choose again
    onChoose: (connectionId: string | null) => void;
    /// Close the page
    onDone: () => void;
    dependencies?: CloudSetupPageDependencies;
}

export function CloudSetupPage(props: CloudSetupPageProps): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const { CompactNavBar: NavBar } = dependencies;
    const cloudConnectionIds = useCloudConnectionIds();
    const cloud = useConnection(props.connectionId != null && cloudConnectionIds.includes(props.connectionId) ? props.connectionId : null);
    const cloudState = useCloudState(cloud?.connectionId);
    const { onChoose } = props;
    const removal = useCloudRemoval(cloud?.connectionId ?? '', cloud?.params, () => onChoose(null));
    const [configuring, setConfiguring] = React.useState(false);
    const step = cloudSetupStep(cloud, configuring);
    const login = dependencies.useCloudLogin(cloud?.connectionId ?? null);
    const [installation, setInstallation] = React.useState<CloudInstallation | null>(null);
    const { onDone, startup } = props;

    // The local cloud needs no login, it connects right away
    useLocalCloudAutoLogin(cloud, login);

    // The installer looked at the tables, at the start of the app the page goes on if nothing is missing
    const onInspected = React.useCallback((found: CloudInstallation) => {
        setInstallation(found);
        if (startup && found.state === 'current') onDone();
    }, [onDone, startup]);
    React.useEffect(() => setInstallation(null), [cloud?.connectionId]);

    let content: React.ReactNode;
    switch (step) {
        case 'choose':
            content = <ChooseCloudConnection onChoose={(connectionId, configure) => { onChoose(connectionId); setConfiguring(configure); }} />;
            break;
        case 'configure':
            content = (
                <div className={styles.settings} data-testid="cloud-setup-settings">
                    {cloud!.connectorType === ConnectorType.DBCOM
                        ? <SalesforceConnectorSettings connectionId={cloud!.connectionId} connector={ConnectorType.DBCOM} onClose={() => setConfiguring(false)} />
                        : <HyperConnectorSettings connectionId={cloud!.connectionId} onClose={() => setConfiguring(false)} />}
                </div>
            );
            break;
        case 'login': {
            const connecting = cloud!.connectionHealth === ConnectionHealth.CONNECTING;
            const error = cloud!.connectionHealth === ConnectionHealth.FAILED ? connectionError(cloud!) : null;
            content = (
                <div className={styles.section} data-testid="cloud-setup-login">
                    <CloudConnectionRow connection={cloud!}>
                        <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label="Edit settings" disabled={connecting}
                            onClick={() => setConfiguring(true)} data-testid="cloud-setup-edit">
                            <PencilIcon size={16} />
                        </IconButton>
                        {connecting
                            ? <Button variant={ButtonVariant.Default} size={ButtonSize.Small} onClick={login.cancel}>Cancel</Button>
                            : (
                                <Button variant={ButtonVariant.Primary} size={ButtonSize.Small} disabled={!login.available}
                                    onClick={() => void login.login()} data-testid="cloud-setup-login-button">
                                    Log In
                                </Button>
                            )}
                    </CloudConnectionRow>
                    {error != null && <p className={styles.error} role="alert">{error}</p>}
                </div>
            );
            break;
        }
        case 'install': {
            const stats = cloudState?.stats ?? null;
            content = (
                <>
                    <div className={styles.section}>
                        <CloudConnectionRow connection={cloud!} />
                    </div>
                    <div className={styles.section} data-testid="cloud-installation">
                        <div className={styles.label}>Installation</div>
                        <CloudConnectionInstaller cloud={cloud!} onInspected={onInspected} />
                        {stats != null && (
                            <p className={styles.workbooks} data-testid="cloud-setup-workbooks">
                                {countOf(stats.workbooks, 'workbook')}{stats.folders > 0 ? `, ${countOf(stats.folders, 'folder')}` : ''}
                            </p>
                        )}
                    </div>
                    {installation?.state === 'current' && (
                        <div className={styles.section}>
                            <div className={styles.label}>Cleanup</div>
                            <CloudCleanupLine cloud={cloud!} />
                        </div>
                    )}
                </>
            );
            break;
        }
    }

    const done = step === 'install' && installation != null && (installation.state === 'current' || installation.state === 'newer');
    return (
        <div className={baseStyles.page} data-electron-drag-region>
            <NavBar />
            <main className={baseStyles.banner_and_content_container}>
                <div className={baseStyles.content_container}>
                    <section className={`${baseStyles.card} ${step === 'configure' ? styles.card_wide : styles.card}`} data-testid="cloud-setup-page" data-step={step} aria-labelledby="cloud-setup-title">
                        <div className={baseStyles.card_header} data-electron-drag-region>
                            <div className={baseStyles.card_header_left_container}>
                                <svg className={styles.title_icon} width="16px" height="16px" aria-hidden="true">
                                    <use xlinkHref={`${symbols}#cloud`} />
                                </svg>
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
                                        <Button variant={ButtonVariant.Invisible} onClick={removal.run}
                                            data-testid={removal.deletes ? 'cloud-setup-delete' : 'cloud-setup-stop-using'}>
                                            {removal.deletes ? 'Delete Local Cloud' : 'Stop Using as Cloud'}
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

/// Choose a cloud, make a connection that can be one a cloud, or add a new one
function ChooseCloudConnection(props: { onChoose: (connectionId: string, configure: boolean) => void }): React.ReactElement {
    const connections = useConnections();
    const cloudConnectionIds = useCloudConnectionIds();
    const setCloud = useSetCloudConnection();
    const attach = useConnectionAttach();
    const runtime = useRuntime();
    const setupCore = useDashQLCoreSetup();
    const capable = [...connections.values()].filter(connection => isCloudCapable(connection.params));
    const clouds = capable.filter(connection => cloudConnectionIds.includes(connection.connectionId));
    const others = capable.filter(connection => !cloudConnectionIds.includes(connection.connectionId));
    const use = (connectionId: string, configure: boolean) => {
        setCloud(connectionId, true);
        props.onChoose(connectionId, configure);
    };
    const add = async (connector: ConnectorType) => {
        const connection = attach(connector);
        use(connection.connectionId, true);
    };
    // There is one local cloud, a connection of the embedded Hyper to the database of the local cloud
    const hasLocalCloud = capable.some(connection => isLocalCloud(connection.params));
    const addLocalCloud = async () => {
        const connection = runtime.createConnection(newConnectionFromParams(createLocalCloudParams(), { name: LOCAL_CLOUD_NAME, active: true }));
        use(connection.connectionId, false);
    };
    return (
        <div className={styles.section} data-testid="cloud-setup-choose">
            {clouds.length > 0 && (
                <>
                    <div className={styles.label}>Clouds</div>
                    {clouds.map(connection => (
                        <CloudConnectionRow key={connection.connectionId} connection={connection}>
                            <Button variant={ButtonVariant.Default} size={ButtonSize.Small} onClick={() => props.onChoose(connection.connectionId, false)}
                                data-testid="cloud-set-up-connection">
                                Set Up
                            </Button>
                        </CloudConnectionRow>
                    ))}
                </>
            )}
            <div className={styles.label}>Where DashQL keeps published workbooks</div>
            {others.map(connection => (
                <CloudConnectionRow key={connection.connectionId} connection={connection}>
                    <Button variant={ButtonVariant.Default} size={ButtonSize.Small} onClick={() => use(connection.connectionId, false)}
                        data-testid="cloud-use-connection">
                        Use
                    </Button>
                </CloudConnectionRow>
            ))}
            <div className={styles.new_actions}>
                <Button variant={ButtonVariant.Default} size={ButtonSize.Small} leadingVisual={PlusIcon}
                    onClick={() => void add(ConnectorType.HYPER)} data-testid="cloud-setup-new-hyper">
                    Hyper Server
                </Button>
                <Button variant={ButtonVariant.Default} size={ButtonSize.Small} leadingVisual={PlusIcon}
                    onClick={() => void add(ConnectorType.DBCOM)} data-testid="cloud-setup-new-dbcom">
                    Database.com
                </Button>
                {!hasLocalCloud && (
                    <Button variant={ButtonVariant.Default} size={ButtonSize.Small} leadingVisual={PlusIcon}
                        onClick={() => void addLocalCloud()} data-testid="cloud-setup-new-local">
                        Local Cloud
                    </Button>
                )}
            </div>
        </div>
    );
}
