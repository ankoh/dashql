import * as React from 'react';
import * as styles from './workbook_feed_page.module.css';

import type { WorkbookRunState } from '@akohn/dashql';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import { PaperAirplaneIcon, SquareFillIcon, SymbolIcon } from '@akohn/dashql-react/components/symbol_icon';
import { Button, ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { IndicatorStatus, StatusIndicator } from '@akohn/dashql-react/components/status_indicator';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { WorkbookConnectionAttentionContext } from '../connections/workbook_connection_attention.js';
import { runStepLabel } from './workbook_run_step.js';

const CloseIcon = SymbolIcon('x_16');

/// The run of a workbook as its bar shows it, `useWorkbookExecution` of the hooks resolves it
export interface WorkbookExecutionModel {
    /// The state of the latest run of the workbook, null before its first run
    state: WorkbookRunState | null;
    /// Does the whole workbook run?
    busy: boolean;
    /// Is the compute database ready? A run reads the cached results with it.
    ready: boolean;
    /// Does a run hold the workbook, a run of the workbook or of one of its scripts?
    runActive: boolean;
    /// Run the whole workbook
    start(): void;
    /// Stop the run of the workbook
    stop(): void;
}

/// A run that skipped scripts points at the connections that they need once it settles, nothing opens by itself. A run
/// that settled before the page mounted doesn't, e.g. when the workbook is opened again. The page asks, its controls
/// may be hidden while the run settles.
export function useSkippedRunAttention(workbookId: string, execution: WorkbookExecutionModel): void {
    const run = execution.state;
    const connectionAttention = React.useContext(WorkbookConnectionAttentionContext);
    const settledWithSkips = (run?.phase === 'succeeded' || run?.phase === 'failed') && run.skippedScripts > 0;
    const sawRun = React.useRef(false);
    React.useEffect(() => { sawRun.current = false; }, [workbookId]);
    React.useEffect(() => { if (execution.busy) sawRun.current = true; }, [execution.busy]);
    const requestAttention = connectionAttention?.request;
    React.useEffect(() => {
        if (settledWithSkips && sawRun.current) {
            sawRun.current = false;
            requestAttention?.();
        }
    }, [settledWithSkips, requestAttention]);
}

interface Props {
    /// The workbook that runs, the details close when it changes
    workbookId: string;
    /// The run of the workbook
    execution: WorkbookExecutionModel;
    /// Can the workbook start a run? It has scripts and none of their connections is busy.
    startable: boolean;
    /// Show a script in the feed, by its file name
    showScript(fileName: string): void;
}

/// Execute All of a workbook and the status of its run, the details of the run open from the status
export function WorkbookExecutionControls({ workbookId, execution, startable, showScript }: Props): React.ReactElement {
    const run = execution.state;
    const [detailsOpen, setDetailsOpen] = React.useState(false);
    React.useEffect(() => setDetailsOpen(false), [workbookId]);
    const progress = run ? `${run.completedScripts}/${run.totalScripts}` : '';
    const skipped = run != null && run.skippedScripts > 0 ? ` · ${run.skippedScripts} need a connection` : '';
    // The scripts that failed, the others ran on
    const failedScripts = run?.failedScripts ?? [];
    const failed = failedScripts.length === 1 ? ` · ${scriptDisplayName(failedScripts[0].fileName)} failed`
        : failedScripts.length > 1 ? ` · ${failedScripts.length} failed` : '';
    // The steps before the statements run take a while, e.g. a run reads the stored results of the scripts that don't
    // run, a large one takes a while
    const step = run?.step != null && (run.phase === 'planning' || run.phase === 'running') ? runStepLabel(run.step) : null;
    const statusText = !run ? '' : step != null ? step : run.phase === 'planning' ? 'Planning...'
        : run.phase === 'stopping' ? `Stopping · ${progress} completed`
            : run.phase === 'failed' ? `${progress} completed${failed}${skipped}`
                : run.phase === 'cancelled' ? `Stopped · ${progress} completed`
                    : run.phase === 'succeeded' ? (skipped ? `${progress} completed${skipped}` : `${progress} succeeded`) : `${progress} completed${skipped}`;
    const skippedTitle = run != null && run.skippedFiles.length > 0 ? `Need a connection: ${run.skippedFiles.join(', ')}` : undefined;
    return (
        <>
            <Button size={ButtonSize.Small} variant={ButtonVariant.Invisible}
                leadingVisual={execution.busy ? SquareFillIcon : PaperAirplaneIcon}
                aria-label={execution.busy ? 'Stop workbook execution' : 'Execute All'}
                data-testid={execution.busy ? 'stop-execution' : 'execute-all'}
                // A run waits for the compute database, it reads the cached results
                disabled={execution.busy ? run?.phase === 'stopping' : !execution.ready || !startable || execution.runActive}
                onClick={() => execution.busy ? execution.stop() : execution.start()}>
                <span className={styles.action_label}>{execution.busy ? run?.phase === 'stopping' ? 'Stopping' : 'Stop' : 'Execute All'}</span>
            </Button>
            <div className={styles.execution_status} role="status" aria-live="polite" aria-atomic="true" data-testid="execution-status" data-phase={run?.phase}
                title={run?.error ?? skippedTitle} aria-label={run?.error ? `${statusText}: ${run.error}` : undefined}>
                {run && (
                    <AnchoredOverlay
                        open={detailsOpen} onOpen={() => setDetailsOpen(true)} onClose={() => setDetailsOpen(false)}
                        side={AnchorSide.OutsideBottom} align={AnchorAlignment.Start} anchorOffset={4}
                        renderAnchor={anchorProps => <Button {...anchorProps}
                            size={ButtonSize.Small} variant={ButtonVariant.Invisible} aria-label="Show workbook execution details" data-testid="execution-details-toggle"
                            leadingVisual={<span className={styles.execution_indicator} aria-hidden="true" data-testid="execution-indicator"><StatusIndicator width="16px" height="16px" status={execution.busy
                                ? IndicatorStatus.Running : run.phase === 'failed' ? IndicatorStatus.Failed
                                    : run.phase === 'succeeded' ? IndicatorStatus.Succeeded : IndicatorStatus.Skip} /></span>}>
                            <span className={styles.execution_progress}>{statusText}</span>
                        </Button>}>
                        <section className={styles.execution_error_card} role="dialog" aria-label="Workbook execution details" data-testid="execution-details">
                            <header className={styles.execution_error_header}>
                                <h2 className={styles.execution_details_title}>{run.phase === 'failed' ? 'Execution failed' : 'Workbook execution'}</h2>
                                <IconButton size={ButtonSize.Small} variant={ButtonVariant.Invisible}
                                    aria-label="Close workbook execution details" data-testid="execution-details-close" onClick={() => setDetailsOpen(false)}>
                                    <CloseIcon size={16} />
                                </IconButton>
                            </header>
                            <div className={styles.execution_details_body}>
                                <div>{statusText}</div>
                                {run.activeFileName && <div>{run.activeFileName} · statement {run.activeStatementIndex}/{run.activeStatementCount}</div>}
                                <div>{run.completedStatements}/{run.totalStatements} statements completed</div>
                                {failedScripts.length === 0 && run.error && <div className={styles.execution_error_message}>{run.error}</div>}
                                {failedScripts.length > 0 && (
                                    <ul className={styles.execution_failures} aria-label="Failed scripts" data-testid="execution-failures">
                                        {failedScripts.map(failure => (
                                            <li key={failure.fileName}>
                                                <button type="button" className={styles.execution_failure_script}
                                                    onClick={() => { setDetailsOpen(false); showScript(failure.fileName); }}>
                                                    {scriptDisplayName(failure.fileName)}
                                                </button>
                                                <div className={styles.execution_error_message}>{failure.message}</div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </section>
                    </AnchoredOverlay>
                )}
            </div>
        </>
    );
}
