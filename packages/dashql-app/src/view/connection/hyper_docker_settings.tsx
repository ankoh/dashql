import * as React from 'react';
import * as styles from '../internals/docker_manager.module.css';

import { PlugIcon, TrashIcon, XIcon } from '@primer/octicons-react';

import { ButtonVariant, IconButton } from '../foundations/button.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { OverlaySize } from '../foundations/overlay.js';
import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { BinaryStatusIndicator } from '../foundations/status_indicator.js';
import { RectangleWaveSpinner } from '../foundations/spinners.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { useDockerClient } from '../../platform/docker/docker_client_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useHyperDatabaseClient } from '../../connection/hyper/hyperdb_grpc_client_provider.js';
import { useHyperSetup } from '../../connection/hyper/hyper_connection_setup.js';
import { useQueryExecutor } from '../../connection/query_executor.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { ConnectionHealth } from '../../connection/connection_state.js';
import { performHealthCheck } from '../../connection/health_check.js';
import { getHyperConnectionDetails } from '../../connection/hyper/hyper_connection_state.js';
import {
    DockerContainerSummary,
    DockerLogChunk,
    pickHyperPort,
} from '../../platform/docker/docker_types.js';
import { DockerCreatePanel } from '../internals/docker_create_panel.js';
import { DockerLogList } from '../internals/docker_manager.js';

const LOG_CTX = 'hyper_docker_settings';
const LABEL_KEY = 'dashql';
const MAX_LOG_LINES = 2000;

interface LogState {
    containerId: string | null;
    lines: DockerLogChunk[];
}

export type HyperDockerPanelMode = 'list' | 'create';

interface Props {
    sessionId: string | null;
    freezeInput?: boolean;
    mode: HyperDockerPanelMode;
    setMode: (mode: HyperDockerPanelMode) => void;
    isEditMode: boolean;
    onClose?: () => void;
}

function endpointForPort(port: number): string {
    return `http://localhost:${port}`;
}

export const HyperDockerSettingsPanel: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const dockerClient = useDockerClient();
    const hyperClient = useHyperDatabaseClient();
    const hyperSetup = useHyperSetup();
    const queryExecutor = useQueryExecutor();
    const [connectionState, dispatchConnectionState] = useConnectionState(props.sessionId);
    const hyperConnection = getHyperConnectionDetails(connectionState);

    const [containers, setContainers] = React.useState<DockerContainerSummary[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [errorText, setErrorText] = React.useState<string | null>(null);
    const [busyContainerId, setBusyContainerId] = React.useState<string | null>(null);
    const [logState, setLogState] = React.useState<LogState>({ containerId: null, lines: [] });
    const setupAbort = React.useRef<AbortController | null>(null);
    const logAbort = React.useRef<AbortController | null>(null);

    React.useEffect(() => {
        return () => {
            logAbort.current?.abort();
        };
    }, []);

    const refresh = React.useCallback(async () => {
        if (!dockerClient) return;
        setLoading(true);
        try {
            const list = await dockerClient.listContainers(LABEL_KEY);
            setContainers(list);
            setErrorText(null);
        } catch (e: any) {
            setErrorText(e?.message ?? String(e));
            logger.warn('docker list failed', { error: e?.message ?? String(e) }, LOG_CTX);
        } finally {
            setLoading(false);
        }
    }, [dockerClient, logger]);

    React.useEffect(() => {
        if (!dockerClient || props.mode !== 'list') return;
        refresh();
    }, [dockerClient, refresh, props.mode]);

    const handleRemove = async (c: DockerContainerSummary) => {
        if (!dockerClient) return;
        if (!confirm(`Remove container ${c.Names[0] ?? c.Id.slice(0, 12)}?`)) return;
        setBusyContainerId(c.Id);
        try {
            await dockerClient.removeContainer(c.Id, true);
            if (logState.containerId === c.Id) {
                logAbort.current?.abort();
                setLogState({ containerId: null, lines: [] });
            }
            await refresh();
        } catch (e: any) {
            setErrorText(e?.message ?? String(e));
        } finally {
            setBusyContainerId(null);
        }
    };

    const showLogs = async (c: DockerContainerSummary) => {
        if (!dockerClient) return;
        if (logState.containerId === c.Id) {
            logAbort.current?.abort();
            setLogState({ containerId: null, lines: [] });
            return;
        }
        logAbort.current?.abort();
        const ctrl = new AbortController();
        logAbort.current = ctrl;
        setLogState({ containerId: c.Id, lines: [] });
        try {
            for await (const chunk of dockerClient.streamLogs(c.Id, ctrl.signal)) {
                setLogState(prev => {
                    if (prev.containerId !== c.Id) return prev;
                    const next = [...prev.lines, chunk];
                    if (next.length > MAX_LOG_LINES) {
                        next.splice(0, next.length - MAX_LOG_LINES);
                    }
                    return { containerId: c.Id, lines: next };
                });
            }
        } catch (e: any) {
            if (!ctrl.signal.aborted) {
                logger.warn('docker logs failed', { error: e?.message ?? String(e) }, LOG_CTX);
            }
        }
    };

    const handleStart = async (c: DockerContainerSummary) => {
        if (!dockerClient) return;
        setBusyContainerId(c.Id);
        try {
            await dockerClient.startContainer(c.Id);
            await refresh();
        } catch (e: any) {
            setErrorText(e?.message ?? String(e));
        } finally {
            setBusyContainerId(null);
        }
    };

    const handleStop = async (c: DockerContainerSummary) => {
        if (!dockerClient) return;
        setBusyContainerId(c.Id);
        try {
            await dockerClient.stopContainer(c.Id);
            await refresh();
        } catch (e: any) {
            setErrorText(e?.message ?? String(e));
        } finally {
            setBusyContainerId(null);
        }
    };

    const handleConnect = async (c: DockerContainerSummary) => {
        if (hyperClient == null || hyperSetup == null) {
            logger.error('Hyper connector is unavailable', {}, LOG_CTX);
            return;
        }
        if (connectionState == null) {
            logger.warn('Connection state is null', {}, LOG_CTX);
            return;
        }
        const port = pickHyperPort(c);
        if (port == null) {
            setErrorText(`Container ${c.Names[0] ?? c.Id.slice(0, 12)} has no published TCP port`);
            return;
        }
        try {
            setupAbort.current = new AbortController();
            const params = {
                protocol: 'V3_DOCKER' as const,
                endpoint: endpointForPort(port),
                tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
                attachedDatabases: [],
                metadata: { message: '', details: {} } as any,
            };
            const channel = await hyperSetup.setup(dispatchConnectionState, params, setupAbort.current.signal);
            if (channel != null) {
                await performHealthCheck(queryExecutor, connectionState.sessionId, { type: 'hyper', channel }, dispatchConnectionState, setupAbort.current.signal);
            }
        } catch (_error: any) {
            // Errors are surfaced through the connection state; nothing to do here.
        }
        setupAbort.current = null;
    };

    const handleCancel = () => {
        if (setupAbort.current) {
            setupAbort.current.abort('abort the Hyper setup');
            setupAbort.current = null;
        }
    };

    const handleDisconnect = async () => {
        if (hyperSetup) {
            await hyperSetup.reset(dispatchConnectionState);
        }
    };

    const activeEndpoint = hyperConnection?.proto.setupParams?.endpoint ?? null;
    const health = connectionState?.connectionHealth ?? ConnectionHealth.NOT_STARTED;

    if (props.mode === 'create') {
        return (
            <DockerCreatePanel
                onBack={() => props.setMode('list')}
                onCreated={async () => {
                    props.setMode('list');
                    await refresh();
                }}
                onClose={props.onClose ?? (() => props.setMode('list'))}
            />
        );
    }

    return (
        <div className={styles.body}>
            {errorText && <div className={styles.error_text}>{errorText}</div>}
            {!errorText && loading && containers.length === 0 && (
                <div className={styles.loading_state}>
                    <RectangleWaveSpinner
                        className={styles.loading_spinner}
                        active={true}
                        color="rgb(36, 41, 46)"
                    />
                </div>
            )}
            {!errorText && !loading && containers.length === 0 && (
                <div className={styles.empty_state}>
                    No containers with label <code>{LABEL_KEY}</code> found.
                </div>
            )}
            {containers.map(c => {
                const port = pickHyperPort(c);
                const endpoint = port != null ? endpointForPort(port) : null;
                const isActive = endpoint != null && endpoint === activeEndpoint;
                return (
                    <HyperContainerCard
                        key={c.Id}
                        container={c}
                        port={port}
                        busy={busyContainerId === c.Id}
                        isActive={isActive}
                        connectionHealth={isActive ? health : ConnectionHealth.NOT_STARTED}
                        freezeInput={!!props.freezeInput}
                        isEditMode={props.isEditMode}
                        logsActive={logState.containerId === c.Id}
                        logLines={logState.containerId === c.Id ? logState.lines : null}
                        onStart={() => handleStart(c)}
                        onStop={() => handleStop(c)}
                        onRemove={() => handleRemove(c)}
                        onShowLogs={() => showLogs(c)}
                        onConnect={() => handleConnect(c)}
                        onCancel={handleCancel}
                        onDisconnect={handleDisconnect}
                    />
                );
            })}
        </div>
    );
};

interface HyperContainerCardProps {
    container: DockerContainerSummary;
    port: number | null;
    busy: boolean;
    isActive: boolean;
    connectionHealth: ConnectionHealth;
    freezeInput: boolean;
    isEditMode: boolean;
    logsActive: boolean;
    logLines: DockerLogChunk[] | null;
    onStart: () => void;
    onStop: () => void;
    onRemove: () => void;
    onShowLogs: () => void;
    onConnect: () => void;
    onCancel: () => void;
    onDisconnect: () => void;
}

const HyperContainerCard: React.FC<HyperContainerCardProps> = (props) => {
    const c = props.container;
    const name = c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12);
    const isRunning = c.State === 'running';
    const cardRef = React.useRef<HTMLDivElement>(null);
    const LogIcon = SymbolIcon('log_24');
    const PauseIcon = SymbolIcon('pause_24');
    const RocketIcon = SymbolIcon('rocket_24');

    let connectButton: React.ReactElement | null = null;
    if (props.isActive) {
        switch (props.connectionHealth) {
            case ConnectionHealth.CONNECTING:
                connectButton = (
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Cancel connection"
                        description="Cancel"
                        onClick={props.onCancel}
                    >
                        <XIcon />
                    </IconButton>
                );
                break;
            case ConnectionHealth.ONLINE:
                connectButton = (
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Disconnect"
                        description="Disconnect"
                        onClick={props.onDisconnect}
                    >
                        <XIcon />
                    </IconButton>
                );
                break;
            default:
                connectButton = renderConnectButton(props, isRunning);
                break;
        }
    } else {
        connectButton = renderConnectButton(props, isRunning);
    }

    return (
        <>
            <div className={styles.container_card} ref={cardRef}>
                <div className={styles.container_status}>
                    <BinaryStatusIndicator
                        online={isRunning}
                        width="14px"
                        height="14px"
                        fill="black"
                    />
                </div>
                <div className={styles.container_meta}>
                    <div className={styles.container_meta_name}>{name}</div>
                    <div className={styles.container_meta_image}>
                        {c.Image}{props.port != null ? ` · :${props.port}` : ''}
                    </div>
                </div>
                <div className={styles.actions}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Toggle logs"
                        description="Show logs"
                        onClick={props.onShowLogs}
                    >
                        <LogIcon />
                    </IconButton>
                    {isRunning ? (
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-label="Stop container"
                            description="Stop"
                            onClick={props.onStop}
                            disabled={props.busy || props.freezeInput}
                        >
                            <PauseIcon />
                        </IconButton>
                    ) : (
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-label="Start container"
                            description="Start"
                            onClick={props.onStart}
                            disabled={props.busy || props.freezeInput}
                        >
                            <RocketIcon />
                        </IconButton>
                    )}
                    {connectButton}
                    {props.isEditMode && (
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-label="Remove container"
                            description="Remove"
                            onClick={props.onRemove}
                            disabled={props.busy || isRunning}
                        >
                            <TrashIcon />
                        </IconButton>
                    )}
                </div>
            </div>
            <AnchoredOverlay
                renderAnchor={null}
                anchorRef={cardRef}
                open={props.logsActive}
                onClose={() => props.onShowLogs()}
                width={OverlaySize.XXL}
                height={OverlaySize.XL}
                side={AnchorSide.OutsideLeft}
                align={AnchorAlignment.Start}
                focusTrapSettings={{ disabled: true }}
            >
                <DockerLogList
                    lines={props.logLines ?? []}
                    containerName={name}
                    onClose={props.onShowLogs}
                />
            </AnchoredOverlay>
        </>
    );
};

function renderConnectButton(props: HyperContainerCardProps, isRunning: boolean): React.ReactElement {
    const disabled = !isRunning || props.port == null || props.busy || props.freezeInput;
    return (
        <IconButton
            variant={ButtonVariant.Invisible}
            aria-label="Connect to container"
            description="Connect"
            onClick={props.onConnect}
            disabled={disabled}
        >
            <PlugIcon />
        </IconButton>
    );
}
