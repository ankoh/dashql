import * as React from 'react';
import * as styles from './docker_manager.module.css';

import { List, useListRef } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { XIcon, PlayIcon, SquareIcon, TrashIcon, FileIcon, PlusIcon } from '@primer/octicons-react';

import { ButtonVariant, IconButton } from '../foundations/button.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { OverlaySize } from '../foundations/overlay.js';
import { useDockerClient } from '../../platform/docker/docker_client_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { DockerContainerSummary, DockerLogChunk } from '../../platform/docker/docker_types.js';
import { DockerCreatePanel } from './docker_create_panel.js';
import { observeSize } from '../foundations/size_observer.js';
import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { useKeyEvents } from '../../utils/key_events.js';
import { LogJsonModal } from './log_json_modal.js';
import { LogRecord } from '../../platform/logger/log_buffer.js';

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

    // XXX Polling multiple times can be very expensive for very large repositories
    //
    // React.useEffect(() => {
    //     if (!client || mode !== 'list') return;
    //     refresh();
    //     const t = setInterval(refresh, POLL_INTERVAL_MS);
    //     return () => clearInterval(t);
    // }, [client, mode, refresh]);

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

    const showLogs = async (c: DockerContainerSummary) => {
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
                        onShowLogs={() => showLogs(c)}
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
    onShowLogs: () => void;
}

const ContainerCard: React.FC<ContainerCardProps> = (props) => {
    const c = props.container;
    const isRunning = c.State === 'running';
    const name = c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12);
    const cardRef = React.useRef<HTMLDivElement>(null);
    return (
        <>
            <div className={styles.container_card} ref={cardRef}>
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
                        onClick={props.onShowLogs}
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
                    onClose={props.onShowLogs}
                />
            </AnchoredOverlay>
        </>
    );
};

interface DockerLogRowProps {
    lines: DockerLogChunk[];
    showJsonRecord: (index: number) => void;
    selectedRecordIndex: number;
}

const DockerLogRow = (props: RowComponentProps<DockerLogRowProps>) => {
    const { lines, showJsonRecord, selectedRecordIndex } = props;
    const item = lines[props.index];
    if (!item) return <div style={props.style} />;
    const isSelected = props.index === selectedRecordIndex;
    return (
        <div
            style={props.style}
            className={`${styles.log_row} ${isSelected ? styles.log_row_selected : ''}`}
            onClick={() => showJsonRecord(props.index)}
        >
            <div className={styles.log_row_main}>
                <div className={styles.log_cell_message} title={item.text}>
                    {item.text.replace(/\n$/, '')}
                </div>
            </div>
        </div>
    );
};

interface DockerLogListProps {
    lines: DockerLogChunk[];
    onClose: () => void;
}

const DockerLogList: React.FC<DockerLogListProps> = ({ lines, onClose }) => {
    const ROW_HEIGHT = 32;
    const [jsonModalState, setJsonModalState] =
        React.useState<[object | null, number]>([null, -1]);
    const [jsonModalRecord, jsonModalRecordIndex] = jsonModalState;
    const closeJsonModal = React.useCallback(() => setJsonModalState([null, -1]), []);

    const containerRef = React.useRef<HTMLDivElement>(null);
    const containerSize = observeSize(containerRef);
    const containerWidth = containerSize?.width ?? 200;
    const containerHeight = containerSize?.height ?? 560;

    const listRef = useListRef(null);
    React.useEffect(() => {
        if (listRef.current && lines.length > 0) {
            listRef.current.scrollToRow({ index: lines.length - 1, align: 'end' });
        }
    }, [lines.length]);

    const showJsonRecord = React.useCallback((index: number) => {
        const item = lines[index] ?? null;
        if (!item) return;
        let parsed: object;
        try {
            parsed = JSON.parse(item.text);
        } catch {
            parsed = { text: item.text.replace(/\n$/, '') };
        }
        setJsonModalState([parsed, index]);
    }, [lines]);

    const showPreviousRecord = React.useCallback(() => {
        if (jsonModalRecordIndex > 0) showJsonRecord(jsonModalRecordIndex - 1);
    }, [jsonModalRecordIndex, showJsonRecord]);

    const showNextRecord = React.useCallback(() => {
        if (jsonModalRecordIndex < lines.length - 1) showJsonRecord(jsonModalRecordIndex + 1);
    }, [jsonModalRecordIndex, showJsonRecord, lines.length]);

    useKeyEvents(jsonModalRecord ? [
        { key: 'ArrowUp', capture: true, callback: (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); showPreviousRecord(); } },
        { key: 'ArrowDown', capture: true, callback: (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); showNextRecord(); } },
    ] : []);

    React.useEffect(() => {
        if (jsonModalRecordIndex >= 0 && listRef.current) {
            listRef.current.scrollToRow({ index: jsonModalRecordIndex, align: 'center' });
        }
    }, [jsonModalRecordIndex]);

    const rowProps = React.useMemo<DockerLogRowProps>(() => ({
        lines,
        showJsonRecord,
        selectedRecordIndex: jsonModalRecordIndex,
    }), [lines, showJsonRecord, jsonModalRecordIndex]);

    return (
        <div className={styles.log_overlay}>
            <div className={styles.log_overlay_header}>
                <div className={styles.log_overlay_title}>Container Logs</div>
                <IconButton variant={ButtonVariant.Invisible} aria-label="Close" onClick={onClose}>
                    <XIcon />
                </IconButton>
            </div>
            <div className={styles.log_grid_container} ref={containerRef}>
                <List
                    listRef={listRef}
                    style={{ width: containerWidth, height: containerHeight }}
                    rowCount={lines.length}
                    rowHeight={ROW_HEIGHT}
                    rowComponent={DockerLogRow}
                    rowProps={rowProps}
                />
            </div>
            <LogJsonModal
                record={jsonModalRecord as unknown as LogRecord}
                recordIndex={jsonModalRecordIndex}
                maxIndex={lines.length - 1}
                anchorRef={containerRef}
                align={AnchorAlignment.Start}
                side={AnchorSide.OutsideLeft}
                onClose={closeJsonModal}
                onPrevious={showPreviousRecord}
                onNext={showNextRecord}
            />
        </div>
    );
};
