import * as React from 'react';

import * as styles from './graph.module.css';

/// The side of a node that a port sits on
export type GraphPortSide = 'top' | 'bottom' | 'left' | 'right';

/// The half circle of the border of a port of radius 5, bulging out of the node
const PORT_BORDER: Record<GraphPortSide, string> = {
    top: 'M -5 0 A 5 5 0 0 1 5 0',
    bottom: 'M -5 0 A 5 5 0 0 0 5 0',
    left: 'M 0 -5 A 5 5 0 0 0 0 5',
    right: 'M 0 -5 A 5 5 0 0 1 0 5',
};

export interface GraphPortProps {
    /// The center of the port, on the border of its node
    x: number;
    y: number;
    side: GraphPortSide;
    /// Is an edge of the port highlighted?
    highlighted?: boolean;
    /// More attributes of the port group, e.g. data attributes of tests
    [attribute: `data-${string}`]: string | undefined;
}

/// A port of a graph node: a half circle on the border of the node with a dot in it
export function GraphPort(props: GraphPortProps): React.ReactElement {
    const { x, y, side, highlighted, ...data } = props;
    return (
        <g
            className={styles.port}
            transform={`translate(${x}, ${y})`}
            data-highlighted={highlighted || undefined}
            aria-hidden="true"
            {...data}
        >
            <path className={styles.port_border} d={PORT_BORDER[side]} />
            <circle className={styles.port_mask} r={4} />
            <circle className={styles.port_dot} r={2.5} />
        </g>
    );
}
