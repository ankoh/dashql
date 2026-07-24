import * as React from 'react';
import * as styles from './notebook_page_overview.module.css';

import { classNames } from '../../utils/classnames.js';
import { NodePort } from '../../utils/graph_edges.js';
import { ScriptData } from '../../notebook/notebook_state.js';
import { scriptDisplayName } from '../../notebook/notebook_types.js';
import { OverviewRect } from '../../notebook/overview_layout.js';
import { ScriptPreview } from './notebook_script_preview.js';

interface OverviewCardProps {
    sessionId: string;
    rect: OverviewRect;
    scriptData: ScriptData | undefined;
    /// Union bitmask of the ports this card has an edge on (NodePort values).
    ports: number;
    /// Subset of `ports` whose edge is focused, so those ports render highlighted.
    focusedPorts: number;
    onFocus: (fileName: string) => void;
    onExpand: (fileName: string) => void;
}

/// Maps a NodePort to its CSS placement class. Revived from the catalog
/// renderer's `node_port_{north,east,south,west}` rules.
const PORT_PLACEMENT_CLASS: Record<NodePort, string> = {
    [NodePort.North]: styles.node_port_north,
    [NodePort.East]: styles.node_port_east,
    [NodePort.South]: styles.node_port_south,
    [NodePort.West]: styles.node_port_west,
};

/// Render one circular port element for a side the card has an edge on.
function renderPort(port: NodePort, ports: number, focusedPorts: number): React.ReactElement | null {
    if ((ports & port) === 0) return null;
    const focused = (focusedPorts & port) !== 0;
    return (
        <div
            key={port}
            className={classNames(PORT_PLACEMENT_CLASS[port], styles.node_port_border_default, {
                [styles.node_port_focused]: focused,
            })}
            data-port={port}
        />
    );
}

/// A single fixed-size overview card: header with the entry's display name, body
/// showing the compact SQL, and a `node_ports` overlay marking exactly where the
/// dependency edges attach. Revived from the catalog renderer's node + ports DOM,
/// but with `ScriptPreview` as the body instead of a plain label.
export function OverviewCard(props: OverviewCardProps): React.ReactElement {
    const { rect, scriptData, ports, focusedPorts } = props;
    const displayName = scriptDisplayName(rect.fileName);

    const handlePointerDown = React.useCallback(() => {
        props.onFocus(rect.fileName);
    }, [props.onFocus, rect.fileName]);
    const handleDoubleClick = React.useCallback(() => {
        props.onExpand(rect.fileName);
    }, [props.onExpand, rect.fileName]);

    return (
        <div
            className={styles.card}
            style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
            }}
            onPointerDown={handlePointerDown}
            onDoubleClick={handleDoubleClick}
            data-file={rect.fileName}
        >
            <div className={styles.card_frame}>
                <div className={styles.card_header}>
                    <div className={styles.card_label}>{displayName}</div>
                </div>
                <div className={styles.card_body}>
                    WIP
                    {/*scriptData && (
                        <ScriptPreview sessionId={props.sessionId} scriptData={scriptData} />
                    )*/}
                </div>
            </div>
            <div className={styles.node_ports}>
                {renderPort(NodePort.North, ports, focusedPorts)}
                {renderPort(NodePort.East, ports, focusedPorts)}
                {renderPort(NodePort.South, ports, focusedPorts)}
                {renderPort(NodePort.West, ports, focusedPorts)}
            </div>
        </div>
    );
}
