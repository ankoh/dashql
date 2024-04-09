import * as sqlynx from '@ankoh/sqlynx-core';
import * as React from 'react';

import { classNames } from '../../utils/classnames.js';
import { VariantKind } from '../../utils/variant.js';
import {
    NodeViewModel,
    EdgeViewModel,
    GraphConnectionId,
    GraphNodeDescriptor,
    GraphBoundaries,
} from './graph_view_model.js';
import { NodePort } from './graph_edges.js';
import { FocusInfo } from '../../session/focus.js';

import * as icons from '../../../static/svg/symbols.generated.svg';

import * as styles from './node_layer.module.css';

interface Props {
    className?: string;
    bounds: GraphBoundaries;
    nodes: NodeViewModel[];
    edges: Map<GraphConnectionId.Value, EdgeViewModel>;
    focus: FocusInfo | null;
    onFocusChanged: (target: GraphNodeDescriptor | null) => void;
}

enum FocusEvent {
    CLICK,
    HOVER,
}

interface FocusState {
    event: FocusEvent | null;
    target: GraphNodeDescriptor | null;
}

const MOUSE_ENTER = Symbol('MOUSE_ENTER');
const MOUSE_LEAVE = Symbol('MOUSE_LEAVE');
const CLICK = Symbol('CLICK');

type FocusAction =
    | VariantKind<typeof MOUSE_ENTER, GraphNodeDescriptor>
    | VariantKind<typeof MOUSE_LEAVE, GraphNodeDescriptor>
    | VariantKind<typeof CLICK, GraphNodeDescriptor>;

const reducer = (state: FocusState, action: FocusAction): FocusState => {
    switch (action.type) {
        case MOUSE_ENTER: {
            // Currently focused through click?
            if (state.event === FocusEvent.CLICK) {
                return state;
            }
            // Node MouseEnter event but we're already in the same node?
            if (
                action.value.nodeId === state.target?.nodeId &&
                (action.value.port === state.target.port || action.value.port == null)
            ) {
                return state;
            }
            return {
                event: FocusEvent.HOVER,
                target: action.value,
            };
        }
        case MOUSE_LEAVE: {
            // Currently focused through click?
            if (state.event === FocusEvent.CLICK) {
                return state;
            }
            // Did we leave the port? Then we're still waiting for the node MouseLeave event
            if (
                action.value.nodeId === state.target?.nodeId &&
                action.value.port === state.target.port &&
                state.target.port != null
            ) {
                return {
                    ...state,
                    target: {
                        ...state.target,
                        port: null,
                    },
                };
            }
            // Otherwise we assume it's the MouseLeave event of the node
            return {
                event: null,
                target: null,
            };
        }
        case CLICK: {
            if (
                action.value.nodeId == state.target?.nodeId &&
                action.value.port == state.target.port &&
                state.event == FocusEvent.CLICK
            ) {
                return {
                    event: null,
                    target: null,
                };
            }
            return {
                event: FocusEvent.CLICK,
                target: action.value,
            };
        }
    }
};

export function NodeLayer(props: Props) {
    const [state, dispatch] = React.useReducer(reducer, null, () => ({ event: null, target: null, port: null }));

    React.useEffect(() => {
        props.onFocusChanged(state.target);
    }, [state.target, props.onFocusChanged]);

    const onEnterNode = React.useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            const nodeId = event.currentTarget.dataset.node!;
            dispatch({ type: MOUSE_ENTER, value: { nodeId: +nodeId, port: null } });
        },
        [dispatch],
    );
    const onLeaveNode = React.useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            const nodeId = event.currentTarget.dataset.node!;
            dispatch({ type: MOUSE_LEAVE, value: { nodeId: +nodeId, port: null } });
        },
        [dispatch],
    );
    const onEnterPort = React.useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            const nodeId = event.currentTarget.dataset.node!;
            const portId = event.currentTarget.dataset.port!;
            dispatch({ type: MOUSE_ENTER, value: { nodeId: +nodeId, port: portId != null ? +portId : null } });
        },
        [dispatch],
    );
    const onLeavePort = React.useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            const nodeId = event.currentTarget.dataset.node!;
            const portId = event.currentTarget.dataset.port!;
            dispatch({ type: MOUSE_LEAVE, value: { nodeId: +nodeId, port: +portId } });
        },
        [dispatch],
    );
    const onClickNode = React.useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            const nodeId = event.currentTarget.dataset.node!;
            dispatch({ type: CLICK, value: { nodeId: +nodeId, port: null } });
        },
        [dispatch],
    );
    const onClickPort = React.useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            event.stopPropagation();
            const nodeId = event.currentTarget.dataset.node!;
            const portId = event.currentTarget.dataset.port!;
            dispatch({ type: CLICK, value: { nodeId: +nodeId, port: +portId } });
        },
        [dispatch],
    );

    const Port = (props: { node: number; port: NodePort; focusedPorts: number; className: string }) => (
        <div
            className={classNames(styles.table_port, props.className, {
                [styles.table_port_focused]: (props.focusedPorts & props.port) != 0,
            })}
            data-node={props.node}
            data-port={props.port}
            onMouseEnter={onEnterPort}
            onMouseLeave={onLeavePort}
            onClick={onClickPort}
        />
    );

    const connectionPorts = new Map<sqlynx.ExternalObjectID.Value, number>();
    if (props.focus?.graphConnections) {
        for (const connection of props.focus.graphConnections) {
            const edge = props.edges.get(connection)!;
            if (!edge) continue; // May have been a duplicate
            connectionPorts.set(edge.fromTable, (connectionPorts.get(edge.fromTable) ?? 0) | edge.fromPort);
            connectionPorts.set(edge.toTable, (connectionPorts.get(edge.toTable) ?? 0) | edge.toPort);
        }
    }

    return (
        <div className={props.className} style={{ width: props.bounds.totalWidth, height: props.bounds.totalHeight }}>
            {props.nodes.map(n => {
                const focusedPorts = connectionPorts.get(n.tableId) ?? 0;
                const isReferenced = n.isReferenced;
                const isInactive = n.peerCount == 0 && !isReferenced;
                return (
                    <div
                        key={n.nodeId}
                        className={classNames(styles.table_node, {
                            [styles.table_node_inactive]: isInactive,
                        })}
                        style={{
                            position: 'absolute',
                            top: n.y - props.bounds.minY,
                            left: n.x - props.bounds.minX,
                            width: n.width,
                            height: n.height,
                        }}
                        data-node={n.nodeId}
                        onMouseEnter={onEnterNode}
                        onMouseLeave={onLeaveNode}
                        onClick={onClickNode}
                    >
                        <div className={styles.table_ports}>
                            {(n.ports & NodePort.North) != 0 && (
                                <Port
                                    node={n.nodeId}
                                    port={NodePort.North}
                                    focusedPorts={focusedPorts}
                                    className={styles.table_port_north}
                                />
                            )}
                            {(n.ports & NodePort.East) != 0 && (
                                <Port
                                    node={n.nodeId}
                                    port={NodePort.East}
                                    focusedPorts={focusedPorts}
                                    className={styles.table_port_east}
                                />
                            )}
                            {(n.ports & NodePort.South) != 0 && (
                                <Port
                                    node={n.nodeId}
                                    port={NodePort.South}
                                    focusedPorts={focusedPorts}
                                    className={styles.table_port_south}
                                />
                            )}
                            {(n.ports & NodePort.West) != 0 && (
                                <Port
                                    node={n.nodeId}
                                    port={NodePort.West}
                                    focusedPorts={focusedPorts}
                                    className={styles.table_port_west}
                                />
                            )}
                        </div>
                        <div className={styles.table_icon}>
                            <svg width="14px" height="14px">
                                <use xlinkHref={`${icons}#table`} />
                            </svg>
                        </div>
                        <div className={styles.table_name}>{n.name}</div>
                    </div>
                );
            })}
        </div>
    );
}
