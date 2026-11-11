import * as React from 'react';
import * as styles from './cloud_installer.module.css';

import { Button, ButtonVariant } from '../ui/foundations/button.js';
import { AlertIcon, CheckIcon } from '../ui/foundations/symbol_icon.js';
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
        steps.push({ key: 'store', description: `Create the schema ${CLOUD_SCHEMA} and the store table`, detail: null });
    }
    for (const pending of installation.pending) {
        steps.push({ key: pending.version, description: pending.migration.description, detail: describeMigration(pending.migration) });
    }
    return steps;
}

/// What the installer found, in words
function summaryOf(installation: CloudInstallation, connectionName: string): string {
    const version = installation.store?.version ?? 0;
    switch (installation.state) {
        case 'unreachable':
            return `${connectionName} reaches no database ${installation.database}. Attach a database with the alias ${installation.database} to the connection, DashQL keeps its tables there.`;
        case 'missing':
            return `DashQL is not installed in ${connectionName}. The installer creates the schema ${CLOUD_SCHEMA} in the database ${installation.database}:`;
        case 'outdated':
            return `The tables of DashQL in ${connectionName} are at version ${version}, this DashQL knows version ${installation.known}. The update runs:`;
        case 'current':
            return version > installation.known
                ? `DashQL is installed in ${connectionName}, a newer DashQL updated it to version ${version}. This DashQL keeps working with it.`
                : `DashQL is installed in ${connectionName}, version ${version}.`;
        case 'newer':
            return installation.canRead
                ? `A newer DashQL updated the tables in ${connectionName} to version ${version}. Update DashQL to publish workbooks.`
                : `A newer DashQL updated the tables in ${connectionName} to version ${version}. Update DashQL to open and publish workbooks.`;
    }
}

const StepIcon = (props: { status: StepStatus }) => {
    switch (props.status) {
        case 'done':
            return <CheckIcon size={16} className={styles.step_done} aria-hidden="true" />;
        case 'failed':
            return <AlertIcon size={16} className={styles.step_failed} aria-hidden="true" />;
        case 'running':
            return <span className={styles.step_running} aria-hidden="true" />;
        case 'pending':
            return <span className={styles.step_pending} aria-hidden="true" />;
    }
};

export interface CloudInstallerProps {
    /// Runs the statements on the cloud connection
    query: CloudQuery;
    /// The name of the cloud connection
    connectionName: string;
    /// The database of DashQL and the migrations that this DashQL knows
    options?: CloudStoreOptions;
    /// The connection is the embedded Hyper, the local cloud that keeps the tables in this browser
    embedded?: boolean;
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
    const summary = installation == null
        ? `Looking for DashQL in ${props.connectionName}`
        : summaryOf(installation, props.connectionName);

    return (
        <div className={styles.installer} data-testid="cloud-installer" data-state={installation?.state ?? 'inspecting'}>
            <p className={styles.summary} data-testid="cloud-installer-summary">{summary}</p>
            {props.embedded && (
                <p className={styles.note}>
                    The local cloud keeps the tables in a database of this browser, use it to try the cloud. The Cloud overlay resets it.
                </p>
            )}
            {shownSteps.length > 0 && (
                <ol className={styles.steps}>
                    {shownSteps.map(step => {
                        const stepStatus = status.get(step.key) ?? 'pending';
                        return (
                            <li key={step.key} className={styles.step} data-testid="cloud-installer-step" data-status={stepStatus}>
                                <StepIcon status={stepStatus} />
                                <div className={styles.step_text}>
                                    <div className={styles.step_description}>{step.description}</div>
                                    {step.detail && <div className={styles.step_detail}>{step.detail}</div>}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
            {(waiting || (!running && installation?.locked && canInstall)) && (
                <p className={styles.note} data-testid="cloud-installer-waiting">
                    {waiting
                        ? 'Waiting for another client that is installing or updating DashQL.'
                        : 'Another client is installing or updating DashQL, the installer waits for it.'}
                </p>
            )}
            {error && <p className={styles.error} role="alert">{error}</p>}
            <div className={styles.actions}>
                <Button variant={ButtonVariant.Default} disabled={running || (installation == null && error == null)} onClick={() => {
                    setSteps(null);
                    setStatus(new Map());
                    setError(null);
                    setInspection(value => value + 1);
                }}>
                    Check Again
                </Button>
                {canInstall && (
                    <Button variant={ButtonVariant.Primary} disabled={running} onClick={() => void install()} data-testid="cloud-installer-run">
                        {running
                            ? installation.state === 'missing' ? 'Installing' : 'Updating'
                            : error != null ? 'Try Again'
                            : installation.state === 'missing' ? 'Install DashQL' : 'Update DashQL'}
                    </Button>
                )}
            </div>
        </div>
    );
}
