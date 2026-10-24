import * as React from 'react';

import { Button, ButtonVariant } from '../../../ui/foundations/button.js';
import { Overlay, OverlaySize } from '../../../ui/foundations/overlay.js';
import { canMergeConnection } from '../connection_merge.js';
import type { ConnectionState } from '../connection_state.js';
import { connectionParamsLabel } from './connection_label.js';

import * as styles from '../../session/ui/session_import_conflict_dialog.module.css';
import * as ownStyles from './connection_merge_dialog.module.css';

/// A connection that can be merged into the target
export interface ConnectionMergeCandidate {
    /// The connection
    database: ConnectionState;
    /// The label of the connection
    label: string;
    /// The number of sessions that use the connection
    sessionCount: number;
}

interface Props {
    /// The label of the connection that the others are merged into
    targetLabel: string;
    /// The connections that describe the same database
    candidates: ConnectionMergeCandidate[];
    /// Is the merge running?
    busy: boolean;
    /// Merge the chosen connections
    onConfirm: (connectionIds: string[]) => void;
    /// Abort the merge
    onCancel: () => void;
}

/// Ask the user which connections to merge into a connection.
/// Only disconnected connections can be merged, connected ones are listed but disabled. The list
/// follows the connections, a connection that disconnects meanwhile can be chosen right away.
export function ConnectionMergeDialog(props: Props): React.ReactElement {
    const titleId = React.useId();
    const dialogRef = React.useRef<HTMLElement>(null);
    // Every mergeable connection is chosen unless the user unchecked it
    const [unchecked, setUnchecked] = React.useState<ReadonlySet<string>>(() => new Set());
    const chosen = props.candidates
        .filter(candidate => canMergeConnection(candidate.database) && !unchecked.has(candidate.database.connectionId))
        .map(candidate => candidate.database.connectionId);
    const toggle = React.useCallback((connectionId: string) => setUnchecked(prev => {
        const next = new Set(prev);
        if (!next.delete(connectionId)) next.add(connectionId);
        return next;
    }), []);
    const cancel = React.useCallback(() => {
        if (!props.busy) props.onCancel();
    }, [props.busy, props.onCancel]);

    return (
        <Overlay centered width={OverlaySize.L} onEscape={cancel} onClickOutside={cancel} initialFocusRef={dialogRef}>
            <section
                ref={dialogRef}
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-busy={props.busy}
                tabIndex={-1}
            >
                <header className={styles.header}>
                    <h2 id={titleId}>Merge into {props.targetLabel}</h2>
                </header>
                <div className={styles.body}>
                    <ul className={ownStyles.candidates}>
                        {props.candidates.map(candidate => {
                            const connectionId = candidate.database.connectionId;
                            const mergeable = canMergeConnection(candidate.database);
                            const sessions = `Used by ${candidate.sessionCount} ${candidate.sessionCount === 1 ? 'session' : 'sessions'}`;
                            return (
                                <li key={connectionId}>
                                    <label
                                        className={ownStyles.candidate}
                                        data-testid="connection-merge-candidate"
                                        data-state={mergeable ? 'disconnected' : 'connected'}
                                        data-disabled={!mergeable || undefined}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={chosen.includes(connectionId)}
                                            disabled={props.busy || !mergeable}
                                            onChange={() => toggle(connectionId)}
                                        />
                                        <span className={ownStyles.candidate_text}>
                                            <span className={ownStyles.candidate_label}>{candidate.label}</span>
                                            <span className={ownStyles.candidate_detail}>
                                                {connectionParamsLabel(candidate.database.params)} · {mergeable ? sessions : 'Connected, disconnect it to merge'}
                                            </span>
                                        </span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                </div>
                <footer className={styles.actions}>
                    <Button data-testid="connection-merge-cancel" disabled={props.busy} onClick={cancel}>Cancel</Button>
                    <Button
                        data-testid="connection-merge-confirm"
                        variant={ButtonVariant.Primary}
                        disabled={props.busy || chosen.length === 0}
                        onClick={() => props.onConfirm(chosen)}
                    >
                        Merge
                    </Button>
                </footer>
            </section>
        </Overlay>
    );
}
