import * as React from 'react';

import { AnchoredOverlay } from '../../../ui/foundations/anchored_overlay.js';
import { AnchorAlignment, AnchorSide } from '../../../ui/foundations/anchored_position.js';
import { Button } from '../../../ui/foundations/button.js';
import { OverlaySize } from '../../../ui/foundations/overlay.js';
import { AlertIcon } from '../../../ui/foundations/symbol_icon.js';
import { NotebookImportCard, NotebookImportDetail, NotebookImportDetails } from './notebook_import_card.js';

import * as styles from './notebook_import_conflict_dialog.module.css';

interface NotebookImportConflictDialogBaseProps {
    notebookName: string;
    notebookUuid: string;
    existingDisplayLocation: string;
    existingIsNative: boolean;
    folderCount: number;
    scriptCount: number;
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
            tabIndex={-1}
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
                        <dd className={styles.path}>{props.existingDisplayLocation}</dd>
                    </div>
                </dl>
            </div>
            <footer className={styles.actions}>
                <Button disabled={props.busy} onClick={props.onCancel}>Cancel</Button>
                <Button disabled={props.busy} onClick={props.onReplace}>
                    Replace
                </Button>
                <Button
                    disabled={props.busy}
                    onClick={props.onCreateNew}
                >
                    Create New
                </Button>
            </footer>
        </section>
    );
}

export function NotebookImportConflictDialog(props: NotebookImportConflictDialogProps) {
    return props.mode === 'centered'
        ? <CenteredConflictCard {...props} />
        : <AnchoredConflictDialog {...props} />;
}

function CenteredConflictCard(props: CenteredNotebookImportConflictDialogProps) {
    return (
        <NotebookImportCard
            title="Import Notebook"
            busy={props.busy}
            closeDisabled={props.busy}
            onClose={props.onCancel}
            actions={
                <>
                    <Button disabled={props.busy} onClick={props.onReplace}>
                        Replace
                    </Button>
                    <Button disabled={props.busy} onClick={props.onCreateNew}>
                        Create New
                    </Button>
                </>
            }
        >
            <div className={styles.warning} role="status">
                <AlertIcon size={16} aria-hidden="true" />
                <span>
                    A notebook with this UUID already exists. Replace it, or create a new notebook with a different UUID.
                    {props.existingIsNative && ' Replacing removes the old notebook without overwriting existing native files.'}
                </span>
            </div>
            <NotebookImportDetails>
                <NotebookImportDetail label="Notebook">{props.notebookName}</NotebookImportDetail>
                <NotebookImportDetail label="UUID" mono>{props.notebookUuid}</NotebookImportDetail>
                <NotebookImportDetail label="Scripts">
                    {props.scriptCount} {props.scriptCount === 1 ? 'script' : 'scripts'} in {props.folderCount} {props.folderCount === 1 ? 'folder' : 'folders'}
                </NotebookImportDetail>
                <NotebookImportDetail label="Existing" mono>{props.existingDisplayLocation}</NotebookImportDetail>
            </NotebookImportDetails>
        </NotebookImportCard>
    );
}

function AnchoredConflictDialog(props: AnchoredNotebookImportConflictDialogProps) {
    const dialogRef = React.useRef<HTMLElement>(null);
    const cancel = React.useCallback(() => {
        if (!props.busy) props.onCancel();
    }, [props.busy, props.onCancel]);
    const content = (
        <DialogContent
            {...props}
            dialogRef={dialogRef}
        />
    );

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
            overlayProps={{ initialFocusRef: dialogRef }}
            focusTrapSettings={{
                initialFocusRef: dialogRef as React.RefObject<HTMLElement>,
                returnFocusRef: props.returnFocusRef as React.RefObject<HTMLElement>,
            }}
        >
            {content}
        </AnchoredOverlay>
    );
}
