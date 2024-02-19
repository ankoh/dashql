import * as React from 'react';

import { VariantKind } from '../../utils/variant.js';
import { EdgeViewModel, GraphConnectionId, GraphBoundaries } from './graph_view_model.js';
import { FocusInfo } from '../../session/focus.js';

interface Props {
    className?: string;
    bounds: GraphBoundaries;
    edges: Map<GraphConnectionId.Value, EdgeViewModel>;
    onFocusChanged: (connection: GraphConnectionId.Value | null) => void;
}

enum FocusEvent {
    CLICK,
    HOVER,
}

interface FocusState {
    event: FocusEvent | null;
    target: GraphConnectionId.Value | null;
}

const MOUSE_ENTER = Symbol('MOUSE_ENTER');
const MOUSE_LEAVE = Symbol('MOUSE_LEAVE');
const CLICK = Symbol('CLICK');

type FocusAction =
    | VariantKind<typeof MOUSE_ENTER, GraphConnectionId.Value>
    | VariantKind<typeof MOUSE_LEAVE, GraphConnectionId.Value>
    | VariantKind<typeof CLICK, GraphConnectionId.Value>;

const reducer = (state: FocusState, action: FocusAction): FocusState => {
    switch (action.type) {
        case MOUSE_ENTER: {
            if (state.event === FocusEvent.CLICK) {
                return state;
            }
            return {
                event: FocusEvent.HOVER,
                target: action.value,
            };
        }
        case MOUSE_LEAVE: {
            if (state.event === FocusEvent.CLICK) {
                return state;
            }
            return {
                event: null,
                target: null,
            };
        }
        case CLICK: {
            if (state.event == FocusEvent.CLICK && state.target === action.value) {
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

function unpack(path: SVGPathElement): GraphConnectionId.Value {
    const from = path.dataset.edge!;
    return BigInt(from);
}

export function EdgeLayer(props: Props) {
    const [state, dispatch] = React.useReducer(reducer, null, () => ({ event: null, target: null }));

    React.useEffect(() => {
        props.onFocusChanged(state.target);
    }, [state.target, props.onFocusChanged]);

    const onEnterEdge = React.useCallback(
        (event: React.MouseEvent<SVGPathElement>) => {
            dispatch({ type: MOUSE_ENTER, value: unpack(event.currentTarget) });
        },
        [dispatch],
    );
    const onLeaveEdge = React.useCallback(
        (event: React.MouseEvent<SVGPathElement>) => {
            dispatch({ type: MOUSE_LEAVE, value: unpack(event.currentTarget) });
        },
        [dispatch],
    );
    const onClickEdge = React.useCallback(
        (event: React.MouseEvent<SVGPathElement>) => {
            event.stopPropagation();
            dispatch({ type: CLICK, value: unpack(event.currentTarget) });
        },
        [dispatch],
    );

    const paths = [];
    for (const [conn, edge] of props.edges) {
        const connId = conn.toString();
        paths.push(
            <path
                key={connId}
                d={edge.path}
                strokeWidth="2px"
                stroke="currentcolor"
                fill="transparent"
                pointerEvents="stroke"
                data-edge={connId}
                onMouseEnter={onEnterEdge}
                onMouseLeave={onLeaveEdge}
                onClick={onClickEdge}
            />,
        );
    }
    return (
        <svg
            className={props.className}
            viewBox={`${props.bounds.minX} ${props.bounds.minY} ${props.bounds.totalWidth} ${props.bounds.totalHeight}`}
            width={props.bounds.totalWidth}
            height={props.bounds.totalHeight}
        >
            {paths}
        </svg>
    );
}

interface HighlightingProps {
    className?: string;
    bounds: GraphBoundaries;
    edges: Map<GraphConnectionId.Value, EdgeViewModel>;
    focus: FocusInfo | null;
}

export function EdgeHighlightingLayer(props: HighlightingProps) {
    let paths = [];
    if (props.focus) {
        for (const [conn, edge] of props.edges) {
            if (!props.focus.graphConnections?.has(conn)) continue;
            paths.push(
                <path
                    key={conn.toString()}
                    d={edge.path}
                    strokeWidth="2px"
                    stroke="var(--graph_edge_focus_color)"
                    fill="transparent"
                />,
            );
        }
    }
    return (
        <svg
            className={props.className}
            viewBox={`${props.bounds.minX} ${props.bounds.minY} ${props.bounds.totalWidth} ${props.bounds.totalHeight}`}
            width={props.bounds.totalWidth}
            height={props.bounds.totalHeight}
        >
            {paths}
        </svg>
    );
}
