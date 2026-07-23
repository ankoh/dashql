import * as React from 'react';
import * as styles from './trace_log_panel.module.css';

import { SparklesFillIcon } from '@primer/octicons-react';

import { LogRecord } from '../../platform/logger/log_buffer.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { TraceLogViewer } from '../internals/trace_log_viewer.js';
import { SegmentedControl, SegmentedControlSize, SegmentedControlVariant } from '../foundations/segmented_control.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';

/// Which trace the log panel is showing.
const enum LogSource {
    Query = 0,
    Agent = 1,
}

/// Track the timestamp of the most recent log record on a trace. Returns 0 when the trace has no
/// id or no records yet. Used to decide which log source (query vs agent) is "most recent" so the
/// panel can auto-follow whichever trace is currently producing output.
function useTraceLastTimestamp(traceId: number | null): number {
    const logger = useLogger();
    const [lastTimestamp, setLastTimestamp] = React.useState(0);
    React.useEffect(() => {
        if (traceId == null) {
            setLastTimestamp(0);
            return;
        }
        const initial = logger.buffer.collectTraceLogs(traceId);
        setLastTimestamp(initial.length > 0 ? initial[initial.length - 1].timestamp : 0);
        const observer = (record: LogRecord) => {
            setLastTimestamp(prev => Math.max(prev, record.timestamp));
        };
        logger.buffer.subscribeTrace(traceId, observer);
        return () => logger.buffer.unsubscribeTrace(traceId, observer);
    }, [traceId, logger]);
    return lastTimestamp;
}

/// Track the number of log records on a trace, updating as records stream in. Returns 0 when the
/// trace has no id. Drives the "N of M rows" indicator (mirrors the Data tab's row count).
function useTraceLogCount(traceId: number | null): number {
    const logger = useLogger();
    const [count, setCount] = React.useState(0);
    React.useEffect(() => {
        if (traceId == null) {
            setCount(0);
            return;
        }
        setCount(logger.buffer.collectTraceLogs(traceId).length);
        const observer = () => setCount(prev => prev + 1);
        logger.buffer.subscribeTrace(traceId, observer);
        return () => logger.buffer.unsubscribeTrace(traceId, observer);
    }, [traceId, logger]);
    return count;
}

interface TraceLogPanelProps {
    /// The query execution's trace id (null if only an agent run has happened).
    queryTraceId: number | null;
    /// The latest agent run's trace id (null if no agent run has happened).
    agentTraceId: number | null;
    /// A log-reveal request: whenever `nonce` advances, select the source matching `traceId`
    /// (query vs agent). Bumped when the user clicks a status bar, so the panel reveals the trace on
    /// demand instead of auto-hijacking the tab the moment work starts.
    logRequest?: { nonce: number; traceId: number | null };
    /// Scrollless preview mode: the viewer auto-expands to fit its rows and caps at this many. Used
    /// by the feed footer. When unset the viewer fills its parent's height and scrolls (Details).
    maxRows?: number;
    /// Called when the source (query vs agent) is revealed via a log request, so a parent tab panel
    /// can switch to its Log tab. Fires only on a nonce advance, never on mount.
    onLogRequestHandled?: () => void;
    /// When set, the header's "Logs" title/count region becomes a clickable target (the feed footer
    /// uses this to open the Details Status tab). The source toggle on the right stays separate and
    /// never triggers it. Omitted in Details, where the header is inert.
    onHeaderClick?: () => void;
}

/// The shared "trace log" surface: a header carrying a "Logs" title, an "N of M rows" count, and the
/// Execution/Agent source toggle, over a `TraceLogViewer`. Both the feed footer's Log tab and the
/// Details Status tab render this so the two log surfaces can't drift apart (which they had — the
/// auto-follow and source-selection logic lived only in the footer). The only difference is sizing:
/// the footer passes `maxRows` for a scrollless preview, Details fills the card height.
export const TraceLogPanel: React.FC<TraceLogPanelProps> = (props) => {
    const queryTraceId = props.queryTraceId;
    const agentTraceId = props.agentTraceId;

    const [logSource, setLogSource] = React.useState<LogSource>(LogSource.Query);
    // Fall back to whichever source is available if the selected one has no trace.
    const resolvedLogSource = (logSource === LogSource.Query && queryTraceId != null) ? LogSource.Query
        : (logSource === LogSource.Agent && agentTraceId != null) ? LogSource.Agent
            : (queryTraceId != null) ? LogSource.Query
                : LogSource.Agent;
    const activeLogTraceId = resolvedLogSource === LogSource.Query ? queryTraceId : agentTraceId;

    // Auto-follow the log source that most recently produced output: whichever trace's last-message
    // timestamp just advanced becomes the selected source. A manual segmented-control click persists
    // until the next message arrives on either trace.
    const queryLastTs = useTraceLastTimestamp(queryTraceId);
    const agentLastTs = useTraceLastTimestamp(agentTraceId);
    const prevQueryTs = React.useRef(queryLastTs);
    const prevAgentTs = React.useRef(agentLastTs);
    React.useEffect(() => {
        const queryAdvanced = queryLastTs > prevQueryTs.current;
        const agentAdvanced = agentLastTs > prevAgentTs.current;
        prevQueryTs.current = queryLastTs;
        prevAgentTs.current = agentLastTs;
        if (queryAdvanced && agentAdvanced) {
            setLogSource(agentLastTs >= queryLastTs ? LogSource.Agent : LogSource.Query);
        } else if (agentAdvanced) {
            setLogSource(LogSource.Agent);
        } else if (queryAdvanced) {
            setLogSource(LogSource.Query);
        }
    }, [queryLastTs, agentLastTs]);

    // A status bar drives the panel to a specific trace on demand: clicking the bar bumps
    // `logRequest.nonce` and rides along the clicked source's trace id. The nonce is ignored on
    // mount (initial value). onLogRequestHandled lets a parent switch to its Log tab.
    const requestNonce = props.logRequest?.nonce;
    const requestTraceId = props.logRequest?.traceId ?? null;
    const prevRequestNonce = React.useRef(requestNonce);
    const onLogRequestHandled = props.onLogRequestHandled;
    React.useEffect(() => {
        if (requestNonce != null && requestNonce !== prevRequestNonce.current) {
            // Match the requested trace to a source; fall back to whichever source has a trace.
            const source = (requestTraceId != null && requestTraceId === agentTraceId) ? LogSource.Agent
                : (requestTraceId != null && requestTraceId === queryTraceId) ? LogSource.Query
                    : (agentTraceId != null ? LogSource.Agent : LogSource.Query);
            if ((source === LogSource.Agent && agentTraceId != null) || (source === LogSource.Query && queryTraceId != null)) {
                setLogSource(source);
                onLogRequestHandled?.();
            }
        }
        prevRequestNonce.current = requestNonce;
    }, [requestNonce, requestTraceId, agentTraceId, queryTraceId, onLogRequestHandled]);

    // "N of M rows" indicator, mirroring the Data tab. In preview mode only the last `maxRows` rows
    // are visible, so surface the total.
    const totalLogRows = useTraceLogCount(activeLogTraceId);
    const shownLogRows = props.maxRows != null ? Math.min(totalLogRows, props.maxRows) : totalLogRows;
    const logCountDetail = (props.maxRows != null && totalLogRows > props.maxRows)
        ? `${shownLogRows} of ${totalLogRows} rows`
        : `${totalLogRows} ${totalLogRows === 1 ? 'row' : 'rows'}`;

    // Query and Agent share the command-list icons (query = search_16, agent = SparklesFillIcon).
    const QueryLogIcon = SymbolIcon('search_16');

    return (
        <>
            <div className={styles.log_header}>
                {props.onHeaderClick != null ? (
                    // The title/count region navigates (feed footer → Details Status tab); the source
                    // toggle on the right is a separate control and must not trigger navigation.
                    <button type="button" className={styles.log_header_target} onClick={props.onHeaderClick}>
                        <span className={styles.log_header_title}>Logs</span>
                        <span className={styles.log_header_detail}>{logCountDetail}</span>
                    </button>
                ) : (
                    <>
                        <span className={styles.log_header_title}>Logs</span>
                        <span className={styles.log_header_detail}>{logCountDetail}</span>
                    </>
                )}
                <SegmentedControl
                    className={styles.log_source_control}
                    aria-label="Log source"
                    size={SegmentedControlSize.Tiny}
                    variant={SegmentedControlVariant.Invisible}
                    onChange={(index) => setLogSource(index === 1 ? LogSource.Agent : LogSource.Query)}
                >
                    <SegmentedControl.Button
                        leadingVisual={QueryLogIcon}
                        selected={resolvedLogSource === LogSource.Query}
                        disabled={queryTraceId == null}
                    >
                        Execution
                    </SegmentedControl.Button>
                    <SegmentedControl.Button
                        leadingVisual={SparklesFillIcon}
                        selected={resolvedLogSource === LogSource.Agent}
                        disabled={agentTraceId == null}
                    >
                        Agent
                    </SegmentedControl.Button>
                </SegmentedControl>
            </div>
            {props.maxRows != null ? (
                <TraceLogViewer traceId={activeLogTraceId ?? undefined} maxRows={props.maxRows} />
            ) : (
                <div className={styles.log_viewer_fill}>
                    <TraceLogViewer traceId={activeLogTraceId ?? undefined} fill />
                </div>
            )}
        </>
    );
};
