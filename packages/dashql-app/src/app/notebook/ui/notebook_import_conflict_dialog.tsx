import * as React from 'react';

import { AnchoredOverlay } from '../../../ui/foundations/anchored_overlay.js';
import { AnchorAlignment, AnchorSide } from '../../../ui/foundations/anchored_position.js';
import { Button, ButtonVariant } from '../../../ui/foundations/button.js';
import { useFocusTrap } from '../../../ui/foundations/focus.js';
import { Overlay, OverlaySize } from '../../../ui/foundations/overlay.js';

import * as styles from './notebook_import_conflict_dialog.module.css';

interface NotebookImportConflictDialogBaseProps {
    notebookName: string;
    notebookUuid: string;
    existingDisplayLocation: string;
    busy: boolean;
    onReplace: () => void;
    onCreateNew: () => void;
    onCancel: () => void;
}

interface CenteredNotebookImportConflictDialogProps extends NotebookImportConflictDialogBaseProps {
    mode: 'centered';
}

interface AnchoredNotebookImportConflictDialogProps extends NotebookImportConflictDialogBaseProps {
    mode: 'anchored';
    anchorRef: React.RefObject<Element | null>;
    returnFocusRef: React.RefObject<HTMLElement | null>;
}

export type NotebookImportConflictDialogProps =
    | CenteredNotebookImportConflictDialogProps
    | AnchoredNotebookImportConflictDialogProps;

interface DialogContentProps extends NotebookImportConflictDialogBaseProps {
    dialogRef: React.RefObject<HTMLElement | null>;
    createNewButtonRef: React.RefObject<HTMLButtonElement | null>;
}

function DialogContent(props: DialogContentProps) {
    const titleId = React.useId();
    const descriptionId = React.useId();

    return (
        <section
            ref={props.dialogRef}
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            aria-busy={props.busy}
        >
            <header className={styles.header}>
                <h2 id={titleId}>Notebook already exists</h2>
            </header>
            <div className={styles.body}>
                <p id={descriptionId} className={styles.description}>
                    A notebook with this UUID already exists. Replace it, or create a new notebook with a different UUID.
                </p>
                <dl className={styles.details}>
                    <div>
                        <dt>Notebook</dt>
                        <dd>{props.notebookName}</dd>
                    </div>
                    <div>
                        <dt>UUID</dt>
                        <dd className={styles.uuid}>{props.notebookUuid}</dd>
                    </div>
                    <div>
                        <dt>Existing location</dt>
                        <dd>{props.existingDisplayLocation}</dd>
                    </div>
                </dl>
            </div>
            <footer className={styles.actions}>
                <Button disabled={props.busy} onClick={props.onCancel}>Cancel</Button>
                <Button
                    ref={props.createNewButtonRef}
                    disabled={props.busy}
                    variant={ButtonVariant.Primary}
                    onClick={props.onCreateNew}
                >
                    Create new
                </Button>
                <Button disabled={props.busy} variant={ButtonVariant.Danger} onClick={props.onReplace}>
                    Replace
                </Button>
            </footer>
        </section>
    );
}

export function NotebookImportConflictDialog(props: NotebookImportConflictDialogProps) {
    const dialogRef = React.useRef<HTMLElement>(null);
    const createNewButtonRef = React.useRef<HTMLButtonElement>(null);
    const cancel = React.useCallback(() => {
        if (!props.busy) props.onCancel();
    }, [props.busy, props.onCancel]);
    const content = (
        <DialogContent
            {...props}
            dialogRef={dialogRef}
            createNewButtonRef={createNewButtonRef}
        />
    );

    if (props.mode === 'anchored') {
        return (
            <AnchoredOverlay
                renderAnchor={null}
                anchorRef={props.anchorRef}
                returnFocusRef={props.returnFocusRef}
                open
                onClose={cancel}
                side={AnchorSide.OutsideBottom}
                align={AnchorAlignment.End}
                width={OverlaySize.L}
                overlayProps={{ initialFocusRef: createNewButtonRef }}
                focusTrapSettings={{
                    initialFocusRef: createNewButtonRef as React.RefObject<HTMLElement>,
                    returnFocusRef: props.returnFocusRef as React.RefObject<HTMLElement>,
                }}
            >
                {content}
            </AnchoredOverlay>
        );
    }

    return (
        <CenteredDialog
            dialogRef={dialogRef}
            createNewButtonRef={createNewButtonRef}
            onCancel={cancel}
        >
            {content}
        </CenteredDialog>
    );
}

interface CenteredDialogProps {
    dialogRef: React.RefObject<HTMLElement | null>;
    createNewButtonRef: React.RefObject<HTMLButtonElement | null>;
    onCancel: () => void;
    children: React.ReactNode;
}

function CenteredDialog(props: CenteredDialogProps) {
    useFocusTrap({
        containerRef: props.dialogRef as React.RefObject<HTMLElement>,
        initialFocusRef: props.createNewButtonRef as React.RefObject<HTMLElement>,
        restoreFocusOnCleanUp: true,
    });

    return (
        <Overlay
            centered
            width={OverlaySize.L}
            height={OverlaySize.AUTO}
            preventFocusOnOpen
            onEscape={props.onCancel}
            onClickOutside={props.onCancel}
        >
            {props.children}
        </Overlay>
    );
}
