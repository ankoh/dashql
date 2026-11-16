import * as React from 'react';
import type * as core from '@akohn/dashql';

import * as baseStyles from '../../ui/foundations/banner_page.module.css';
import { Button, ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { ProgressBar } from '../../ui/foundations/progress_bar.js';
import { IndicatorStatus, StatusIndicator } from '../../ui/foundations/status_indicator.js';
import { AlertIcon, XIcon } from '../../ui/foundations/symbol_icon.js';
import { formatBytes } from '../../utils/format.js';
import { CompactNavBar } from '../../app/navbar.js';
import { SetupSteps } from '../../app/setup_steps.js';
import { useAppFlavor } from '../../config/flavor_provider.js';
import type { HttpWorkbookLoadProgress, HttpWorkbookLoadResult } from './http_workbook_bundle.js';
import { importedWorkbook, importedWorkbookName } from './workbook_import_provider.js';
import * as styles from './workbook_import_card.module.css';

interface LoadingState {
    phase: 'loading';
    sourceUrl: string;
    progress: HttpWorkbookLoadProgress;
    onClose(): void;
}

interface ReadyState {
    phase: 'ready';
    result: HttpWorkbookLoadResult;
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
    workbookName: string;
    workbookUuid: string;
    existingLocation: string;
    existingIsNative: boolean;
    folderCount: number;
    scriptCount: number;
    busy: boolean;
    onReplace(): void;
    onCreateNew(): void;
    onClose(): void;
}

/// The stages of a file before the user decides: reading it, checking the archive and resolving the connections
export type WorkbookFileLoadStage = 'reading' | 'validating' | 'resolving';
export type WorkbookFileFailureStage = WorkbookFileLoadStage | 'importing';

/// The steps of the import of a workbook file, in order. The query results are a step only if the file has some.
export type WorkbookFileStep = 'read' | 'check' | 'connections' | 'results' | 'workbook';

const WORKBOOK_FILE_STEP_LABELS: Record<WorkbookFileStep, string> = {
    read: 'Read File',
    check: 'Check Archive',
    connections: 'Resolve Connections',
    results: 'Add Query Results',
    workbook: 'Save Workbook',
};

/// A step of the import of a workbook file, with a short detail such as a count
export interface WorkbookFileStepStatus {
    step: WorkbookFileStep;
    status: IndicatorStatus;
    detail?: string | null;
}

interface FileLoadingState {
    phase: 'file-loading';
    sourcePath: string;
    stage: WorkbookFileLoadStage;
    steps: WorkbookFileStepStatus[];
    fileByteCount: number | null;
    /// The workbook of the file, once the archive is checked
    preview: core.ImportPreview | null;
    onClose(): void;
}

interface FileReadyState {
    phase: 'file-ready';
    sourcePath: string;
    fileByteCount: number;
    preview: core.ImportPreview;
    steps: WorkbookFileStepStatus[];
    /// The registered workbook with the same id, the user replaces it or creates a new workbook
    conflict: { displayLocation: string; isNative: boolean } | null;
    busy: boolean;
    onImport(): void;
    onReplace(): void;
    onCreateNew(): void;
    onClose(): void;
}

interface FileErrorState {
    phase: 'file-error';
    sourcePath: string;
    fileByteCount: number | null;
    preview: core.ImportPreview | null;
    failedStage: WorkbookFileFailureStage;
    steps: WorkbookFileStepStatus[];
    errorMessage: string;
    onRetry(): void;
    onClose(): void;
}

/// A workbook file that was imported with problems the user should see before opening it
interface FileImportedState {
    phase: 'file-imported';
    sourcePath: string;
    fileByteCount: number;
    preview: core.ImportPreview;
    steps: WorkbookFileStepStatus[];
    /// What went wrong, e.g. the query results that weren't added
    warning: string;
    /// The first error behind the warning
    warningDetail: string | null;
    onOpen(): void;
    onClose(): void;
}

export type WorkbookImportCardState = LoadingState | ReadyState | ConflictState
    | FileLoadingState | FileReadyState | FileErrorState | FileImportedState;

export interface WorkbookImportCardDependencies {
    CompactNavBar: typeof CompactNavBar;
}

const DEFAULT_DEPENDENCIES: WorkbookImportCardDependencies = {
    CompactNavBar,
};

export type WorkbookImportCardProps = WorkbookImportCardState & {
    dependencies?: WorkbookImportCardDependencies;
};

export function WorkbookImportCard(props: WorkbookImportCardProps): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    if (props.phase === 'loading') return <LoadingCard state={props} dependencies={dependencies} />;
    if (props.phase === 'conflict') return <ConflictCard state={props} dependencies={dependencies} />;
    if (props.phase === 'file-loading') return <FileLoadingCard state={props} dependencies={dependencies} />;
    if (props.phase === 'file-ready') return <FileReadyCard state={props} dependencies={dependencies} />;
    if (props.phase === 'file-error') return <FileErrorCard state={props} dependencies={dependencies} />;
    if (props.phase === 'file-imported') return <FileImportedCard state={props} dependencies={dependencies} />;
    return <ReadyCard state={props} dependencies={dependencies} />;
}

function LoadingCard({ state, dependencies }: { state: LoadingState; dependencies: WorkbookImportCardDependencies }): React.ReactElement {
    const details = progressDetails(state.progress);
    const fileProgress = state.progress.phase === 'files' ? state.progress : null;
    const percentage = fileProgress == null
        ? null
        : fileProgress.completedFileCount / fileProgress.totalFileCount * 100;
    return (
        <CardShell title="Loading Workbook" busy onClose={state.onClose} dependencies={dependencies}>
            <div className={styles.status} role="status" aria-live="polite">
                <span aria-hidden="true">
                    <StatusIndicator status={IndicatorStatus.Running} width="18px" height="18px" />
                </span>
                <span>{details.status}</span>
            </div>
            {percentage != null && (
                <ProgressBar
                    progress={percentage}
                    aria-label="Workbook files loaded"
                    aria-valuetext={`${fileProgress!.completedFileCount} of ${fileProgress!.totalFileCount} files`}
                />
            )}
            <WorkbookImportDetails>
                {details.workbookName != null && <WorkbookImportDetail label="Workbook">{details.workbookName}</WorkbookImportDetail>}
                {details.workbookId != null && <WorkbookImportDetail label="UUID" mono>{details.workbookId}</WorkbookImportDetail>}
                <WorkbookImportDetail label="Source" mono>{state.sourceUrl}</WorkbookImportDetail>
            </WorkbookImportDetails>
        </CardShell>
    );
}

function ReadyCard({ state, dependencies }: { state: ReadyState; dependencies: WorkbookImportCardDependencies }): React.ReactElement {
    const { preview, listedScriptCount, loadedScriptCount, incomplete } = state.result;
    const workbook = importedWorkbook(preview);
    const workbookName = importedWorkbookName(preview);
    const scriptCount = incomplete
        ? listedScriptCount > 0 ? `${loadedScriptCount} of ${listedScriptCount}` : String(loadedScriptCount)
        : String(loadedScriptCount);
    const displayedScriptCount = incomplete && listedScriptCount > 0 ? listedScriptCount : loadedScriptCount;
    const scriptSummary = formatScriptSummary(scriptCount, displayedScriptCount, 0);
    const hasConflict = state.conflictLocation != null;
    const actions = hasConflict ? (
        <>
            <Button data-testid="workbook-import-replace" disabled={state.busy} onClick={state.onReplace}>Replace</Button>
            <Button data-testid="workbook-import-create-new" disabled={state.busy} onClick={state.onCreateNew}>Create New</Button>
        </>
    ) : (
        <Button data-testid="workbook-import-confirm" autoFocus variant={ButtonVariant.Primary} disabled={state.busy} onClick={state.onImport}>Import</Button>
    );

    return (
        <CardShell title="Import Workbook" busy={state.busy} closeDisabled={state.busy} onClose={state.onClose} actions={actions} dependencies={dependencies}>
            {hasConflict && <ConflictWarning native={state.conflictIsNative} />}
            {incomplete && (
                <div className={styles.warning} role="status" data-testid="workbook-import-incomplete">
                    <AlertIcon size={16} aria-hidden="true" />
                    <span>Some workbook files could not be resolved. The available content will still be imported.</span>
                </div>
            )}
            <WorkbookImportDetails>
                {state.conflictLocation != null && <WorkbookImportDetail label="Existing" mono>{state.conflictLocation}</WorkbookImportDetail>}
                <WorkbookImportDetail label="Source" mono>{workbook.metadata.originalHttpUrl}</WorkbookImportDetail>
                <WorkbookImportDetail label="UUID" mono>{workbook.workbookId}</WorkbookImportDetail>
                <WorkbookImportDetail label="Name">{workbookName}</WorkbookImportDetail>
                <WorkbookImportDetail label="Scripts">{scriptSummary}</WorkbookImportDetail>
            </WorkbookImportDetails>
        </CardShell>
    );
}

const FILE_STAGE_STATUS: Record<WorkbookFileLoadStage, string> = {
    reading: 'Reading workbook file...',
    validating: 'Checking the workbook archive...',
    resolving: 'Resolving the connections...',
};

function FileLoadingCard({ state, dependencies }: { state: FileLoadingState; dependencies: WorkbookImportCardDependencies }): React.ReactElement {
    return (
        <CardShell title="Loading Workbook" wide busy onClose={state.onClose} dependencies={dependencies}
            split={<FileImportSplit sourcePath={state.sourcePath} fileByteCount={state.fileByteCount} preview={state.preview} steps={state.steps} />}
        >
            <div className={styles.visuallyHidden} role="status" aria-live="polite" data-testid="workbook-import-file-status" data-stage={state.stage}>
                {FILE_STAGE_STATUS[state.stage]}
            </div>
        </CardShell>
    );
}

function FileReadyCard({ state, dependencies }: { state: FileReadyState; dependencies: WorkbookImportCardDependencies }): React.ReactElement {
    const actions = state.conflict != null ? (
        <>
            <Button data-testid="workbook-import-replace" disabled={state.busy} onClick={state.onReplace}>Replace</Button>
            <Button data-testid="workbook-import-create-new" disabled={state.busy} onClick={state.onCreateNew}>Create New</Button>
        </>
    ) : (
        <Button data-testid="workbook-import-confirm" autoFocus variant={ButtonVariant.Primary} disabled={state.busy} onClick={state.onImport}>Import</Button>
    );
    return (
        <CardShell
            title="Import Workbook"
            wide
            busy={state.busy}
            closeDisabled={state.busy}
            onClose={state.onClose}
            actions={actions}
            dependencies={dependencies}
            split={<FileImportSplit sourcePath={state.sourcePath} fileByteCount={state.fileByteCount} preview={state.preview} steps={state.steps}
                existingLocation={state.conflict?.displayLocation ?? null} />}
        >
            {state.conflict != null && <ConflictWarning native={state.conflict.isNative} />}
            {state.busy ? (
                <div className={styles.visuallyHidden} role="status" aria-live="polite">Adding the workbook to DashQL...</div>
            ) : null}
        </CardShell>
    );
}

function FileImportedCard({ state, dependencies }: { state: FileImportedState; dependencies: WorkbookImportCardDependencies }): React.ReactElement {
    return (
        <CardShell
            title="Workbook Imported"
            wide
            onClose={state.onClose}
            actions={<Button data-testid="workbook-import-open" autoFocus variant={ButtonVariant.Primary} onClick={state.onOpen}>Open Workbook</Button>}
            dependencies={dependencies}
            split={<FileImportSplit sourcePath={state.sourcePath} fileByteCount={state.fileByteCount} preview={state.preview} steps={state.steps} />}
        >
            <div className={styles.warning} role="alert" data-testid="workbook-import-warning">
                <AlertIcon size={16} aria-hidden="true" />
                <div>
                    <div>{state.warning}</div>
                    {state.warningDetail != null && <div className={styles.errorDetail}>{state.warningDetail}</div>}
                </div>
            </div>
        </CardShell>
    );
}

function FileErrorCard({ state, dependencies }: { state: FileErrorState; dependencies: WorkbookImportCardDependencies }): React.ReactElement {
    const flavor = useAppFlavor();
    const summary = state.failedStage === 'reading'
        ? `${flavor.displayName} could not read this file.`
        : state.failedStage === 'validating'
            ? `This file is not a valid ${flavor.displayName} workbook archive.`
            : state.failedStage === 'resolving'
                ? `${flavor.displayName} could not resolve the connections of this workbook.`
                : `${flavor.displayName} could not import this workbook.`;
    return (
        <CardShell
            title="Workbook Import Failed"
            wide
            onClose={state.onClose}
            actions={<Button data-testid="workbook-import-retry" autoFocus variant={ButtonVariant.Primary} onClick={state.onRetry}>Try Again</Button>}
            dependencies={dependencies}
            split={<FileImportSplit sourcePath={state.sourcePath} fileByteCount={state.fileByteCount} preview={state.preview} steps={state.steps} />}
        >
            <div className={styles.error} role="alert" data-stage={state.failedStage}>
                <AlertIcon size={16} aria-hidden="true" />
                <div>
                    <div className={styles.errorSummary}>{summary}</div>
                    <div className={styles.errorDetail}>{state.errorMessage}</div>
                </div>
            </div>
        </CardShell>
    );
}

/// The summary of a workbook file on the left, the steps of its import on the right
function FileImportSplit(props: {
    sourcePath: string;
    fileByteCount: number | null;
    preview: core.ImportPreview | null;
    steps: WorkbookFileStepStatus[];
    existingLocation?: string | null;
}): React.ReactElement {
    const preview = props.preview;
    const results = preview?.results ?? { count: 0, bytes: 0 };
    return (
        <>
            <div className={styles.splitPane} data-testid="workbook-import-summary">
                <WorkbookImportDetails>
                    <WorkbookImportDetail label="File" mono>{props.sourcePath}</WorkbookImportDetail>
                    {props.fileByteCount != null && <WorkbookImportDetail label="Size">{formatBytes(props.fileByteCount)}</WorkbookImportDetail>}
                    {props.existingLocation != null && <WorkbookImportDetail label="Existing" mono>{props.existingLocation}</WorkbookImportDetail>}
                    {preview != null && (
                        <>
                            <WorkbookImportDetail label="Workbook">{importedWorkbookName(preview)}</WorkbookImportDetail>
                            <WorkbookImportDetail label="UUID" mono>{importedWorkbook(preview).workbookId}</WorkbookImportDetail>
                            <WorkbookImportDetail label="Scripts">{formatCount(preview.scriptCount, 'script')}</WorkbookImportDetail>
                        </>
                    )}
                    {results.count > 0 && (
                        <WorkbookImportDetail label="Query Results">
                            {`${formatCount(results.count, 'result')}, ${formatBytes(results.bytes)}`}
                        </WorkbookImportDetail>
                    )}
                </WorkbookImportDetails>
            </div>
            <div className={styles.splitPane} data-testid="workbook-import-steps">
                <SetupSteps compact steps={props.steps.map(step => ({
                    key: step.step,
                    label: WORKBOOK_FILE_STEP_LABELS[step.step],
                    status: step.status,
                    detail: step.detail,
                    testId: `workbook-import-step-${step.step}`,
                }))} />
            </div>
        </>
    );
}

function ConflictCard({ state, dependencies }: { state: ConflictState; dependencies: WorkbookImportCardDependencies }): React.ReactElement {
    return (
        <CardShell
            title="Import Workbook"
            busy={state.busy}
            closeDisabled={state.busy}
            onClose={state.onClose}
            actions={<>
                <Button data-testid="workbook-import-replace" disabled={state.busy} onClick={state.onReplace}>Replace</Button>
                <Button data-testid="workbook-import-create-new" disabled={state.busy} onClick={state.onCreateNew}>Create New</Button>
            </>}
            dependencies={dependencies}
        >
            <ConflictWarning native={state.existingIsNative} />
            <WorkbookImportDetails>
                <WorkbookImportDetail label="Existing" mono>{state.existingLocation}</WorkbookImportDetail>
                <WorkbookImportDetail label="UUID" mono>{state.workbookUuid}</WorkbookImportDetail>
                <WorkbookImportDetail label="Name">{state.workbookName}</WorkbookImportDetail>
                <WorkbookImportDetail label="Scripts">{formatScriptSummary(String(state.scriptCount), state.scriptCount, state.folderCount)}</WorkbookImportDetail>
            </WorkbookImportDetails>
        </CardShell>
    );
}

function ConflictWarning({ native }: { native: boolean }): React.ReactElement {
    return (
        <div className={styles.warning} role="status" data-testid="workbook-import-conflict" data-native={native || undefined}>
            <AlertIcon size={16} aria-hidden="true" />
            <span>
                A workbook with this UUID already exists. Replace it, or create a new workbook with a different UUID.
                {native && ' Replacing removes the old workbook without overwriting existing native files.'}
            </span>
        </div>
    );
}

interface ShellProps {
    title: string;
    children?: React.ReactNode;
    /// The two panes of a split body above the children, with a border between them
    split?: React.ReactNode;
    /// Wider, for a split body
    wide?: boolean;
    actions?: React.ReactNode;
    busy?: boolean;
    closeDisabled?: boolean;
    onClose?: () => void;
    dependencies: WorkbookImportCardDependencies;
}

function CardShell(props: ShellProps): React.ReactElement {
    const { CompactNavBar: NavBar } = props.dependencies;
    return (
        <div className={baseStyles.page} data-electron-drag-region>
            <NavBar />
            <main className={baseStyles.banner_and_content_container}>
                <div className={baseStyles.content_container}>
                    <section className={`${baseStyles.card} ${props.wide ? styles.wideCard : styles.card}`} data-testid="workbook-import-card" aria-labelledby="workbook-import-card-title" aria-busy={props.busy || undefined}>
                        <div className={baseStyles.card_header} data-electron-drag-region>
                            <div className={baseStyles.card_header_left_container}>
                                <h1 id="workbook-import-card-title" className={`${baseStyles.card_header_left_title} ${styles.title}`}>{props.title}</h1>
                            </div>
                            {props.onClose != null && (
                                <div className={baseStyles.card_header_right_container}>
                                    <IconButton data-testid="dialog-close" aria-label="Close" disabled={props.closeDisabled} size={ButtonSize.Small} variant={ButtonVariant.Invisible} onClick={props.onClose}>
                                        <XIcon size={16} />
                                    </IconButton>
                                </div>
                            )}
                        </div>
                        <div className={baseStyles.card_section}>
                            {props.split != null && <div className={styles.split}>{props.split}</div>}
                            {hasContent(props.children) && (
                                <div className={`${baseStyles.section_entries} ${props.split != null ? styles.belowSplit : ''}`}>{props.children}</div>
                            )}
                            {props.actions != null && <div className={baseStyles.card_actions}><div className={baseStyles.card_actions_right}>{props.actions}</div></div>}
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}

/// Does a node render anything? Lists of conditional children may hold only false and null.
function hasContent(node: React.ReactNode): boolean {
    return React.Children.toArray(node).some(child => !(typeof child === 'string' && child.trim() === ''));
}

function WorkbookImportDetails(props: React.PropsWithChildren): React.ReactElement {
    return <dl className={styles.details}>{props.children}</dl>;
}

function WorkbookImportDetail(props: { label: string; children: React.ReactNode; mono?: boolean }): React.ReactElement {
    return <><dt>{props.label}</dt><dd className={props.mono ? styles.mono : undefined}>{props.children}</dd></>;
}

function formatScriptSummary(count: string, numericCount: number, folderCount: number): string {
    return `${count} ${numericCount === 1 ? 'script' : 'scripts'} in ${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}`;
}

function formatCount(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function progressDetails(progress: HttpWorkbookLoadProgress): { status: string; workbookName: string | null; workbookId: string | null } {
    switch (progress.phase) {
        case 'preparing': return { status: 'Preparing workbook loader...', workbookName: null, workbookId: null };
        case 'manifest': return { status: 'Loading workbook manifest...', workbookName: null, workbookId: null };
        case 'listing': return { status: 'Discovering workbook files...', workbookName: progress.workbookName, workbookId: progress.workbookId };
        case 'files': return {
            status: progress.totalScriptCount === 0 ? 'No indexed scripts' : `Loading scripts: ${progress.completedScriptCount} of ${progress.totalScriptCount}`,
            workbookName: progress.workbookName,
            workbookId: progress.workbookId,
        };
    }
}
