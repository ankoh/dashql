import * as React from 'react';

import * as baseStyles from '../../ui/foundations/banner_page.module.css';
import { Button, ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { ProgressBar } from '../../ui/foundations/progress_bar.js';
import { IndicatorStatus, StatusIndicator } from '../../ui/foundations/status_indicator.js';
import { AlertIcon, XIcon } from '../../ui/foundations/symbol_icon.js';
import { formatBytes } from '../../utils/format.js';
import type { SessionBundle } from '../../storage/session_bundle.js';
import { CompactNavBar } from '../../app/navbar.js';
import { SetupSteps } from '../../app/setup_steps.js';
import { useAppFlavor } from '../../config/flavor_provider.js';
import type { HttpSessionLoadProgress, HttpSessionLoadResult } from './http_session_bundle.js';
import * as styles from './session_import_card.module.css';

interface LoadingState {
    phase: 'loading';
    sourceUrl: string;
    progress: HttpSessionLoadProgress;
    onClose(): void;
}

interface ReadyState {
    phase: 'ready';
    result: HttpSessionLoadResult;
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
    sessionName: string;
    sessionUuid: string;
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
export type SessionFileLoadStage = 'reading' | 'validating' | 'resolving';
export type SessionFileFailureStage = SessionFileLoadStage | 'importing';

/// The steps of the import of a session file, in order. The query results are a step only if the file has some.
export type SessionFileStep = 'read' | 'check' | 'connections' | 'results' | 'session';

const SESSION_FILE_STEP_LABELS: Record<SessionFileStep, string> = {
    read: 'Read File',
    check: 'Check Archive',
    connections: 'Resolve Connections',
    results: 'Add Query Results',
    session: 'Save Session',
};

/// A step of the import of a session file, with a short detail such as a count
export interface SessionFileStepStatus {
    step: SessionFileStep;
    status: IndicatorStatus;
    detail?: string | null;
}

interface FileLoadingState {
    phase: 'file-loading';
    sourcePath: string;
    stage: SessionFileLoadStage;
    steps: SessionFileStepStatus[];
    fileByteCount: number | null;
    /// The session of the file, once the archive is checked
    bundle: SessionBundle | null;
    onClose(): void;
}

interface FileReadyState {
    phase: 'file-ready';
    sourcePath: string;
    fileByteCount: number;
    bundle: SessionBundle;
    steps: SessionFileStepStatus[];
    /// The registered session with the same id, the user replaces it or creates a new session
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
    bundle: SessionBundle | null;
    failedStage: SessionFileFailureStage;
    steps: SessionFileStepStatus[];
    errorMessage: string;
    onRetry(): void;
    onClose(): void;
}

/// A session file that was imported with problems the user should see before opening it
interface FileImportedState {
    phase: 'file-imported';
    sourcePath: string;
    fileByteCount: number;
    bundle: SessionBundle;
    steps: SessionFileStepStatus[];
    /// What went wrong, e.g. the query results that weren't added
    warning: string;
    /// The first error behind the warning
    warningDetail: string | null;
    onOpen(): void;
    onClose(): void;
}

export type SessionImportCardState = LoadingState | ReadyState | ConflictState
    | FileLoadingState | FileReadyState | FileErrorState | FileImportedState;

export interface SessionImportCardDependencies {
    CompactNavBar: typeof CompactNavBar;
}

const DEFAULT_DEPENDENCIES: SessionImportCardDependencies = {
    CompactNavBar,
};

export type SessionImportCardProps = SessionImportCardState & {
    dependencies?: SessionImportCardDependencies;
};

export function SessionImportCard(props: SessionImportCardProps): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    if (props.phase === 'loading') return <LoadingCard state={props} dependencies={dependencies} />;
    if (props.phase === 'conflict') return <ConflictCard state={props} dependencies={dependencies} />;
    if (props.phase === 'file-loading') return <FileLoadingCard state={props} dependencies={dependencies} />;
    if (props.phase === 'file-ready') return <FileReadyCard state={props} dependencies={dependencies} />;
    if (props.phase === 'file-error') return <FileErrorCard state={props} dependencies={dependencies} />;
    if (props.phase === 'file-imported') return <FileImportedCard state={props} dependencies={dependencies} />;
    return <ReadyCard state={props} dependencies={dependencies} />;
}

function LoadingCard({ state, dependencies }: { state: LoadingState; dependencies: SessionImportCardDependencies }): React.ReactElement {
    const details = progressDetails(state.progress);
    const fileProgress = state.progress.phase === 'files' ? state.progress : null;
    const percentage = fileProgress == null
        ? null
        : fileProgress.completedFileCount / fileProgress.totalFileCount * 100;
    return (
        <CardShell title="Loading Session" busy onClose={state.onClose} dependencies={dependencies}>
            <div className={styles.status} role="status" aria-live="polite">
                <span aria-hidden="true">
                    <StatusIndicator status={IndicatorStatus.Running} width="18px" height="18px" />
                </span>
                <span>{details.status}</span>
            </div>
            {percentage != null && (
                <ProgressBar
                    progress={percentage}
                    aria-label="Session files loaded"
                    aria-valuetext={`${fileProgress!.completedFileCount} of ${fileProgress!.totalFileCount} files`}
                />
            )}
            <SessionImportDetails>
                {details.sessionName != null && <SessionImportDetail label="Session">{details.sessionName}</SessionImportDetail>}
                {details.sessionId != null && <SessionImportDetail label="UUID" mono>{details.sessionId}</SessionImportDetail>}
                <SessionImportDetail label="Source" mono>{state.sourceUrl}</SessionImportDetail>
            </SessionImportDetails>
        </CardShell>
    );
}

function ReadyCard({ state, dependencies }: { state: ReadyState; dependencies: SessionImportCardDependencies }): React.ReactElement {
    const { bundle, listedScriptCount, loadedScriptCount, incomplete } = state.result;
    const sessionName = bundle.session.name?.trim() || bundle.session.metadata.originalFileName || 'Unnamed session';
    const scriptCount = incomplete
        ? listedScriptCount > 0 ? `${loadedScriptCount} of ${listedScriptCount}` : String(loadedScriptCount)
        : String(loadedScriptCount);
    const displayedScriptCount = incomplete && listedScriptCount > 0 ? listedScriptCount : loadedScriptCount;
    const scriptSummary = formatScriptSummary(scriptCount, displayedScriptCount, 0);
    const hasConflict = state.conflictLocation != null;
    const actions = hasConflict ? (
        <>
            <Button data-testid="session-import-replace" disabled={state.busy} onClick={state.onReplace}>Replace</Button>
            <Button data-testid="session-import-create-new" disabled={state.busy} onClick={state.onCreateNew}>Create New</Button>
        </>
    ) : (
        <Button data-testid="session-import-confirm" autoFocus variant={ButtonVariant.Primary} disabled={state.busy} onClick={state.onImport}>Import</Button>
    );

    return (
        <CardShell title="Import Session" busy={state.busy} closeDisabled={state.busy} onClose={state.onClose} actions={actions} dependencies={dependencies}>
            {hasConflict && <ConflictWarning native={state.conflictIsNative} />}
            {incomplete && (
                <div className={styles.warning} role="status" data-testid="session-import-incomplete">
                    <AlertIcon size={16} aria-hidden="true" />
                    <span>Some session files could not be resolved. The available content will still be imported.</span>
                </div>
            )}
            <SessionImportDetails>
                {state.conflictLocation != null && <SessionImportDetail label="Existing" mono>{state.conflictLocation}</SessionImportDetail>}
                <SessionImportDetail label="Source" mono>{bundle.session.metadata.originalHttpUrl}</SessionImportDetail>
                <SessionImportDetail label="UUID" mono>{bundle.session.sessionId}</SessionImportDetail>
                <SessionImportDetail label="Name">{sessionName}</SessionImportDetail>
                <SessionImportDetail label="Scripts">{scriptSummary}</SessionImportDetail>
            </SessionImportDetails>
        </CardShell>
    );
}

const FILE_STAGE_STATUS: Record<SessionFileLoadStage, string> = {
    reading: 'Reading session file...',
    validating: 'Checking the session archive...',
    resolving: 'Resolving the connections...',
};

function FileLoadingCard({ state, dependencies }: { state: FileLoadingState; dependencies: SessionImportCardDependencies }): React.ReactElement {
    return (
        <CardShell title="Loading Session" wide busy onClose={state.onClose} dependencies={dependencies}
            split={<FileImportSplit sourcePath={state.sourcePath} fileByteCount={state.fileByteCount} bundle={state.bundle} steps={state.steps} />}
        >
            <div className={styles.visuallyHidden} role="status" aria-live="polite" data-testid="session-import-file-status" data-stage={state.stage}>
                {FILE_STAGE_STATUS[state.stage]}
            </div>
        </CardShell>
    );
}

function FileReadyCard({ state, dependencies }: { state: FileReadyState; dependencies: SessionImportCardDependencies }): React.ReactElement {
    const actions = state.conflict != null ? (
        <>
            <Button data-testid="session-import-replace" disabled={state.busy} onClick={state.onReplace}>Replace</Button>
            <Button data-testid="session-import-create-new" disabled={state.busy} onClick={state.onCreateNew}>Create New</Button>
        </>
    ) : (
        <Button data-testid="session-import-confirm" autoFocus variant={ButtonVariant.Primary} disabled={state.busy} onClick={state.onImport}>Import</Button>
    );
    return (
        <CardShell
            title="Import Session"
            wide
            busy={state.busy}
            closeDisabled={state.busy}
            onClose={state.onClose}
            actions={actions}
            dependencies={dependencies}
            split={<FileImportSplit sourcePath={state.sourcePath} fileByteCount={state.fileByteCount} bundle={state.bundle} steps={state.steps}
                existingLocation={state.conflict?.displayLocation ?? null} />}
        >
            {state.conflict != null && <ConflictWarning native={state.conflict.isNative} />}
            {state.busy ? (
                <div className={styles.visuallyHidden} role="status" aria-live="polite">Adding the session to DashQL...</div>
            ) : null}
        </CardShell>
    );
}

function FileImportedCard({ state, dependencies }: { state: FileImportedState; dependencies: SessionImportCardDependencies }): React.ReactElement {
    return (
        <CardShell
            title="Session Imported"
            wide
            onClose={state.onClose}
            actions={<Button data-testid="session-import-open" autoFocus variant={ButtonVariant.Primary} onClick={state.onOpen}>Open Session</Button>}
            dependencies={dependencies}
            split={<FileImportSplit sourcePath={state.sourcePath} fileByteCount={state.fileByteCount} bundle={state.bundle} steps={state.steps} />}
        >
            <div className={styles.warning} role="alert" data-testid="session-import-warning">
                <AlertIcon size={16} aria-hidden="true" />
                <div>
                    <div>{state.warning}</div>
                    {state.warningDetail != null && <div className={styles.errorDetail}>{state.warningDetail}</div>}
                </div>
            </div>
        </CardShell>
    );
}

function FileErrorCard({ state, dependencies }: { state: FileErrorState; dependencies: SessionImportCardDependencies }): React.ReactElement {
    const flavor = useAppFlavor();
    const summary = state.failedStage === 'reading'
        ? `${flavor.displayName} could not read this file.`
        : state.failedStage === 'validating'
            ? `This file is not a valid ${flavor.displayName} session archive.`
            : state.failedStage === 'resolving'
                ? `${flavor.displayName} could not resolve the connections of this session.`
                : `${flavor.displayName} could not import this session.`;
    return (
        <CardShell
            title="Session Import Failed"
            wide
            onClose={state.onClose}
            actions={<Button data-testid="session-import-retry" autoFocus variant={ButtonVariant.Primary} onClick={state.onRetry}>Try Again</Button>}
            dependencies={dependencies}
            split={<FileImportSplit sourcePath={state.sourcePath} fileByteCount={state.fileByteCount} bundle={state.bundle} steps={state.steps} />}
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

/// The summary of a session file on the left, the steps of its import on the right
function FileImportSplit(props: {
    sourcePath: string;
    fileByteCount: number | null;
    bundle: SessionBundle | null;
    steps: SessionFileStepStatus[];
    existingLocation?: string | null;
}): React.ReactElement {
    const bundle = props.bundle;
    const sessionName = bundle == null ? null
        : bundle.session.name?.trim() || bundle.session.metadata.originalFileName || 'Unnamed session';
    const results = bundle?.results ?? [];
    return (
        <>
            <div className={styles.splitPane} data-testid="session-import-summary">
                <SessionImportDetails>
                    <SessionImportDetail label="File" mono>{props.sourcePath}</SessionImportDetail>
                    {props.fileByteCount != null && <SessionImportDetail label="Size">{formatBytes(props.fileByteCount)}</SessionImportDetail>}
                    {props.existingLocation != null && <SessionImportDetail label="Existing" mono>{props.existingLocation}</SessionImportDetail>}
                    {bundle != null && (
                        <>
                            <SessionImportDetail label="Session">{sessionName}</SessionImportDetail>
                            <SessionImportDetail label="UUID" mono>{bundle.session.sessionId}</SessionImportDetail>
                            <SessionImportDetail label="Scripts">{formatCount(bundle.scripts.length, 'script')}</SessionImportDetail>
                        </>
                    )}
                    {results.length > 0 && (
                        <SessionImportDetail label="Query Results">
                            {`${formatCount(results.length, 'result')}, ${formatBytes(results.reduce((sum, result) => sum + result.bytes.size, 0))}`}
                        </SessionImportDetail>
                    )}
                </SessionImportDetails>
            </div>
            <div className={styles.splitPane} data-testid="session-import-steps">
                <SetupSteps compact steps={props.steps.map(step => ({
                    key: step.step,
                    label: SESSION_FILE_STEP_LABELS[step.step],
                    status: step.status,
                    detail: step.detail,
                    testId: `session-import-step-${step.step}`,
                }))} />
            </div>
        </>
    );
}

function ConflictCard({ state, dependencies }: { state: ConflictState; dependencies: SessionImportCardDependencies }): React.ReactElement {
    return (
        <CardShell
            title="Import Session"
            busy={state.busy}
            closeDisabled={state.busy}
            onClose={state.onClose}
            actions={<>
                <Button data-testid="session-import-replace" disabled={state.busy} onClick={state.onReplace}>Replace</Button>
                <Button data-testid="session-import-create-new" disabled={state.busy} onClick={state.onCreateNew}>Create New</Button>
            </>}
            dependencies={dependencies}
        >
            <ConflictWarning native={state.existingIsNative} />
            <SessionImportDetails>
                <SessionImportDetail label="Existing" mono>{state.existingLocation}</SessionImportDetail>
                <SessionImportDetail label="UUID" mono>{state.sessionUuid}</SessionImportDetail>
                <SessionImportDetail label="Name">{state.sessionName}</SessionImportDetail>
                <SessionImportDetail label="Scripts">{formatScriptSummary(String(state.scriptCount), state.scriptCount, state.folderCount)}</SessionImportDetail>
            </SessionImportDetails>
        </CardShell>
    );
}

function ConflictWarning({ native }: { native: boolean }): React.ReactElement {
    return (
        <div className={styles.warning} role="status" data-testid="session-import-conflict" data-native={native || undefined}>
            <AlertIcon size={16} aria-hidden="true" />
            <span>
                A session with this UUID already exists. Replace it, or create a new session with a different UUID.
                {native && ' Replacing removes the old session without overwriting existing native files.'}
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
    dependencies: SessionImportCardDependencies;
}

function CardShell(props: ShellProps): React.ReactElement {
    const { CompactNavBar: NavBar } = props.dependencies;
    return (
        <div className={baseStyles.page} data-electron-drag-region>
            <NavBar />
            <main className={baseStyles.banner_and_content_container}>
                <div className={baseStyles.content_container}>
                    <section className={`${baseStyles.card} ${props.wide ? styles.wideCard : styles.card}`} data-testid="session-import-card" aria-labelledby="session-import-card-title" aria-busy={props.busy || undefined}>
                        <div className={baseStyles.card_header} data-electron-drag-region>
                            <div className={baseStyles.card_header_left_container}>
                                <h1 id="session-import-card-title" className={`${baseStyles.card_header_left_title} ${styles.title}`}>{props.title}</h1>
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

function SessionImportDetails(props: React.PropsWithChildren): React.ReactElement {
    return <dl className={styles.details}>{props.children}</dl>;
}

function SessionImportDetail(props: { label: string; children: React.ReactNode; mono?: boolean }): React.ReactElement {
    return <><dt>{props.label}</dt><dd className={props.mono ? styles.mono : undefined}>{props.children}</dd></>;
}

function formatScriptSummary(count: string, numericCount: number, folderCount: number): string {
    return `${count} ${numericCount === 1 ? 'script' : 'scripts'} in ${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}`;
}

function formatCount(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function progressDetails(progress: HttpSessionLoadProgress): { status: string; sessionName: string | null; sessionId: string | null } {
    switch (progress.phase) {
        case 'preparing': return { status: 'Preparing session loader...', sessionName: null, sessionId: null };
        case 'manifest': return { status: 'Loading session manifest...', sessionName: null, sessionId: null };
        case 'listing': return { status: 'Discovering session files...', sessionName: progress.sessionName, sessionId: progress.sessionId };
        case 'files': return {
            status: progress.totalScriptCount === 0 ? 'No indexed scripts' : `Loading scripts: ${progress.completedScriptCount} of ${progress.totalScriptCount}`,
            sessionName: progress.sessionName,
            sessionId: progress.sessionId,
        };
    }
}
