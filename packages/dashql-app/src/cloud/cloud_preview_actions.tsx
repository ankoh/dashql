import * as React from 'react';

import { Button, ButtonSize, ButtonVariant, IconButton } from '../ui/foundations/button.js';
import { DownloadIcon, LockIcon, XIcon } from '../ui/foundations/symbol_icon.js';
import { useLogger } from '../platform/logger_provider.js';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import * as styles from './cloud_preview_actions.module.css';
import { useCloudWorkbooks } from './cloud_workbooks.js';
import { setCloudWorkbookLoading, useCloudWorkbookLoading, type CloudLoadingStepId } from './cloud_workbook_loading.js';
import { SetupSteps } from '../app/setup_steps.js';
import * as baseStyles from '../ui/foundations/banner_page.module.css';

// The bar of a read-only look at a published workbook: it says that the workbook is read-only next to Execute All, and
// offers Import where Share and Export are. A card takes the place of the feed while a version is loaded.
// See docs/design/cloud.md.

interface BadgeProps {
    /// The class of the labels that the narrow layout hides
    labelClassName?: string;
}

/// Says that the workbook is a read-only preview
export const CloudPreviewBadge: React.FC<BadgeProps> = (props) => (
    <span className={styles.read_only} title="A version of a published workbook, import it to run or change it" data-testid="cloud-preview-badge">
        <LockIcon size={14} aria-hidden="true" />
        <span className={props.labelClassName}>Read-only preview</span>
    </span>
);

interface ActionsProps {
    /// The local workbook that shows a version of a published workbook
    workbookId: string;
    /// The class of the labels that the narrow layout hides
    labelClassName?: string;
}

/// Imports the version that the preview shows as a local workbook
export const CloudPreviewActions: React.FC<ActionsProps> = (props) => {
    const { importPreview } = useCloudWorkbooks();
    const logger = useLogger();
    const [importing, setImporting] = React.useState(false);
    const runImport = React.useCallback(async () => {
        setImporting(true);
        try {
            await importPreview(props.workbookId);
        } catch (error) {
            logger.error('Importing the published workbook failed', { workbookId: props.workbookId, error: stringifyError(error) }, 'cloud_preview');
        } finally {
            setImporting(false);
        }
    }, [importPreview, logger, props.workbookId]);
    return (
        <div className={styles.actions} data-testid="cloud-preview-actions">
            <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Primary}
                leadingVisual={DownloadIcon}
                aria-label="Import workbook"
                data-testid="cloud-preview-import"
                disabled={importing}
                onClick={() => { void runImport(); }}
            >
                <span className={props.labelClassName}>Import</span>
            </Button>
        </div>
    );
};

const LOADING_STEP_LABELS: Record<CloudLoadingStepId, string> = {
    download: 'Download from Cloud',
    connections: 'Resolve Connections',
    results: 'Add Query Results',
    scripts: 'Save Scripts',
    attachments: 'Save Attachments',
    open: 'Open Workbook',
};

/// The card in place of the feed while a version of a published workbook is loaded, like the card of a workbook file
/// that is imported: its steps with their status, a step without anything to do is skipped
export const CloudWorkbookLoadingCard: React.FC = () => {
    const loading = useCloudWorkbookLoading();
    if (loading == null) return null;
    const title = loading.preview ? 'Loading Preview' : 'Importing Workbook';
    return (
        <section className={`${baseStyles.card} ${styles.loading_card}`} data-testid="cloud-loading-card" aria-labelledby="cloud-loading-title"
            aria-busy={loading.error == null || undefined}>
            <div className={baseStyles.card_header}>
                <div className={baseStyles.card_header_left_container}>
                    <h1 id="cloud-loading-title" className={`${baseStyles.card_header_left_title} ${styles.loading_title}`}>{title}</h1>
                </div>
                {loading.error != null && (
                    <div className={baseStyles.card_header_right_container}>
                        <IconButton aria-label="Close" size={ButtonSize.Small} variant={ButtonVariant.Invisible}
                            data-testid="cloud-loading-close" onClick={() => setCloudWorkbookLoading(null)}>
                            <XIcon size={16} />
                        </IconButton>
                    </div>
                )}
            </div>
            <div className={`${baseStyles.card_section} ${styles.loading_body}`}>
                <div className={styles.loading_name} title={loading.name}>{loading.name}</div>
                <SetupSteps compact steps={loading.steps.map(step => ({
                    key: step.id,
                    label: LOADING_STEP_LABELS[step.id],
                    status: step.status,
                    detail: step.detail,
                    testId: `cloud-loading-step-${step.id}`,
                }))} />
                {loading.error != null && <div className={styles.loading_error} role="alert">{loading.error}</div>}
            </div>
        </section>
    );
};
