import * as React from 'react';

import { ButtonSize, ButtonVariant, IconButton } from '../ui/foundations/button.js';
import { useFocusTrap } from '../ui/foundations/focus.js';
import { Overlay, OverlaySize } from '../ui/foundations/overlay.js';
import { FileDirectoryIcon, FileIcon, PlusIcon, UnlinkIcon, XIcon } from '../ui/foundations/symbol_icon.js';
import type { DashQLShellCommand } from './api.js';
import type { ExternalDirectoryMode } from '../platform/database/embedded_database.js';
import { CopyToClipboardButton } from '../utils/clipboard.js';
import {
    createShellFilesCommand,
    selectPlatformDirectory,
    selectPlatformFiles,
    type ShellFileListing,
    type ShellFileRegistry,
} from './shell_files.js';
import { useMountDialog } from './filesystem_mount_dialog.js';
import * as styles from './filesystem_dialog.module.css';

export interface FilesystemDialogActions {
    list(): Promise<readonly ShellFileListing[]>;
    unlink(path: string): Promise<void>;
    mount(signal?: AbortSignal): Promise<string>;
}

export interface FilesystemDialogController {
    request(signal?: AbortSignal): Promise<void>;
}

export interface FilesystemDialogHookResult {
    controller: FilesystemDialogController;
    dialog: React.ReactElement | null;
}

interface PendingRequest {
    resolve: () => void;
    signal?: AbortSignal;
    onAbort?: () => void;
}

export function useFilesystemDialog(actions: FilesystemDialogActions): FilesystemDialogHookResult {
    const [open, setOpen] = React.useState(false);
    const pendingRef = React.useRef<PendingRequest | null>(null);

    const resolvePending = React.useCallback(() => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        pending?.signal?.removeEventListener('abort', pending.onAbort!);
        pending?.resolve();
    }, []);
    const dismiss = React.useCallback(() => {
        setOpen(false);
        resolvePending();
    }, [resolvePending]);

    const request = React.useCallback((signal?: AbortSignal) => {
        if (pendingRef.current != null) return Promise.reject(new Error('A filesystem request is already pending.'));
        if (signal?.aborted) return Promise.resolve();
        setOpen(true);
        return new Promise<void>(resolve => {
            const pending: PendingRequest = { resolve, signal };
            pending.onAbort = dismiss;
            pendingRef.current = pending;
            signal?.addEventListener('abort', pending.onAbort, { once: true });
        });
    }, [dismiss]);

    React.useEffect(() => () => dismiss(), [dismiss]);
    const mount = React.useCallback(async () => {
        setOpen(false);
        const path = await actions.mount();
        if (path !== 'Mount cancelled') {
            setOpen(true);
        } else {
            resolvePending();
        }
        return path;
    }, [actions, resolvePending]);
    const controller = React.useMemo<FilesystemDialogController>(() => ({ request }), [request]);
    return {
        controller,
        dialog: open ? <FilesystemDialog actions={{ ...actions, mount }} onClose={dismiss} /> : null,
    };
}

export interface ShellFilesHookResult {
    /// The .fs command, opens the dialogs on the mounts of the registry
    command: DashQLShellCommand;
    dialogs: React.ReactElement;
}

/// The filesystem and mount dialogs of the .fs command.
/// The registry is read when a dialog needs it, it may be created after the command.
export function useShellFiles(registryRef: React.RefObject<ShellFileRegistry | null>): ShellFilesHookResult {
    const { controller: mountDialog, dialog: mountDialogOverlay } = useMountDialog({
        selectFiles: async signal => {
            const files = await selectPlatformFiles(signal);
            if (files.length === 0) return null;
            if (files.length !== 1) throw new Error('select exactly one file to choose a mount path');
            return { kind: 'file', name: files[0].path, file: files[0] };
        },
        selectDirectory: async mode => {
            const handle = await selectPlatformDirectory(mode);
            return { kind: 'directory', name: handle.name, handle, mode };
        },
        mount: async (selection, path, signal) => {
            const registry = registryRef.current;
            if (registry == null) throw new Error('Filesystem mounting is not ready');
            return selection.kind === 'file'
                ? await registry.mountFile(selection.file, path, { signal })
                : await registry.mountDirectory(selection.handle, path, selection.mode);
        },
    });
    const { controller: filesystemDialog, dialog: filesystemDialogOverlay } = useFilesystemDialog({
        list: async () => registryRef.current?.listFiles() ?? [],
        unlink: async path => {
            const registry = registryRef.current;
            if (registry == null || !await registry.drop(path)) throw new Error(`filesystem entry not registered: ${path}`);
        },
        mount: mountDialog.request,
    });
    const command = React.useMemo(
        () => createShellFilesCommand(mountDialog.request, filesystemDialog.request),
        [mountDialog, filesystemDialog],
    );
    return {
        command,
        dialogs: <>{mountDialogOverlay}{filesystemDialogOverlay}</>,
    };
}

function FilesystemDialog(props: { actions: FilesystemDialogActions; onClose: () => void }) {
    const headingId = React.useId();
    const dialogRef = React.useRef<HTMLElement>(null);
    const [entries, setEntries] = React.useState<readonly ShellFileListing[]>([]);
    const [error, setError] = React.useState<string | null>(null);
    const reload = React.useCallback(async () => {
        try {
            setEntries(await props.actions.list());
            setError(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
    }, [props.actions]);
    React.useEffect(() => { void reload(); }, [reload]);
    useFocusTrap({
        containerRef: dialogRef as React.RefObject<HTMLElement>,
        initialFocusRef: dialogRef as React.RefObject<HTMLElement>,
        restoreFocusOnCleanUp: true,
    });

    const unlink = async (path: string) => {
        try {
            await props.actions.unlink(path);
            await reload();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
    };

    return (
        <Overlay centered width={OverlaySize.L} onEscape={props.onClose} onClickOutside={props.onClose}>
            <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}>
                <header className={styles.header}>
                    <h2 id={headingId}>Filesystem</h2>
                    <div className={styles.header_actions}>
                        <IconButton variant={ButtonVariant.Invisible} aria-label="Mount filesystem entry" onClick={() => { void props.actions.mount().catch(() => { }); }}>
                            <PlusIcon />
                        </IconButton>
                        <IconButton variant={ButtonVariant.Invisible} aria-label="Close filesystem" onClick={props.onClose}>
                            <XIcon />
                        </IconButton>
                    </div>
                </header>
                {error != null && <p className={styles.error} role="alert">{error}</p>}
                {entries.length === 0 ? <p className={styles.empty}>No mounted entries</p> : <div className={styles.entries}>
                    {entries.map(entry => <FilesystemEntry key={entry.path} entry={entry} onUnlink={unlink} />)}
                </div>}
            </section>
        </Overlay>
    );
}

function FilesystemEntry(props: { entry: ShellFileListing; onUnlink: (path: string) => Promise<void> }) {
    const isDirectory = props.entry.directoryMode != null;
    return <div className={styles.entry}>
        {isDirectory ? <FileDirectoryIcon size={16} aria-hidden="true" /> : <FileIcon size={16} aria-hidden="true" />}
        <span className={styles.path}>{props.entry.path}</span>
        <div className={styles.entry_actions}>
            <span className={styles.mode}>{isDirectory ? displayMode(props.entry.directoryMode!) : 'READ'}</span>
            <CopyToClipboardButton
                variant={ButtonVariant.Invisible}
                size={ButtonSize.Small}
                value={props.entry.path}
                aria-label={`Copy ${props.entry.path}`}
                aria-labelledby=""
                logContext="shell_filesystem"
            />
            <IconButton
                className={styles.unlink}
                variant={ButtonVariant.Invisible}
                size={ButtonSize.Small}
                aria-label={`Unlink ${props.entry.path}`}
                onClick={() => { void props.onUnlink(props.entry.path); }}
            >
                <UnlinkIcon size={16} />
            </IconButton>
        </div>
    </div>;
}

function displayMode(mode: ExternalDirectoryMode): string {
    return mode === 'read' ? 'READ' : 'READ/WRITE';
}
