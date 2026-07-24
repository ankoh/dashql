import * as React from 'react';
import * as styles from './notebook_page_overview.module.css';

import { classNames } from '../../utils/classnames.js';
import { NodePort } from '../../utils/graph_edges.js';
import { PageRefRect } from '../../notebook/overview_layout.js';

interface PageRefCardProps {
    rect: PageRefRect;
    /// Union bitmask of the ports this card has an edge on (NodePort values).
    ports: number;
    onSelect: (pageName: string) => void;
}

/// Maps a NodePort to its CSS placement class (shared with the grid cards).
const PORT_PLACEMENT_CLASS: Record<NodePort, string> = {
    [NodePort.North]: styles.node_port_north,
    [NodePort.East]: styles.node_port_east,
    [NodePort.South]: styles.node_port_south,
    [NodePort.West]: styles.node_port_west,
};

function renderPort(port: NodePort, ports: number): React.ReactElement | null {
    if ((ports & port) === 0) return null;
    return (
        <div
            key={port}
            className={classNames(PORT_PLACEMENT_CLASS[port], styles.node_port_border_default)}
            data-port={port}
        />
    );
}

/// A placeholder card in the top bar standing in for another page that entries on
/// the current page reference. Slimmer than a grid card: just the page name and a
/// count badge of how many entries point at it. Clicking navigates to that page.
export function PageRefCard(props: PageRefCardProps): React.ReactElement {
    const { rect, ports } = props;

    const handlePointerDown = React.useCallback(() => {
        props.onSelect(rect.pageName);
    }, [props.onSelect, rect.pageName]);

    return (
        <div
            className={classNames(styles.card, styles.page_ref_card)}
            style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
            }}
            onPointerDown={handlePointerDown}
            data-page={rect.pageName}
        >
            <div className={styles.page_ref_name}>{rect.pageName}</div>
            <div className={styles.page_ref_badge}>{rect.refCount}</div>
            <div className={styles.node_ports}>
                {renderPort(NodePort.North, ports)}
                {renderPort(NodePort.East, ports)}
                {renderPort(NodePort.South, ports)}
                {renderPort(NodePort.West, ports)}
            </div>
        </div>
    );
}
