import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import * as styles from '../../app/action_menu.module.css';

import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import * as ActionList from '../../ui/foundations/action_list.js';
import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { SymbolIcon } from '../../ui/foundations/symbol_icon.js';
import { type RowContextMenu, useRowContextMenuOpener } from '../../ui/foundations/row_context_menu.js';

/// Where a script is stored
export interface ScriptStorage {
    /// The file name of the script, e.g. "01_extract.sql"
    fileName: string;
    /// The full path of the script file, resolved when the storage view opens
    resolvePath: () => string;
    /// Rename the script file
    onRename: (name: string) => void;
}

interface Props {
    scriptName: string;
    formatDisabled: boolean;
    onFormat: (mode: dashql.buffers.formatting.FormattingMode) => void;
    onDelete: () => void;
    /// Edit the name of the script in place, the menu offers a rename action
    onRename?: () => void;
    /// Add a script above or below the script, the menu offers the add actions
    onAddAbove?: () => void;
    onAddBelow?: () => void;
    /// The storage of the script, the menu offers its storage view
    storage?: ScriptStorage;
    /// The size of the icon of the trigger, 16 by default
    iconSize?: number;
    /// The right click of the row that opens the menu
    contextMenu?: RowContextMenu;
}

const MoreIcon = SymbolIcon('kebab_horizontal');
const AddIcon = SymbolIcon('plus_16');
const FormatIcon = SymbolIcon('pencil_ai_16');
const RenameIcon = SymbolIcon('pencil_16');
const TrashIcon = SymbolIcon('trash_16');
const StorageIcon = SymbolIcon('file_directory_16');
const CloseIcon = SymbolIcon('x_16');

export const ScriptActionMenu: React.FC<Props> = (props) => {
    const [open, setOpen] = React.useState(false);
    // The menu switches to the storage view in place
    const [view, setView] = React.useState<'actions' | 'storage'>('actions');
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    useRowContextMenuOpener(props.contextMenu, () => { setView('actions'); setOpen(true); });
    const run = React.useCallback((action: () => void) => {
        setOpen(false);
        action();
    }, []);

    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => { setView('actions'); setOpen(true); }}
            onClose={() => setOpen(false)}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            anchorOffset={4}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            renderAnchor={(anchorProps) => (
                <IconButton
                    {...anchorProps}
                    ref={triggerRef}
                    data-testid="script-more-actions"
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    aria-label={`More actions for ${props.scriptName} script`}
                >
                    <MoreIcon size={props.iconSize ?? 16} />
                </IconButton>
            )}
        >
            {view === 'storage' && props.storage != null ? (
                <ScriptStorageView scriptName={props.scriptName} storage={props.storage} onClose={() => setOpen(false)} />
            ) : (
            <div className={styles.menu} role="dialog" aria-label={`Actions for ${props.scriptName} script`}>
                <ActionList.List aria-label={`Actions for ${props.scriptName} script`}>
                    {/* The list takes elements only, the fragments wrap the optional items */}
                    <>{props.onAddAbove != null && (
                        <ActionList.ListItem data-testid="script-menu-item" data-action="add-above" onClick={() => run(props.onAddAbove!)}>
                            <ActionList.Leading><AddIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>Add Above</ActionList.ItemText>
                        </ActionList.ListItem>
                    )}</>
                    <>{props.onAddBelow != null && (
                        <ActionList.ListItem data-testid="script-menu-item" data-action="add-below" onClick={() => run(props.onAddBelow!)}>
                            <ActionList.Leading><AddIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>Add Below</ActionList.ItemText>
                        </ActionList.ListItem>
                    )}</>
                    <ActionList.ListItem
                        data-testid="script-menu-item"
                        data-action="format-pretty"
                        disabled={props.formatDisabled}
                        onClick={() => run(() => props.onFormat(dashql.buffers.formatting.FormattingMode.PRETTY))}
                    >
                        <ActionList.Leading><FormatIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Format Pretty</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem
                        data-testid="script-menu-item"
                        data-action="format-compact"
                        disabled={props.formatDisabled}
                        onClick={() => run(() => props.onFormat(dashql.buffers.formatting.FormattingMode.COMPACT))}
                    >
                        <ActionList.Leading><FormatIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Format Compact</ActionList.ItemText>
                    </ActionList.ListItem>
                    <>{props.onRename != null && (
                        <ActionList.ListItem data-testid="script-menu-item" data-action="rename" onClick={() => run(props.onRename!)}>
                            <ActionList.Leading><RenameIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>Rename</ActionList.ItemText>
                        </ActionList.ListItem>
                    )}</>
                    <>{props.storage != null && (
                        <ActionList.ListItem data-testid="script-menu-item" data-action="storage" onClick={() => setView('storage')}>
                            <ActionList.Leading><StorageIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>Storage</ActionList.ItemText>
                        </ActionList.ListItem>
                    )}</>
                    <ActionList.ListItem
                        data-testid="script-menu-item"
                        data-action="delete"
                        className={styles.delete_action}
                        onClick={() => run(props.onDelete)}
                    >
                        <ActionList.Leading><TrashIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Delete</ActionList.ItemText>
                    </ActionList.ListItem>
                </ActionList.List>
            </div>
            )}
        </AnchoredOverlay>
    );
};

/// Where a script is stored, the file name can be edited
function ScriptStorageView(props: { scriptName: string; storage: ScriptStorage; onClose: () => void }) {
    const path = React.useMemo(() => props.storage.resolvePath(), [props.storage]);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const skipBlurCommitRef = React.useRef(false);
    React.useEffect(() => {
        if (inputRef.current != null) inputRef.current.value = props.storage.fileName;
    }, [props.storage.fileName]);
    const commit = (input: HTMLInputElement) => {
        const name = input.value.trim();
        if (name && name !== props.storage.fileName) props.storage.onRename(name);
    };
    const commitOnBlur = (event: React.FocusEvent<HTMLInputElement>) => {
        if (!skipBlurCommitRef.current) commit(event.currentTarget);
    };
    // Drop the focus without a commit. blur() fires its event synchronously, and none at all while the
    // window lacks focus, so the keys cannot leave it to the event to commit or to reset the flag.
    const blurWithoutCommit = (input: HTMLInputElement) => {
        skipBlurCommitRef.current = true;
        input.blur();
        skipBlurCommitRef.current = false;
    };
    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            commit(event.currentTarget);
            blurWithoutCommit(event.currentTarget);
        } else if (event.key === 'Escape') {
            // Abandon the edit
            event.currentTarget.value = props.storage.fileName;
            blurWithoutCommit(event.currentTarget);
        }
        event.stopPropagation();
    };
    return (
        <div className={styles.storage} role="dialog" aria-label={`Storage of ${props.scriptName} script`} data-testid="script-storage">
            <div className={styles.storage_header}>
                <span className={styles.storage_title}>Script Storage</span>
                <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label="Close script storage" data-testid="script-storage-close" onClick={props.onClose}>
                    <CloseIcon size={16} />
                </IconButton>
            </div>
            <div className={styles.storage_body}>
                <label className={styles.storage_label} htmlFor={`script-file-${props.storage.fileName}`}>File</label>
                <input
                    id={`script-file-${props.storage.fileName}`}
                    ref={inputRef}
                    className={styles.storage_input}
                    type="text"
                    aria-label="Script file name"
                    data-testid="script-file-name-input"
                    defaultValue={props.storage.fileName}
                    spellCheck={false}
                    onBlur={commitOnBlur}
                    onKeyDown={onKeyDown}
                    onPointerDown={event => event.stopPropagation()}
                />
                <span className={styles.storage_label}>Path</span>
                <span className={styles.storage_path} title={path}>{path}</span>
            </div>
        </div>
    );
}
