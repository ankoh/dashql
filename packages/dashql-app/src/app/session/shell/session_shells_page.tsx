import * as React from 'react';
import * as styles from './session_shells_page.module.css';
import symbols from '@ankoh/dashql-svg-symbols';

import { useConnectionRegistry } from '../../connections/connection_registry.js';
import { connectionLabelParts } from '../../connections/ui/connection_label.js';
import { AnchorAlignment, AnchorSide } from '../../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../../ui/foundations/anchored_overlay.js';
import { ChevronDownIcon } from '../../../ui/foundations/symbol_icon.js';
import { ConnectionMenu, HealthDot } from '../ui/script_connection_picker.js';
import { useConnectionOrdinals } from '../ui/connection_labels.js';
import { SessionShellPage } from './session_shell_page.js';

export interface SessionShellsPageDependencies {
    useConnectionRegistry: typeof useConnectionRegistry;
    useConnectionOrdinals: typeof useConnectionOrdinals;
    ConnectionMenu: typeof ConnectionMenu;
    SessionShellPage: typeof SessionShellPage;
}

const DEFAULT_DEPENDENCIES: SessionShellsPageDependencies = {
    useConnectionRegistry,
    useConnectionOrdinals,
    ConnectionMenu,
    SessionShellPage,
};

interface Props {
    sessionId: string;
    sessionName?: string | null;
    /// The connection that the visible shell runs on, null while the session has none
    connectionId: string | null;
    /// Show the shell of another connection
    onPickConnection: (connectionId: string) => void;
    dependencies?: SessionShellsPageDependencies;
}

/// The shells of a session, one per connection.
/// The header names the connection of the visible shell and switches to the shells of other connections.
/// A shell lives until the page closes, the shells of other connections are hidden and keep their scrollback.
export const SessionShellsPage: React.FC<Props> = (props: Props) => {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const [registry] = dependencies.useConnectionRegistry();
    const ordinals = dependencies.useConnectionOrdinals();
    const [open, setOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement>(null);

    // The connections that got a shell, in the order they were opened
    const [opened, setOpened] = React.useState<string[]>(() => props.connectionId == null ? [] : [props.connectionId]);
    if (props.connectionId != null && !opened.includes(props.connectionId)) {
        setOpened([...opened, props.connectionId]);
    }
    // The shell of a deleted connection closes
    const shells = opened.filter(connectionId => registry.connections.has(connectionId));

    const connection = props.connectionId == null ? null : registry.connections.get(props.connectionId) ?? null;
    const labelParts = connection == null ? null : connectionLabelParts(connection, ordinals.get(connection.connectionId) ?? null);
    const label = labelParts == null ? 'No connection' : `${labelParts.name} ${labelParts.detail}`;

    return (
        <div className={styles.page}>
            <header className={styles.header} data-electron-drag-region>
                <AnchoredOverlay
                    open={open}
                    onOpen={() => setOpen(true)}
                    onClose={() => setOpen(false)}
                    side={AnchorSide.OutsideBottom}
                    align={AnchorAlignment.Center}
                    anchorOffset={4}
                    anchorRef={triggerRef}
                    returnFocusRef={triggerRef}
                    renderAnchor={anchorProps => (
                        <button
                            {...anchorProps}
                            ref={triggerRef}
                            type="button"
                            className={styles.trigger}
                            aria-label={`Connection of the shell: ${label}`}
                            data-testid="shell-connection-picker"
                            title={label}
                        >
                            {/* The monochrome icon takes the white of the dark header */}
                            {connection != null && (
                                <svg className={styles.trigger_icon} width="16px" height="16px" aria-hidden="true">
                                    <use xlinkHref={`${symbols}#${connection.connectorInfo.icons.uncolored}`} />
                                </svg>
                            )}
                            <span className={styles.trigger_label}>{labelParts?.name ?? label}</span>
                            {labelParts != null && <span className={styles.trigger_detail}>{labelParts.detail}</span>}
                            {connection != null && <span className={styles.trigger_status}><HealthDot health={connection.connectionHealth} /></span>}
                            <ChevronDownIcon size={16} />
                        </button>
                    )}
                >
                    <dependencies.ConnectionMenu
                        sessionId={props.sessionId}
                        label="the shell"
                        connectionId={props.connectionId}
                        onPick={connectionId => {
                            setOpen(false);
                            if (connectionId !== props.connectionId) props.onPickConnection(connectionId);
                        }}
                    />
                </AnchoredOverlay>
            </header>
            <div className={styles.shells}>
                {shells.map(connectionId => (
                    <div
                        key={connectionId}
                        className={connectionId === props.connectionId ? styles.shell : styles.shell_hidden}
                        data-testid="session-shell-layer"
                        data-connection-id={connectionId}
                    >
                        <dependencies.SessionShellPage
                            sessionId={props.sessionId}
                            sessionName={props.sessionName}
                            connectionId={connectionId}
                            ordinal={ordinals.get(connectionId) ?? null}
                            active={connectionId === props.connectionId}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SessionShellsPage;
