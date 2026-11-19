import * as React from 'react';
import { type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { Tooltip } from '@akohn/dashql-react/components/tooltip';

export const CONNECTION_ATTENTION_DURATION_MS = 900;

interface ConnectionAttention {
    workbookId: string | null;
    active: boolean;
    request: (workbookId: string) => void;
}

export const WorkbookConnectionAttentionContext = React.createContext<ConnectionAttention | null>(null);

/// The connections whose health resets the attention, as a key that changes with them
export function connectionHealthKey(connections: readonly ConnectionState[] | null): string {
    return (connections ?? []).map(connection => `${connection.connectionId}:${connection.connectionHealth}`).join(',');
}

export function useWorkbookConnectionAttention(workbookId: string | null, healthKey: string): ConnectionAttention {
    const shared = React.useContext(WorkbookConnectionAttentionContext);
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
    }, [workbookId, healthKey]);
    // Callers request attention for the connections the scripts of the workbook run on
    const request = React.useCallback((targetWorkbookId: string) => {
        if (targetWorkbookId !== workbookId || timer.current != null) return;
        setActive(true);
        timer.current = setTimeout(() => {
            timer.current = null;
            setActive(false);
        }, CONNECTION_ATTENTION_DURATION_MS);
    }, [workbookId]);
    // The value is provided as context to every execute button in the feed, keep it stable
    const own = React.useMemo(() => ({ workbookId, active, request }), [workbookId, active, request]);
    return shared?.workbookId === workbookId ? shared : own;
}

export function ExecuteConnectionGuard(props: { workbookId: string; blocked: boolean; children: React.ReactElement }) {
    const attention = React.useContext(WorkbookConnectionAttentionContext);
    return <Tooltip type="description" direction="s" text={props.blocked ? 'Connect to execute queries' : 'Query execution control'}>
        <span data-execution-connection-blocked={props.blocked ? 'true' : undefined}
            style={{ display: 'inline-flex' }} tabIndex={props.blocked ? 0 : undefined}
            onPointerOverCapture={event => {
                if (props.blocked && !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) {
                    attention?.request(props.workbookId);
                }
            }}>
            {props.children}
        </span>
    </Tooltip>;
}
