import * as React from 'react';

import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { OverlaySize } from '../../ui/foundations/overlay.js';
import { CheckIcon, CopyIcon, SymbolIcon, XIcon } from '../../ui/foundations/symbol_icon.js';
import {
    BUNDLED_NOTEBOOKS,
    bundledNotebookShareUrl,
    resolveBundledNotebookUrl,
    type BundledNotebook,
} from '../notebook/persistence/bundled_notebooks.js';
import { usePlatformEventListener } from '../../platform/events/event_listener_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import * as styles from './bundled_notebooks_overlay.module.css';

const BeakerIcon = SymbolIcon('beaker');

export function BundledNotebooksOverlay(): React.ReactElement {
    const appEvents = usePlatformEventListener();
    const logger = useLogger();
    const anchorRef = React.useRef<HTMLButtonElement>(null);
    const [open, setOpen] = React.useState(false);
    const [copiedId, setCopiedId] = React.useState<string | null>(null);
    const titleId = React.useId();

    const copyNotebookLink = React.useCallback(async (notebook: BundledNotebook) => {
        try {
            await navigator.clipboard.writeText(bundledNotebookShareUrl(notebook));
            setCopiedId(notebook.id);
        } catch (error) {
            logger.error('failed to copy bundled notebook link', { error: String(error) }, 'notebook_selector');
        }
    }, [logger]);

    const addNotebook = React.useCallback((notebook: BundledNotebook) => {
        setOpen(false);
        appEvents.dispatchNotebookUrl(resolveBundledNotebookUrl(notebook, new URL(globalThis.location.href)).toString());
    }, [appEvents]);

    return (
        <>
            <IconButton
                ref={anchorRef}
                variant={open ? ButtonVariant.Default : ButtonVariant.Invisible}
                aria-label="Example notebooks"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen(value => !value)}
            >
                <BeakerIcon size={16} />
            </IconButton>
            <AnchoredOverlay
                renderAnchor={null}
                anchorRef={anchorRef}
                returnFocusRef={anchorRef}
                open={open}
                onClose={() => setOpen(false)}
                side={AnchorSide.OutsideTop}
                align={AnchorAlignment.Start}
                width={OverlaySize.S}
            >
                <section className={styles.overlay} role="dialog" aria-labelledby={titleId}>
                    <header>
                        <h2 id={titleId}>Example Notebooks</h2>
                        <IconButton
                            aria-label="Close example notebooks"
                            size={ButtonSize.Small}
                            variant={ButtonVariant.Invisible}
                            onClick={() => setOpen(false)}
                        >
                            <XIcon size={16} />
                        </IconButton>
                    </header>
                    <ul>
                        {BUNDLED_NOTEBOOKS.map(notebook => {
                            const copied = copiedId === notebook.id;
                            return (
                                <li key={notebook.id}>
                                    <button
                                        className={styles.addButton}
                                        aria-label={`Add ${notebook.name} notebook`}
                                        onClick={() => addNotebook(notebook)}
                                    >
                                        {notebook.name}
                                    </button>
                                    <div className={styles.actions}>
                                        <IconButton
                                            aria-label={`Copy ${notebook.name} notebook link`}
                                            size={ButtonSize.Small}
                                            variant={ButtonVariant.Invisible}
                                            onClick={() => void copyNotebookLink(notebook)}
                                        >
                                            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                                        </IconButton>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    <span className={styles.status} role="status" aria-live="polite">
                        {copiedId == null ? '' : `${BUNDLED_NOTEBOOKS.find(notebook => notebook.id === copiedId)?.name} link copied`}
                    </span>
                </section>
            </AnchoredOverlay>
        </>
    );
}
