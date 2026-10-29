import * as React from 'react';
import { ConnectionHealth, type ConnectionState } from '../../connections/connection_state.js';
import { Tooltip } from '../../../ui/foundations/tooltip.js';

export const CONNECTION_ATTENTION_DURATION_MS = 900;

interface ConnectionAttention {
    sessionId: string | null;
    active: boolean;
    request: (sessionId: string) => void;
}

export const SessionConnectionAttentionContext = React.createContext<ConnectionAttention | null>(null);

/// The connections whose health resets the attention, as a key that changes with them
export function connectionHealthKey(connections: readonly ConnectionState[] | null): string {
    return (connections ?? []).map(connection => `${connection.connectionId}:${connection.connectionHealth}`).join(',');
}

/// The connections of a session that are not online, a session runs once they are
export function connectionsToConnect(connections: Iterable<ConnectionState>): ConnectionState[] {
    return [...connections].filter(connection => connection.connectionHealth !== ConnectionHealth.ONLINE);
}

export function useSessionConnectionAttention(sessionId: string | null, healthKey: string): ConnectionAttention {
    const shared = React.useContext(SessionConnectionAttentionContext);
    const [active, setActive] = React.useState(false);
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    React.useLayoutEffect(() => {
        setActive(false);
        if (timer.current != null) clearTimeout(timer.current);
        timer.current = null;
        return () => {
            if (timer.current != null) clearTimeout(timer.current);
            timer.current = null;
        };
    }, [sessionId, healthKey]);
    // Callers request attention for the connections the scripts of the session run on
    const request = React.useCallback((targetSessionId: string) => {
        if (targetSessionId !== sessionId || timer.current != null) return;
        setActive(true);
        timer.current = setTimeout(() => {
            timer.current = null;
            setActive(false);
        }, CONNECTION_ATTENTION_DURATION_MS);
    }, [sessionId]);
    // The value is provided as context to every execute button in the feed, keep it stable
    const own = React.useMemo(() => ({ sessionId, active, request }), [sessionId, active, request]);
    return shared?.sessionId === sessionId ? shared : own;
}

export function ExecuteConnectionGuard(props: { sessionId: string; blocked: boolean; children: React.ReactElement }) {
    const attention = React.useContext(SessionConnectionAttentionContext);
    return <Tooltip type="description" direction="s" text={props.blocked ? 'Connect to execute queries' : 'Query execution control'}>
        <span data-execution-connection-blocked={props.blocked ? 'true' : undefined}
            style={{ display: 'inline-flex' }} tabIndex={props.blocked ? 0 : undefined}
            onPointerOverCapture={event => {
                if (props.blocked && !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) {
                    attention?.request(props.sessionId);
                }
            }}>
            {props.children}
        </span>
    </Tooltip>;
}
