import * as React from 'react';
import * as styles from '../scripts/script_diagnostics.module.css';

import { XCircleFillIcon } from '@akohn/dashql-react/components/symbol_icon';
import { Button, ButtonSize, ButtonVariant } from '@akohn/dashql-react/components/button';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { OverlaySize } from '@akohn/dashql-react/components/overlay';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import { diagnosticCount } from '../scripts/script_diagnostics.js';

/// The errors of a script of a workbook, as the bar of the workbook shows them
export interface WorkbookScriptErrors {
    scriptKey: number;
    fileName: string;
    /// The count of the errors of the script
    errors: number;
    /// The message of its first error
    message: string;
}

interface Props {
    /// The workbook of the scripts, the list closes when it changes
    workbookId: string;
    /// The scripts with errors in feed order
    scripts: readonly WorkbookScriptErrors[];
    /// Show a script in the feed
    showScript(scriptKey: number): void;
}

/// The errors of the scripts of a workbook in its bar: their count, and the scripts with errors in a list that shows a
/// script in the feed. Nothing without errors.
export function WorkbookErrorsButton({ workbookId, scripts, showScript }: Props): React.ReactElement | null {
    const [open, setOpen] = React.useState(false);
    React.useEffect(() => setOpen(false), [workbookId]);
    const total = scripts.reduce((sum, script) => sum + script.errors, 0);
    React.useEffect(() => {
        if (total === 0) setOpen(false);
    }, [total]);
    if (total === 0) return null;
    const summary = `${diagnosticCount(total, 'error')} in ${scripts.length} ${scripts.length === 1 ? 'script' : 'scripts'}`;
    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.Start}
            anchorOffset={4}
            width={OverlaySize.M}
            focusZoneSettings={{ disabled: true }}
            renderAnchor={anchorProps => (
                <Button
                    {...anchorProps}
                    className={styles.error_trigger}
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    leadingVisual={<XCircleFillIcon size={14} aria-hidden="true" />}
                    aria-label={`Show ${summary}`}
                    data-testid="workbook-errors"
                >
                    {total}
                </Button>
            )}
        >
            <section className={styles.overlay} role="dialog" aria-label="Workbook errors" data-testid="workbook-errors-list">
                <header className={styles.header}>
                    <h2 className={styles.title}>Errors</h2>
                    <span className={styles.summary}>{summary}</span>
                </header>
                <ul className={styles.list}>
                    {scripts.map(script => {
                        const name = scriptDisplayName(script.fileName);
                        return (
                            <li key={script.scriptKey} className={styles.entry}>
                                <button
                                    type="button"
                                    className={styles.item}
                                    onClick={() => {
                                        setOpen(false);
                                        showScript(script.scriptKey);
                                    }}
                                    aria-label={`Show ${name}: ${script.message}`}
                                >
                                    <span className={styles.error_icon} aria-hidden="true">
                                        <XCircleFillIcon size={16} />
                                    </span>
                                    <span className={styles.message}>
                                        <span className={styles.script_name}>{name}</span>
                                        {script.message}
                                    </span>
                                    {script.errors > 1 && <span className={styles.location}>{diagnosticCount(script.errors, 'error')}</span>}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </section>
        </AnchoredOverlay>
    );
}
