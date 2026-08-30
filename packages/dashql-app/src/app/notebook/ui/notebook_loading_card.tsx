import * as React from 'react';

import { ProgressBar } from '../../../ui/foundations/progress_bar.js';
import { IndicatorStatus, StatusIndicator } from '../../../ui/foundations/status_indicator.js';
import type { HttpNotebookLoadProgress } from '../persistence/http_notebook_bundle.js';
import { NotebookImportCard, NotebookImportDetail, NotebookImportDetails } from './notebook_import_card.js';
import * as styles from './notebook_loading_card.module.css';

interface Props {
    sourceUrl: string;
    progress: HttpNotebookLoadProgress;
    onCancel(): void;
}

export function NotebookLoadingCard(props: Props): React.ReactElement {
    const details = progressDetails(props.progress);
    const fileProgress = props.progress.phase === 'files' ? props.progress : null;
    const percentage = fileProgress == null
        ? null
        : fileProgress.completedFileCount / fileProgress.totalFileCount * 100;

    return (
        <NotebookImportCard
            title="Loading Notebook"
            busy
            onClose={props.onCancel}
        >
            <div className={styles.status} role="status" aria-live="polite">
                <span aria-hidden="true">
                    <StatusIndicator status={IndicatorStatus.Running} width="18px" height="18px" fill="currentColor" />
                </span>
                <span>{details.status}</span>
            </div>
            {percentage != null && (
                <ProgressBar
                    progress={percentage}
                    aria-label="Notebook files loaded"
                    aria-valuetext={`${fileProgress!.completedFileCount} of ${fileProgress!.totalFileCount} files`}
                />
            )}
            <NotebookImportDetails>
                {details.notebookName != null && (
                    <NotebookImportDetail label="Notebook">{details.notebookName}</NotebookImportDetail>
                )}
                {details.notebookId != null && (
                    <NotebookImportDetail label="UUID" mono>{details.notebookId}</NotebookImportDetail>
                )}
                <NotebookImportDetail label="Source" mono>{props.sourceUrl}</NotebookImportDetail>
            </NotebookImportDetails>
        </NotebookImportCard>
    );
}

function progressDetails(progress: HttpNotebookLoadProgress): {
    status: string;
    notebookName: string | null;
    notebookId: string | null;
} {
    switch (progress.phase) {
        case 'preparing':
            return { status: 'Preparing notebook loader...', notebookName: null, notebookId: null };
        case 'manifest':
            return { status: 'Loading notebook manifest...', notebookName: null, notebookId: null };
        case 'index':
            return { status: 'Discovering notebook files...', notebookName: progress.notebookName, notebookId: progress.notebookId };
        case 'files': {
            const scripts = progress.totalScriptCount === 0
                ? 'No indexed scripts'
                : `Loading scripts: ${progress.completedScriptCount} of ${progress.totalScriptCount}`;
            return { status: scripts, notebookName: progress.notebookName, notebookId: progress.notebookId };
        }
    }
}
