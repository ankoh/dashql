import * as React from 'react';

import { Button, ButtonVariant } from '../../../ui/foundations/button.js';
import { AlertIcon } from '../../../ui/foundations/symbol_icon.js';
import type { HttpNotebookLoadResult } from '../persistence/http_notebook_bundle.js';
import { NotebookImportCard, NotebookImportDetail, NotebookImportDetails } from './notebook_import_card.js';
import * as styles from './notebook_loaded_card.module.css';

interface Props {
    result: HttpNotebookLoadResult;
    conflictLocation: string | null;
    conflictIsNative: boolean;
    busy: boolean;
    onImport(): void;
    onReplace(): void;
    onCreateNew(): void;
    onCancel(): void;
}

export function NotebookLoadedCard(props: Props): React.ReactElement {
    const { bundle, indexedScriptCount, loadedScriptCount, incomplete } = props.result;
    const notebookName = bundle.notebook.name?.trim()
        || bundle.notebook.metadata.originalFileName
        || 'Unnamed notebook';
    const folderCount = bundle.folders.length;
    const scriptCount = incomplete
        ? indexedScriptCount > 0
            ? `${loadedScriptCount} of ${indexedScriptCount}`
            : `${loadedScriptCount} (index unavailable)`
        : String(loadedScriptCount);
    const displayedScriptCount = incomplete && indexedScriptCount > 0 ? indexedScriptCount : loadedScriptCount;
    const scriptSummary = `${scriptCount} ${displayedScriptCount === 1 ? 'script' : 'scripts'} in ${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}`;
    const hasConflict = props.conflictLocation != null;

    return (
        <NotebookImportCard
            title="Import Notebook"
            busy={props.busy}
            closeDisabled={props.busy}
            onClose={props.onCancel}
            actions={
                hasConflict ? (
                    <>
                        <Button disabled={props.busy} onClick={props.onReplace}>
                            Replace
                        </Button>
                        <Button disabled={props.busy} onClick={props.onCreateNew}>
                            Create New
                        </Button>
                    </>
                ) : (
                    <Button
                        autoFocus
                        variant={ButtonVariant.Primary}
                        disabled={props.busy}
                        onClick={props.onImport}
                    >
                        Import
                    </Button>
                )
            }
        >
            {hasConflict && (
                <div className={styles.warning} role="status">
                    <AlertIcon size={16} aria-hidden="true" />
                    <span>
                        A notebook with this UUID already exists. Replace it, or create a new notebook with a different UUID.
                        {props.conflictIsNative && ' Replacing removes the old notebook without overwriting existing native files.'}
                    </span>
                </div>
            )}
            {incomplete && (
                <div className={styles.warning} role="status">
                    <AlertIcon size={16} aria-hidden="true" />
                    <span>Some notebook files could not be resolved. The available content will still be imported.</span>
                </div>
            )}
            <NotebookImportDetails>
                {props.conflictLocation != null && (
                    <NotebookImportDetail label="Existing" mono>{props.conflictLocation}</NotebookImportDetail>
                )}
                <NotebookImportDetail label="Source" mono>{bundle.notebook.metadata.originalHttpUrl}</NotebookImportDetail>
                <NotebookImportDetail label="UUID" mono>{bundle.notebook.notebookId}</NotebookImportDetail>
                <NotebookImportDetail label="Name">{notebookName}</NotebookImportDetail>
                <NotebookImportDetail label="Scripts">{scriptSummary}</NotebookImportDetail>
            </NotebookImportDetails>
        </NotebookImportCard>
    );
}
