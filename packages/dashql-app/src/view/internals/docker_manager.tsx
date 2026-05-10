import * as React from 'react';
import * as styles from './docker_manager.module.css';

import { List } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { XIcon, PlayIcon, SquareIcon, TrashIcon, FileIcon, PlusIcon } from '@primer/octicons-react';

import { ButtonVariant, IconButton } from '../foundations/button.js';
import { useDockerClient } from '../../platform/docker/docker_client_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { DockerContainerSummary, DockerLogChunk } from '../../platform/docker/docker_types.js';
import { DockerCreatePanel } from './docker_create_panel.js';

const LABEL_KEY = 'dashql';
const POLL_INTERVAL_MS = 2000;
const MAX_LOG_LINES = 2000;

interface DockerManagerProps {
    onClose: () => void;
}

interface LogState {
    containerId: string | null;
    lines: DockerLogChunk[];
}

export const DockerManager: React.FC<DockerManagerProps> = (props: DockerManagerProps) => {
    const client = useDockerClient();
    const logger = useLogger();
    const [mode, setMode] = React.useState<'list' | 'create'>('list');
    const [containers, setContainers] = React.useState<DockerContainerSummary[]>([]);
    const [busy, setBusy] = React.useState<Record<string, boolean>>({});
    const [errorText, setErrorText] = React.useState<string | null>(null);
    const [logState, setLogState] = React.useState<LogState>({ containerId: null, lines: [] });
    const logAbort = React.useRef<AbortController | null>(null);

    const refresh = React.useCallback(async () => {
        if (!client) return;
        try {
            const list = await client.listContainers(LABEL_KEY);
            setContainers(list);
            setErrorText(null);
        } catch (e: any) {
            setErrorText(e?.message ?? String(e));
            logger.warn('docker list failed', { error: e?.message ?? String(e) }, 'docker');
        }
    }, [client, logger]);

    React.useEffect(() => {
        if (!client || mode !== 'list') return;
        refresh();
        const t = setInterval(refresh, POLL_INTERVAL_MS);
        return () => clearInterval(t);
    }, [client, mode, refresh]);

    React.useEffect(() => {
        return () => {
            logAbort.current?.abort();
        };
    }, []);

    const setBusyFor = (id: string, value: boolean) => {
        setBusy(prev => ({ ...prev, [id]: value }));
    };

    const handleStart = async (c: DockerContainerSummary) => {
        if (!client) return;
        setBusyFor(c.Id, true);
        try {
            await client.startContainer(c.Id);
            await refresh();
        } catch (e: any) {
            setErrorText(e?.message ?? String(e));
        } finally {
            setBusyFor(c.Id, false);
        }
    };

    const handleStop = async (c: DockerContainerSummary) => {
        if (!client) return;
        setBusyFor(c.Id, true);
        try {
            await client.stopContainer(c.Id);
            await refresh();
        } catch (e: any) {
            setErrorText(e?.message ?? String(e));
        } finally {
            setBusyFor(c.Id, false);
        }
    };

    const handleRemove = async (c: DockerContainerSummary) => {
        if (!client) return;
        if (!confirm(`Remove container ${c.Names[0] ?? c.Id.slice(0, 12)}?`)) return;
        setBusyFor(c.Id, true);
        try {
            await client.removeContainer(c.Id, true);
            if (logState.containerId === c.Id) {
                logAbort.current?.abort();
                setLogState({ containerId: null, lines: [] });
            }
            await refresh();
        } catch (e: any) {
            setErrorText(e?.message ?? String(e));
        } finally {
            setBusyFor(c.Id, false);
        }
    };

    const handleToggleLogs = async (c: DockerContainerSummary) => {
        if (!client) return;
        // Toggle off if already streaming this one.
        if (logState.containerId === c.Id) {
            logAbort.current?.abort();
            setLogState({ containerId: null, lines: [] });
            return;
        }
        // Cancel any existing stream.
        logAbort.current?.abort();
        const ctrl = new AbortController();
        logAbort.current = ctrl;
        setLogState({ containerId: c.Id, lines: [] });
        try {
            for await (const chunk of client.streamLogs(c.Id, ctrl.signal)) {
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
                logger.warn('docker logs failed', { error: e?.message ?? String(e) }, 'docker');
            }
        }
    };

    if (mode === 'create') {
        return (
            <DockerCreatePanel
                onBack={() => setMode('list')}
                onCreated={async () => {
                    setMode('list');
                    await refresh();
                }}
                onClose={props.onClose}
            />
        );
    }

    return (
        <div className={styles.root}>
            <div className={styles.header}>
                <div className={styles.header_left}>
                    <div className={styles.title}>Docker</div>
                </div>
                <div className={styles.header_actions}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Create container"
                        description="Create a new container"
                        onClick={() => setMode('create')}
                        disabled={!client}
                    >
                        <PlusIcon />
                    </IconButton>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="close-overlay"
                        onClick={props.onClose}
                    >
                        <XIcon />
                    </IconButton>
                </div>
            </div>
            <div className={styles.body}>
                {errorText && <div className={styles.error_text}>{errorText}</div>}
                {!errorText && containers.length === 0 && (
                    <div className={styles.empty_state}>
                        No containers with label <code>{LABEL_KEY}</code> found.
                        <br />
                        Click <strong>+</strong> to create one.
                    </div>
                )}
                {containers.map(c => (
                    <ContainerCard
                        key={c.Id}
                        container={c}
                        busy={!!busy[c.Id]}
                        logsActive={logState.containerId === c.Id}
                        logLines={logState.containerId === c.Id ? logState.lines : null}
                        onStart={() => handleStart(c)}
                        onStop={() => handleStop(c)}
                        onRemove={() => handleRemove(c)}
                        onToggleLogs={() => handleToggleLogs(c)}
                    />
                ))}
            </div>
        </div>
    );
};

interface ContainerCardProps {
    container: DockerContainerSummary;
    busy: boolean;
    logsActive: boolean;
    logLines: DockerLogChunk[] | null;
    onStart: () => void;
    onStop: () => void;
    onRemove: () => void;
    onToggleLogs: () => void;
}

const ContainerCard: React.FC<ContainerCardProps> = (props) => {
    const c = props.container;
    const isRunning = c.State === 'running';
    const name = c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12);
    return (
        <div className={styles.container_card}>
            <div className={styles.container_meta}>
                <div className={styles.container_name}>{name}</div>
                <div className={styles.container_image}>{c.Image}</div>
                <div className={`${styles.status_pill} ${isRunning ? styles.running : ''}`}>{c.Status}</div>
            </div>
            <div className={styles.actions}>
                {isRunning ? (
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Stop container"
                        description="Stop"
                        onClick={props.onStop}
                        disabled={props.busy}
                    >
                        <SquareIcon />
                    </IconButton>
                ) : (
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Start container"
                        description="Start"
                        onClick={props.onStart}
                        disabled={props.busy}
                    >
                        <PlayIcon />
                    </IconButton>
                )}
                <IconButton
                    variant={props.logsActive ? ButtonVariant.Default : ButtonVariant.Invisible}
                    aria-label="Toggle logs"
                    description={props.logsActive ? 'Hide logs' : 'Show logs'}
                    onClick={props.onToggleLogs}
                >
                    <FileIcon />
                </IconButton>
                <IconButton
                    variant={ButtonVariant.Invisible}
                    aria-label="Remove container"
                    description="Remove"
                    onClick={props.onRemove}
                    disabled={props.busy}
                >
                    <TrashIcon />
                </IconButton>
            </div>
            {props.logsActive && props.logLines != null && (
                <div className={styles.log_panel}>
                    <LogList lines={props.logLines} />
                </div>
            )}
        </div>
    );
};

const LogRow = (props: RowComponentProps<{ lines: DockerLogChunk[] }>) => {
    const line = props.lines[props.index];
    if (!line) return <div style={props.style} />;
    const isStderr = line.stream === 2;
    return (
        <div
            style={props.style}
            className={`${styles.log_row} ${isStderr ? styles.log_row_stderr : ''}`}
        >
            {line.text.replace(/\n$/, '')}
        </div>
    );
};

const LogList: React.FC<{ lines: DockerLogChunk[] }> = ({ lines }) => {
    const ROW_HEIGHT = 18;
    return (
        <List
            style={{ width: '100%', height: '100%' }}
            rowCount={lines.length}
            rowHeight={ROW_HEIGHT}
            rowComponent={LogRow}
            rowProps={{ lines }}
        />
    );
};
