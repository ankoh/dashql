import * as React from 'react';

import * as ActionList from '@akohn/dashql-react/components/action_list';
import { Button, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { useFocusTrap } from '@akohn/dashql-react/dom/focus';
import { Overlay, OverlaySize } from '@akohn/dashql-react/components/overlay';
import { FileDirectoryIcon, FileIcon, XIcon } from '@akohn/dashql-react/components/symbol_icon';
import { TextInput } from '@akohn/dashql-react/components/text_input';
import { usePendingRequest } from '../../utils/use_pending_request.js';
import * as styles from './filesystem_mount_dialog.module.css';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';

export interface MountDialogController {
    /// Choose a file or a folder and mount it, resolves with its path, null if the dialog was closed
    request(signal?: AbortSignal): Promise<string | null>;
}

export interface MountDialogHookResult {
    controller: MountDialogController;
    dialog: React.ReactElement | null;
}

export interface MountDialogActions {
    /// The chosen file, null if the user chose none
    selectFiles(signal?: AbortSignal): Promise<MountSelection | null>;
    /// The chosen folder, null if the user chose none
    selectDirectory(mode: 'read' | 'readwrite', signal?: AbortSignal): Promise<MountSelection | null>;
    mount(selection: MountSelection, path: string | undefined, signal?: AbortSignal): Promise<string>;
}

export type MountSelection = {
    readonly name: string;
    readonly kind: 'file';
    readonly file: File;
} | {
    readonly name: string;
    readonly kind: 'directory';
    readonly handle: FileSystemDirectoryHandle;
    readonly mode: 'read' | 'readwrite';
};

/// The mount dialog. A selection or a mount that fails shows its error, the dialog stays open for another try.
export function useMountDialog(actions: MountDialogActions): MountDialogHookResult {
    const { pending, request, resolve, dismiss } = usePendingRequest<void, string | null>('mount', null);
    const [selection, setSelection] = React.useState<MountSelection | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const signal = pending?.signal;

    const select = React.useCallback(async (action: (signal?: AbortSignal) => Promise<MountSelection | null>) => {
        setError(null);
        try {
            const next = await action(signal);
            if (next != null) setSelection(next);
        } catch (cause) {
            setError(stringifyError(cause));
        }
    }, [signal]);

    const mount = React.useCallback(async (path: string) => {
        if (selection == null) return;
        setError(null);
        try {
            resolve(await actions.mount(selection, path || undefined, signal));
        } catch (cause) {
            setError(stringifyError(cause));
        }
    }, [actions, resolve, selection, signal]);

    const controller = React.useMemo<MountDialogController>(() => ({
        request: requestSignal => {
            setSelection(null);
            setError(null);
            return request(undefined, requestSignal);
        },
    }), [request]);
    return {
        controller,
        dialog: pending == null ? null : (
            <MountDialog actions={actions} selection={selection} error={error} onCancel={dismiss} onMount={mount} onSelect={select} />
        ),
    };
}

interface MountDialogProps {
    actions: MountDialogActions;
    selection: MountSelection | null;
    error: string | null;
    onCancel: () => void;
    onMount: (path: string) => void;
    onSelect: (action: (signal?: AbortSignal) => Promise<MountSelection | null>) => void;
}

function MountDialog(props: MountDialogProps) {
    const headingId = React.useId();
    const dialogRef = React.useRef<HTMLElement>(null);
    const pathInputRef = React.useRef<HTMLInputElement>(null);
    const [path, setPath] = React.useState('');
    React.useEffect(() => {
        setPath(props.selection == null ? '' : `/mnt/external/${props.selection.name}`);
    }, [props.selection]);
    useFocusTrap({
        containerRef: dialogRef as React.RefObject<HTMLElement>,
        initialFocusRef: props.selection == null
            ? dialogRef as React.RefObject<HTMLElement>
            : pathInputRef as React.RefObject<HTMLElement>,
        restoreFocusOnCleanUp: true,
    });

    return (
        <Overlay
            centered
            width={OverlaySize.L}
            preventFocusOnOpen
            onEscape={props.onCancel}
            onClickOutside={props.onCancel}
        >
            <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}>
                <header className={styles.header}>
                    <h2 id={headingId}>{props.selection == null ? 'Filesystem Mount' : 'Mount Path'}</h2>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Close filesystem mount"
                        onClick={props.onCancel}
                    >
                        <XIcon />
                    </IconButton>
                </header>
                {props.error != null && <p className={styles.error} role="alert">{props.error}</p>}
                {props.selection == null ? <ActionList.List aria-label="Mount type" leading>
                    <ActionList.ListItem onClick={() => props.onSelect(props.actions.selectFiles)}>
                        <ActionList.Leading><FileIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>File</ActionList.ItemText>
                        <ActionList.Trailing><span className={styles.access_mode}>READ</span></ActionList.Trailing>
                    </ActionList.ListItem>
                    <ActionList.ListItem onClick={() => props.onSelect(signal => props.actions.selectDirectory('read', signal))}>
                        <ActionList.Leading><FileDirectoryIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Folder</ActionList.ItemText>
                        <ActionList.Trailing><span className={styles.access_mode}>READ</span></ActionList.Trailing>
                    </ActionList.ListItem>
                    <ActionList.ListItem onClick={() => props.onSelect(signal => props.actions.selectDirectory('readwrite', signal))}>
                        <ActionList.Leading><FileDirectoryIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Folder</ActionList.ItemText>
                        <ActionList.Trailing><span className={styles.access_mode}>READ/WRITE</span></ActionList.Trailing>
                    </ActionList.ListItem>
                </ActionList.List> : <form className={styles.path_form} onSubmit={event => {
                    event.preventDefault();
                    props.onMount(path);
                }}>
                    <TextInput
                        ref={pathInputRef}
                        id="mount-path"
                        aria-label="Mount path"
                        block
                        className={styles.mount_path}
                        value={path}
                        onChange={event => setPath(event.target.value)}
                    />
                    <div className={styles.actions}>
                        <Button variant={ButtonVariant.Invisible} onClick={props.onCancel}>Cancel</Button>
                        <Button variant={ButtonVariant.Primary} type="submit">Mount</Button>
                    </div>
                </form>}
            </section>
        </Overlay>
    );
}
