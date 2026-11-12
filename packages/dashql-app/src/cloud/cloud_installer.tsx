import * as React from 'react';
import * as styles from './cloud_installer.module.css';

import { Button, ButtonSize, ButtonVariant, IconButton } from '../ui/foundations/button.js';
import { IndicatorStatus, StatusIndicator } from '../ui/foundations/status_indicator.js';
import { SyncIcon } from '../ui/foundations/symbol_icon.js';
import {
    CLOUD_SCHEMA,
    inspectCloudStore,
    installCloudStore,
    type CloudInstallation,
    type CloudInstallProgress,
    type CloudMigration,
    type CloudQuery,
    type CloudStoreOptions,
} from './cloud_store_schema.js';

// The installer of DashQL in the cloud connection. See docs/design/cloud.md.
//
// It looks at the tables of DashQL in the connection and shows what it finds: no database to keep them in, no tables
// yet, tables that miss migrations of this DashQL, or tables of a newer DashQL. Installing and updating are the same:
// the installer lists the steps that it would run, runs them on request and marks each one as it ends. An installer of
// another client that holds the lock makes it wait.

/// The status of a step of the installer
type StepStatus = 'pending' | 'running' | 'done' | 'failed';

/// A step of the installer
interface Step {
    /// 'store' or the number of migrations that ran after it
    key: 'store' | number;
    description: string;
    /// What the step changes
    detail: string | null;
}

/// What a migration changes, for the list of steps
function describeMigration(migration: CloudMigration): string | null {
    const parts: string[] = [];
    const tables = Object.keys(migration.tables ?? {});
    if (tables.length > 0) parts.push(`Creates ${tables.join(', ')}`);
    for (const [tableName, columns] of Object.entries(migration.columns ?? {})) {
        parts.push(`Adds ${columns.map(column => column.name).join(', ')} to ${tableName}`);
    }
    if (migration.breaks === 'writers') parts.push('Older DashQL clients can no longer publish');
    if (migration.breaks === 'readers') parts.push('Older DashQL clients can no longer open workbooks');
    return parts.length === 0 ? null : parts.join('. ');
}

/// The steps that the installer would run
function stepsOf(installation: CloudInstallation): Step[] {
    const steps: Step[] = [];
    if (installation.state !== 'missing' && installation.state !== 'outdated') return steps;
    if (installation.store == null) {
        steps.push({ key: 'store', description: `Create the schema ${CLOUD_SCHEMA}`, detail: null });
    }
    for (const pending of installation.pending) {
        steps.push({ key: pending.version, description: pending.migration.description, detail: describeMigration(pending.migration) });
    }
    return steps;
}

/// What the installer found, in a few words
function summaryOf(installation: CloudInstallation): string {
    const version = installation.store?.version ?? 0;
    switch (installation.state) {
        case 'unreachable':
            return `No database ${installation.database} attached`;
        case 'missing':
            return 'Not installed';
        case 'outdated':
            return `Version ${version}, update to ${installation.known}`;
        case 'current':
            return version > installation.known ? `Version ${version}, from a newer DashQL` : `Installed, version ${version}`;
        case 'newer':
            return installation.canRead ? `Version ${version}, update DashQL to publish` : `Version ${version}, update DashQL to open`;
    }
}

/// The status of what the installer found, as an indicator
function indicatorOf(installation: CloudInstallation | null, running: boolean): IndicatorStatus {
    if (installation == null || running) return IndicatorStatus.Running;
    switch (installation.state) {
        case 'current':
            return IndicatorStatus.Succeeded;
        case 'unreachable':
        case 'newer':
            return IndicatorStatus.Failed;
        case 'missing':
        case 'outdated':
            return IndicatorStatus.None;
    }
}

const STEP_INDICATOR: Record<StepStatus, IndicatorStatus> = {
    pending: IndicatorStatus.None,
    running: IndicatorStatus.Running,
    done: IndicatorStatus.Succeeded,
    failed: IndicatorStatus.Failed,
};

export interface CloudInstallerProps {
    /// Runs the statements on the cloud connection
    query: CloudQuery;
    /// The database of DashQL and the migrations that this DashQL knows
    options?: CloudStoreOptions;
    /// More actions next to the ones of the installer
    actions?: React.ReactNode;
    /// Called with what the installer found, after every look at the tables
    onInspected?: (installation: CloudInstallation) => void;
}

export function CloudInstaller(props: CloudInstallerProps): React.ReactElement {
    const { query, onInspected } = props;
    // Only the database and the migrations matter, an options object of every render doesn't look again
    const options = React.useMemo<CloudStoreOptions>(
        () => ({ database: props.options?.database, migrations: props.options?.migrations }),
        [props.options?.database, props.options?.migrations]);
    const [installation, setInstallation] = React.useState<CloudInstallation | null>(null);
    /// The steps of the current or the last run, null before a run
    const [steps, setSteps] = React.useState<Step[] | null>(null);
    const [status, setStatus] = React.useState<ReadonlyMap<Step['key'], StepStatus>>(new Map());
    const [running, setRunning] = React.useState(false);
    const [waiting, setWaiting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [inspection, setInspection] = React.useState(0);
    const abort = React.useRef<AbortController | null>(null);

    // Look at the tables when the installer opens, after a run and on request
    React.useEffect(() => {
        const controller = new AbortController();
        setInstallation(null);
        inspectCloudStore(query, { ...options, signal: controller.signal })
            .then(found => {
                if (controller.signal.aborted) return;
                setInstallation(found);
                onInspected?.(found);
            })
            .catch(error => {
                if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error));
            });
        return () => controller.abort();
    }, [query, options, inspection]);
    React.useEffect(() => () => abort.current?.abort(), []);

    const install = React.useCallback(async () => {
        if (installation == null) return;
        const runSteps = stepsOf(installation);
        const statuses = new Map<Step['key'], StepStatus>(runSteps.map(step => [step.key, 'pending']));
        let current: Step['key'] | null = null;
        const mark = (key: Step['key'], value: StepStatus) => {
            statuses.set(key, value);
            setStatus(new Map(statuses));
        };
        const onProgress = (progress: CloudInstallProgress) => {
            switch (progress.type) {
                case 'store':
                    current = 'store';
                    mark('store', 'running');
                    break;
                case 'waiting':
                    setWaiting(true);
                    break;
                case 'migrating':
                    if (statuses.get('store') === 'running') mark('store', 'done');
                    setWaiting(false);
                    current = progress.version;
                    mark(progress.version, 'running');
                    break;
                case 'migrated':
                    mark(progress.version, 'done');
                    current = null;
                    break;
            }
        };
        const controller = new AbortController();
        abort.current = controller;
        setSteps(runSteps);
        setStatus(new Map(statuses));
        setError(null);
        setRunning(true);
        try {
            await installCloudStore(query, { ...options, signal: controller.signal, onProgress });
            // Steps that another installer ran while this one waited
            for (const step of runSteps) {
                if (statuses.get(step.key) !== 'done') mark(step.key, 'done');
            }
        } catch (error) {
            if (controller.signal.aborted) return;
            if (current != null) mark(current, 'failed');
            setError(error instanceof Error ? error.message : String(error));
        } finally {
            if (!controller.signal.aborted) {
                setRunning(false);
                setWaiting(false);
                setInspection(value => value + 1);
            }
        }
    }, [installation, options, query]);

    const shownSteps = running || steps != null ? steps ?? [] : installation == null ? [] : stepsOf(installation);
    const canInstall = installation != null && (installation.state === 'missing' || installation.state === 'outdated');
    const summary = installation == null ? 'Checking' : summaryOf(installation);
    const waitingNote = waiting
        ? 'Waiting for another client'
        : !running && installation?.locked && canInstall ? 'Another client is installing' : null;

    return (
        <div className={styles.installer} data-testid="cloud-installer" data-state={installation?.state ?? 'inspecting'}>
            <div className={styles.status}>
                <StatusIndicator status={indicatorOf(installation, running)} width="14px" height="14px" />
                <span className={styles.summary} data-testid="cloud-installer-summary">{summary}</span>
                <div className={styles.actions}>
                    {props.actions}
                    <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label="Check again"
                        disabled={running || (installation == null && error == null)} onClick={() => {
                            setSteps(null);
                            setStatus(new Map());
                            setError(null);
                            setInspection(value => value + 1);
                        }}>
                        <SyncIcon size={16} />
                    </IconButton>
                    {canInstall && (
                        <Button variant={ButtonVariant.Primary} size={ButtonSize.Small} disabled={running} onClick={() => void install()}
                            data-testid="cloud-installer-run">
                            {running
                                ? installation.state === 'missing' ? 'Installing' : 'Updating'
                                : error != null ? 'Try Again'
                                : installation.state === 'missing' ? 'Install' : 'Update'}
                        </Button>
                    )}
                </div>
            </div>
            {shownSteps.length > 0 && (
                <ol className={styles.steps}>
                    {shownSteps.map(step => {
                        const stepStatus = status.get(step.key) ?? 'pending';
                        return (
                            <li key={step.key} className={styles.step} data-testid="cloud-installer-step" data-status={stepStatus}
                                title={step.detail ?? undefined}>
                                <StatusIndicator status={STEP_INDICATOR[stepStatus]} width="12px" height="12px" />
                                <span className={styles.step_description}>{step.description}</span>
                            </li>
                        );
                    })}
                </ol>
            )}
            {waitingNote != null && <p className={styles.note} data-testid="cloud-installer-waiting">{waitingNote}</p>}
            {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
    );
}
