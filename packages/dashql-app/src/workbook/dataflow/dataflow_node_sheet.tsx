import * as React from 'react';

import { Button, ButtonSize, ButtonVariant } from '@akohn/dashql-react/components/button';
import { Sheet } from '@akohn/dashql-react/components/sheet';
import type { DataflowNeighbor } from './dataflow_scene.js';
import type { DataflowTileStatus } from './dataflow_tile.js';
import * as styles from './dataflow_node_sheet.module.css';

// The sheet of a tapped box of a narrow dataflow canvas (docs/design/dataflow.md): what the box is, what it reads and
// what reads it, and what can be done with it. A tap on a neighbor moves the selection and the sheet there.

/// The words of a status
const STATUS_TEXT: Record<DataflowTileStatus, string> = {
    idle: 'Not run',
    running: 'Running',
    succeeded: 'Succeeded',
    failed: 'Failed',
    stale: 'Stale result',
};

export interface DataflowNodeSheetProps {
    /// The name of the script, or of the input with its colon
    title: string;
    status: DataflowTileStatus;
    /// The line about the result, as the tile shows it
    summary: React.ReactNode;
    /// The value of an input, its card
    value?: React.ReactNode;
    reads: DataflowNeighbor[];
    readBy: DataflowNeighbor[];
    /// The name of a neighbor
    nameOf: (neighbor: DataflowNeighbor) => string;
    /// Move the selection to a neighbor
    onSelect: (neighbor: DataflowNeighbor) => void;
    /// Open the script in the editor, run it, show its result; absent for an input, a result absent without one
    onEdit?: () => void;
    onRun?: () => void;
    onResult?: () => void;
    /// Is a run of the script or of its workbook busy?
    running?: boolean;
    onClose: () => void;
}

export function DataflowNodeSheet(props: DataflowNodeSheetProps): React.ReactElement {
    const neighbors = (label: string, list: DataflowNeighbor[], testId: string) => (
        <section className={styles.section} aria-label={label}>
            <h3 className={styles.heading}>{label}</h3>
            {list.length === 0
                ? <div className={styles.none}>Nothing</div>
                : (
                    <ul className={styles.list} data-testid={testId}>
                        {list.map(neighbor => {
                            const name = props.nameOf(neighbor);
                            return (
                                <li key={neighbor.input != null ? `:${neighbor.input}` : neighbor.scriptKey}>
                                    <button type="button" className={styles.neighbor} onClick={() => props.onSelect(neighbor)}>{name}</button>
                                </li>
                            );
                        })}
                    </ul>
                )}
        </section>
    );
    const script = props.onEdit != null || props.onRun != null;
    return (
        <Sheet title={props.title} onClose={props.onClose} data-testid="dataflow-node-sheet">
            <div className={styles.status} data-status={props.status} data-testid="dataflow-node-status">
                <span className={styles.dot} aria-hidden="true" />
                <span>{STATUS_TEXT[props.status]}</span>
                <span className={styles.summary}>{props.summary}</span>
            </div>
            {props.value}
            {script && (
                <div className={styles.actions}>
                    {props.onEdit != null && <Button size={ButtonSize.Medium} variant={ButtonVariant.Default} onClick={props.onEdit} data-testid="dataflow-node-edit">Edit</Button>}
                    {props.onRun != null && <Button size={ButtonSize.Medium} variant={ButtonVariant.Default} onClick={props.onRun} disabled={props.running} data-testid="dataflow-node-run">Run</Button>}
                    <Button size={ButtonSize.Medium} variant={ButtonVariant.Default} onClick={props.onResult} disabled={props.onResult == null} data-testid="dataflow-node-result">Result</Button>
                </div>
            )}
            {props.reads.length > 0 || script ? neighbors('Reads', props.reads, 'dataflow-node-reads') : null}
            {neighbors('Read by', props.readBy, 'dataflow-node-read-by')}
        </Sheet>
    );
}
