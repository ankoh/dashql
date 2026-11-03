import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { AnchorAlignment, AnchorSide } from '../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../ui/foundations/anchored_overlay.js';
import * as ActionList from '../ui/foundations/action_list.js';
import { ButtonSize, ButtonVariant, IconButton } from '../ui/foundations/button.js';
import {
    ChevronDownIcon,
    ChevronRightIcon,
    FileDirectoryFillIcon,
    FileDirectoryOpenFillIcon,
    PencilIcon,
    PlusIcon,
    SymbolIcon,
    TrashIcon,
} from '../ui/foundations/symbol_icon.js';
import { NameInput } from '../ui/foundations/name_input.js';
import { classNames } from '../utils/classnames.js';
import type { SessionTreeFolder } from '../storage/session_tree.js';
import * as actionMenuStyles from '../app/action_menu.module.css';
import * as styles from './session_workbench_sidebar.module.css';

const MoreIcon = SymbolIcon('kebab_horizontal');

/// The left padding of a folder row of the session list at a depth of the session tree
export function sessionListRowPadding(depth: number): number {
    return 8 + depth * 16;
}

/// The width of the caret column of folder and session rows with its gap, a session without scripts leaves it
/// empty so that its icon still lines up with the icons of its level
export const SESSION_LIST_CARET_COLUMN = 12 + 8;

interface SessionFolderRowProps {
    /// The sortable id of the row
    rowId: string;
    /// The folder
    folder: SessionTreeFolder;
    /// The depth of the folder, the folders of the root are at depth 0
    depth: number;
    /// Is the folder expanded?
    expanded: boolean;
    /// Is the name being edited?
    renaming: boolean;
    /// Expand or collapse the folder
    onToggle: () => void;
    /// Start editing the name, from the menu
    onStartRename: () => void;
    /// Commit an edited name
    onRename: (name: string) => void;
    /// Abandon the edit of the name
    onCancelRename: () => void;
    /// Create a session in the folder
    onNewSession: () => void;
    /// Create a subfolder
    onNewFolder: () => void;
    /// Move the folder to the root, null for a folder of the root
    onMoveToTopLevel: (() => void) | null;
    /// Delete the folder, its sessions move to the parent
    onDelete: () => void;
    /// Would a dragged row land in the folder?
    dropTarget: boolean;
}

/// A folder of the session list: caret, folder icon, name and a menu
export const SessionFolderRow: React.FC<SessionFolderRowProps> = (props) => {
    const renameInputRef = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => {
        if (!props.renaming) return;
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
    }, [props.renaming]);
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: props.rowId });
    const rowRef = React.useCallback((node: HTMLLIElement | null) => {
        setNodeRef(node);
        setActivatorNodeRef(node);
    }, [setNodeRef, setActivatorNodeRef]);
    const rowListeners = React.useMemo(() => listeners == null ? undefined : Object.fromEntries(
        Object.entries(listeners).map(([eventName, handler]) => [eventName, (event: React.SyntheticEvent<HTMLElement>) => {
            if (startsRowDrag(event)) handler(event);
        }]),
    ), [listeners]);
    const Caret = props.expanded ? ChevronDownIcon : ChevronRightIcon;
    const FolderIcon = props.expanded ? FileDirectoryOpenFillIcon : FileDirectoryFillIcon;
    return (
        <li
            ref={rowRef}
            className={classNames(styles.entry_surface, styles.entry_interactive, styles.session_row, styles.folder_row, {
                [styles.session_row_dragging]: isDragging,
                [styles.drop_into]: props.dropTarget,
            })}
            style={{ transform: CSS.Translate.toString(transform), transition, paddingLeft: sessionListRowPadding(props.depth) }}
            data-testid="session-folder-row"
            {...attributes}
            {...rowListeners}
        >
            {props.renaming ? (
                <div className={styles.tree_rename}>
                    <span className={styles.tree_caret} aria-hidden="true"><Caret size={12} /></span>
                    <FolderIcon size={14} aria-hidden="true" />
                    <NameInput
                        ref={renameInputRef}
                        className={styles.session_rename_input}
                        name={props.folder.name}
                        onCommit={props.onRename}
                        onCancel={props.onCancelRename}
                        ariaLabel="Folder name"
                        placeholder="Name this folder"
                    />
                </div>
            ) : (
                <button
                    type="button"
                    className={styles.tree_button}
                    aria-expanded={props.expanded}
                    title={props.folder.path.join('/')}
                    onClick={props.onToggle}
                >
                    <span className={styles.tree_caret} aria-hidden="true"><Caret size={12} /></span>
                    <FolderIcon size={14} aria-hidden="true" />
                    <span className={styles.session_name}>{props.folder.name}</span>
                </button>
            )}
            <SessionFolderMenu {...props} />
        </li>
    );
};

const SessionFolderMenu: React.FC<SessionFolderRowProps> = (props) => {
    const [open, setOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const run = (action: () => void) => (event: React.SyntheticEvent) => {
        event.stopPropagation();
        setOpen(false);
        action();
    };
    const label = props.folder.name;
    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            side={AnchorSide.OutsideRight}
            align={AnchorAlignment.Start}
            anchorOffset={4}
            renderAnchor={(anchorProps) => (
                <IconButton
                    {...anchorProps}
                    ref={triggerRef}
                    size={ButtonSize.Small}
                    variant={ButtonVariant.Invisible}
                    className={styles.session_menu_button}
                    data-testid="session-folder-menu"
                    aria-label={`More actions for folder ${label}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        anchorProps.onClick?.(event);
                    }}
                >
                    <MoreIcon size={14} />
                </IconButton>
            )}
        >
            <div className={actionMenuStyles.menu} role="dialog" aria-label={`Actions for folder ${label}`}>
                <ActionList.List aria-label={`Actions for folder ${label}`}>
                    <ActionList.ListItem data-testid="session-folder-menu-item" data-action="new-session" onClick={run(props.onNewSession)}>
                        <ActionList.Leading><PlusIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>New session</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem data-testid="session-folder-menu-item" data-action="new-folder" onClick={run(props.onNewFolder)}>
                        <ActionList.Leading><FileDirectoryFillIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>New folder</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem data-testid="session-folder-menu-item" data-action="rename" onClick={run(props.onStartRename)}>
                        <ActionList.Leading><PencilIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Rename</ActionList.ItemText>
                    </ActionList.ListItem>
                    <>{props.onMoveToTopLevel != null && (
                        <ActionList.ListItem data-testid="session-folder-menu-item" data-action="move-to-top-level" onClick={run(props.onMoveToTopLevel)}>
                            <ActionList.Leading><FileDirectoryOpenFillIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>Move to top level</ActionList.ItemText>
                        </ActionList.ListItem>
                    )}</>
                    <ActionList.ListItem data-testid="session-folder-menu-item" data-action="delete" className={actionMenuStyles.delete_action} onClick={run(props.onDelete)}>
                        <ActionList.Leading><TrashIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Delete folder</ActionList.ItemText>
                    </ActionList.ListItem>
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
};

// React bubbles the events of the portaled row menu overlays through the row.
// A row drag starts only from the row itself, never from those overlays or from a text field.
export function startsRowDrag(event: React.SyntheticEvent<HTMLElement>): boolean {
    const target = event.target;
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return false;
    return target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') == null;
}
