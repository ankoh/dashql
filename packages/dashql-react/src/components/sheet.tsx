import * as React from 'react';
import * as styles from './sheet.module.css';

import { ButtonSize, ButtonVariant, IconButton } from './button.js';
import { Portal } from './portal.js';
import { useOverlay } from './overlay.js';
import { XIcon } from './symbol_icon.js';
import { useFocusTrap } from '../dom/focus.js';

export interface SheetProps {
    /// The title in the header of the sheet, it names the dialog
    title: React.ReactNode;
    /// The name of the dialog for a title that is no text
    'aria-label'?: string;
    /// Close the sheet: Escape, a click on the backdrop or the close button
    onClose: () => void;
    /// The controls at the end of the header, before the close button, e.g. the arrows that step through rows
    actions?: React.ReactNode;
    /// The element that gets the focus back when the sheet closes
    returnFocusRef?: React.RefObject<HTMLElement | null>;
    'data-testid'?: string;
    children?: React.ReactNode;
}

/// A sheet over the page: from the bottom on a compact window, at the right edge on a wider one
/// (docs/design/narrow_layouts.md). It shows what belongs to one thing the user picked, e.g. the fields of a row of a
/// result or the lineage of a box of the dataflow. The page stays where it was, Escape, the backdrop and the close
/// button close the sheet.
export function Sheet(props: SheetProps): React.ReactElement {
    const closeRef = React.useRef<HTMLButtonElement>(null);
    const titleId = React.useId();
    const overlayRef = useOverlay({
        onEscape: props.onClose,
        onClickOutside: props.onClose,
        returnFocusRef: props.returnFocusRef,
        initialFocusRef: closeRef,
    });
    useFocusTrap({
        containerRef: overlayRef as React.RefObject<HTMLElement>,
        initialFocusRef: closeRef as React.RefObject<HTMLElement>,
    });
    return (
        <Portal>
            <>
            <div className={styles.backdrop} aria-hidden="true" />
            <section
                ref={overlayRef}
                className={styles.sheet}
                role="dialog"
                aria-modal="true"
                aria-label={props['aria-label']}
                aria-labelledby={props['aria-label'] == null ? titleId : undefined}
                data-testid={props['data-testid']}
            >
                <div className={styles.grabber} aria-hidden="true" />
                <header className={styles.header}>
                    <h2 id={titleId} className={styles.title}>{props.title}</h2>
                    {props.actions}
                    <IconButton ref={closeRef} size={ButtonSize.Small} variant={ButtonVariant.Invisible} aria-label="Close" data-testid="sheet-close" onClick={props.onClose}>
                        <XIcon size={16} />
                    </IconButton>
                </header>
                <div className={styles.body}>{props.children}</div>
            </section>
            </>
        </Portal>
    );
}
