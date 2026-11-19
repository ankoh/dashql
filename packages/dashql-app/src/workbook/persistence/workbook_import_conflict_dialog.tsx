import * as React from 'react';

import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { Button } from '@akohn/dashql-react/components/button';
import { OverlaySize } from '@akohn/dashql-react/components/overlay';
import { WorkbookImportCard, type WorkbookImportCardDependencies } from './workbook_import_card.js';

import * as styles from './workbook_import_conflict_dialog.module.css';

interface WorkbookImportConflictDialogBaseProps {
    workbookName: string;
    workbookUuid: string;
    existingDisplayLocation: string;
    existingIsNative: boolean;
    folderCount: number;
    scriptCount: number;
    busy: boolean;
    onReplace: () => void;
    onCreateNew: () => void;
    onCancel: () => void;
    dependencies?: WorkbookImportCardDependencies;
}

interface CenteredWorkbookImportConflictDialogProps extends WorkbookImportConflictDialogBaseProps {
    mode: 'centered';
}

interface AnchoredWorkbookImportConflictDialogProps extends WorkbookImportConflictDialogBaseProps {
    mode: 'anchored';
    anchorRef: React.RefObject<Element | null>;
    returnFocusRef: React.RefObject<HTMLElement | null>;
}

export type WorkbookImportConflictDialogProps =
    | CenteredWorkbookImportConflictDialogProps
    | AnchoredWorkbookImportConflictDialogProps;

interface DialogContentProps extends WorkbookImportConflictDialogBaseProps {
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
                <h2 id={titleId}>Workbook already exists</h2>
            </header>
            <div className={styles.body}>
                <p id={descriptionId} className={styles.description}>
                    A workbook with this UUID already exists. Replace it, or create a new workbook with a different UUID.
                </p>
                <dl className={styles.details}>
                    <div>
                        <dt>Workbook</dt>
                        <dd>{props.workbookName}</dd>
                    </div>
                    <div>
                        <dt>UUID</dt>
                        <dd className={styles.uuid}>{props.workbookUuid}</dd>
                    </div>
                    <div>
                        <dt>Existing location</dt>
                        <dd className={styles.path}>{props.existingDisplayLocation}</dd>
                    </div>
                </dl>
            </div>
            <footer className={styles.actions}>
                <Button data-testid="workbook-import-cancel" disabled={props.busy} onClick={props.onCancel}>Cancel</Button>
                <Button data-testid="workbook-import-replace" disabled={props.busy} onClick={props.onReplace}>
                    Replace
                </Button>
                <Button
                    data-testid="workbook-import-create-new"
                    disabled={props.busy}
                    onClick={props.onCreateNew}
                >
                    Create New
                </Button>
            </footer>
        </section>
    );
}

export function WorkbookImportConflictDialog(props: WorkbookImportConflictDialogProps) {
    return props.mode === 'centered'
        ? <CenteredConflictCard {...props} />
        : <AnchoredConflictDialog {...props} />;
}

function CenteredConflictCard(props: CenteredWorkbookImportConflictDialogProps) {
    return (
        <WorkbookImportCard
            phase="conflict"
            workbookName={props.workbookName}
            workbookUuid={props.workbookUuid}
            existingLocation={props.existingDisplayLocation}
            existingIsNative={props.existingIsNative}
            folderCount={props.folderCount}
            scriptCount={props.scriptCount}
            busy={props.busy}
            onClose={props.onCancel}
            onReplace={props.onReplace}
            onCreateNew={props.onCreateNew}
            dependencies={props.dependencies}
        />
    );
}

function AnchoredConflictDialog(props: AnchoredWorkbookImportConflictDialogProps) {
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
