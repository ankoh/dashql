import * as React from 'react';

import * as baseStyles from '../../../ui/banner/banner_page.module.css';
import { Button, ButtonSize, ButtonVariant, IconButton } from '../../../ui/foundations/button.js';
import { ProgressBar } from '../../../ui/foundations/progress_bar.js';
import { IndicatorStatus, StatusIndicator } from '../../../ui/foundations/status_indicator.js';
import { AlertIcon, XIcon } from '../../../ui/foundations/symbol_icon.js';
import { ParticleFlowBackground } from '../../../ui/particle_flow/particle_flow_background.js';
import { CompactNavBar } from '../../ui/navbar.js';
import type { HttpNotebookLoadProgress, HttpNotebookLoadResult } from '../persistence/http_notebook_bundle.js';
import * as styles from './notebook_import_card.module.css';

interface LoadingState {
    phase: 'loading';
    sourceUrl: string;
    progress: HttpNotebookLoadProgress;
    onClose(): void;
}

interface ReadyState {
    phase: 'ready';
    result: HttpNotebookLoadResult;
    conflictLocation: string | null;
    conflictIsNative: boolean;
    busy: boolean;
    onImport(): void;
    onReplace(): void;
    onCreateNew(): void;
    onClose(): void;
}

interface ConflictState {
    phase: 'conflict';
    notebookName: string;
    notebookUuid: string;
    existingLocation: string;
    existingIsNative: boolean;
    folderCount: number;
    scriptCount: number;
    busy: boolean;
    onReplace(): void;
    onCreateNew(): void;
    onClose(): void;
}

export type NotebookImportCardState = LoadingState | ReadyState | ConflictState;

export function NotebookImportCard(props: NotebookImportCardState): React.ReactElement {
    if (props.phase === 'loading') return <LoadingCard state={props} />;
    if (props.phase === 'conflict') return <ConflictCard state={props} />;
    return <ReadyCard state={props} />;
}

function LoadingCard({ state }: { state: LoadingState }): React.ReactElement {
    const details = progressDetails(state.progress);
    const fileProgress = state.progress.phase === 'files' ? state.progress : null;
    const percentage = fileProgress == null
        ? null
        : fileProgress.completedFileCount / fileProgress.totalFileCount * 100;
    return (
        <CardShell title="Loading Notebook" busy onClose={state.onClose}>
            <div className={styles.status} role="status" aria-live="polite">
                <span aria-hidden="true">
                    <StatusIndicator status={IndicatorStatus.Running} width="18px" height="18px" />
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
                {details.notebookName != null && <NotebookImportDetail label="Notebook">{details.notebookName}</NotebookImportDetail>}
                {details.notebookId != null && <NotebookImportDetail label="UUID" mono>{details.notebookId}</NotebookImportDetail>}
                <NotebookImportDetail label="Source" mono>{state.sourceUrl}</NotebookImportDetail>
            </NotebookImportDetails>
        </CardShell>
    );
}

function ReadyCard({ state }: { state: ReadyState }): React.ReactElement {
    const { bundle, indexedScriptCount, loadedScriptCount, incomplete } = state.result;
    const notebookName = bundle.notebook.name?.trim() || bundle.notebook.metadata.originalFileName || 'Unnamed notebook';
    const scriptCount = incomplete
        ? indexedScriptCount > 0 ? `${loadedScriptCount} of ${indexedScriptCount}` : `${loadedScriptCount} (index unavailable)`
        : String(loadedScriptCount);
    const displayedScriptCount = incomplete && indexedScriptCount > 0 ? indexedScriptCount : loadedScriptCount;
    const scriptSummary = formatScriptSummary(scriptCount, displayedScriptCount, 0);
    const hasConflict = state.conflictLocation != null;
    const actions = hasConflict ? (
        <>
            <Button disabled={state.busy} onClick={state.onReplace}>Replace</Button>
            <Button disabled={state.busy} onClick={state.onCreateNew}>Create New</Button>
        </>
    ) : (
        <Button autoFocus variant={ButtonVariant.Primary} disabled={state.busy} onClick={state.onImport}>Import</Button>
    );

    return (
        <CardShell title="Import Notebook" busy={state.busy} closeDisabled={state.busy} onClose={state.onClose} actions={actions}>
            {hasConflict && <ConflictWarning native={state.conflictIsNative} />}
            {incomplete && (
                <div className={styles.warning} role="status">
                    <AlertIcon size={16} aria-hidden="true" />
                    <span>Some notebook files could not be resolved. The available content will still be imported.</span>
                </div>
            )}
            <NotebookImportDetails>
                {state.conflictLocation != null && <NotebookImportDetail label="Existing" mono>{state.conflictLocation}</NotebookImportDetail>}
                <NotebookImportDetail label="Source" mono>{bundle.notebook.metadata.originalHttpUrl}</NotebookImportDetail>
                <NotebookImportDetail label="UUID" mono>{bundle.notebook.notebookId}</NotebookImportDetail>
                <NotebookImportDetail label="Name">{notebookName}</NotebookImportDetail>
                <NotebookImportDetail label="Scripts">{scriptSummary}</NotebookImportDetail>
            </NotebookImportDetails>
        </CardShell>
    );
}

function ConflictCard({ state }: { state: ConflictState }): React.ReactElement {
    return (
        <CardShell
            title="Import Notebook"
            busy={state.busy}
            closeDisabled={state.busy}
            onClose={state.onClose}
            actions={<>
                <Button disabled={state.busy} onClick={state.onReplace}>Replace</Button>
                <Button disabled={state.busy} onClick={state.onCreateNew}>Create New</Button>
            </>}
        >
            <ConflictWarning native={state.existingIsNative} />
            <NotebookImportDetails>
                <NotebookImportDetail label="Existing" mono>{state.existingLocation}</NotebookImportDetail>
                <NotebookImportDetail label="UUID" mono>{state.notebookUuid}</NotebookImportDetail>
                <NotebookImportDetail label="Name">{state.notebookName}</NotebookImportDetail>
                <NotebookImportDetail label="Scripts">{formatScriptSummary(String(state.scriptCount), state.scriptCount, state.folderCount)}</NotebookImportDetail>
            </NotebookImportDetails>
        </CardShell>
    );
}

function ConflictWarning({ native }: { native: boolean }): React.ReactElement {
    return (
        <div className={styles.warning} role="status">
            <AlertIcon size={16} aria-hidden="true" />
            <span>
                A notebook with this UUID already exists. Replace it, or create a new notebook with a different UUID.
                {native && ' Replacing removes the old notebook without overwriting existing native files.'}
            </span>
        </div>
    );
}

interface ShellProps {
    title: string;
    children: React.ReactNode;
    actions?: React.ReactNode;
    busy?: boolean;
    closeDisabled?: boolean;
    onClose?: () => void;
}

function CardShell(props: ShellProps): React.ReactElement {
    return (
        <div className={`${baseStyles.page} ${styles.page}`} data-electron-drag-region>
            <ParticleFlowBackground />
            <CompactNavBar />
            <main className={`${baseStyles.banner_and_content_container} ${styles.foreground}`}>
                <div className={baseStyles.content_container}>
                    <section className={`${baseStyles.card} ${styles.card}`} aria-labelledby="notebook-import-card-title" aria-busy={props.busy || undefined}>
                        <div className={baseStyles.card_header} data-electron-drag-region>
                            <div className={baseStyles.card_header_left_container}>
                                <h1 id="notebook-import-card-title" className={`${baseStyles.card_header_left_title} ${styles.title}`}>{props.title}</h1>
                            </div>
                            {props.onClose != null && (
                                <div className={baseStyles.card_header_right_container}>
                                    <IconButton aria-label="Close" disabled={props.closeDisabled} size={ButtonSize.Small} variant={ButtonVariant.Invisible} onClick={props.onClose}>
                                        <XIcon size={16} />
                                    </IconButton>
                                </div>
                            )}
                        </div>
                        <div className={baseStyles.card_section}>
                            <div className={baseStyles.section_entries}>{props.children}</div>
                            {props.actions != null && <div className={baseStyles.card_actions}><div className={baseStyles.card_actions_right}>{props.actions}</div></div>}
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}

function NotebookImportDetails(props: React.PropsWithChildren): React.ReactElement {
    return <dl className={styles.details}>{props.children}</dl>;
}

function NotebookImportDetail(props: { label: string; children: React.ReactNode; mono?: boolean }): React.ReactElement {
    return <><dt>{props.label}</dt><dd className={props.mono ? styles.mono : undefined}>{props.children}</dd></>;
}

function formatScriptSummary(count: string, numericCount: number, folderCount: number): string {
    return `${count} ${numericCount === 1 ? 'script' : 'scripts'} in ${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}`;
}

function progressDetails(progress: HttpNotebookLoadProgress): { status: string; notebookName: string | null; notebookId: string | null } {
    switch (progress.phase) {
        case 'preparing': return { status: 'Preparing notebook loader...', notebookName: null, notebookId: null };
        case 'manifest': return { status: 'Loading notebook manifest...', notebookName: null, notebookId: null };
        case 'index': return { status: 'Discovering notebook files...', notebookName: progress.notebookName, notebookId: progress.notebookId };
        case 'files': return {
            status: progress.totalScriptCount === 0 ? 'No indexed scripts' : `Loading scripts: ${progress.completedScriptCount} of ${progress.totalScriptCount}`,
            notebookName: progress.notebookName,
            notebookId: progress.notebookId,
        };
    }
}
