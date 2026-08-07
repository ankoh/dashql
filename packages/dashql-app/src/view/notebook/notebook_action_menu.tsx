import * as React from 'react';
import { ThreeBarsIcon } from '@primer/octicons-react';

import type { ConnectionState } from '../../connection/connection_state.js';
import type { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import type { NotebookState } from '../../notebook/notebook_state.js';
import * as ActionList from '../foundations/action_list.js';
import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { ButtonVariant, IconButton } from '../foundations/button.js';
import { OverlaySize } from '../foundations/overlay.js';
import { NotebookCommandList } from './notebook_command_lists.js';
import type { NotebookFileTreeNavigationLevel } from './notebook_file_tree.js';

import * as styles from './notebook_action_menu.module.css';

export interface NotebookActionMenuProps {
    conn: ConnectionState | null;
    notebook: NotebookState;
    modifyNotebook: ModifyNotebook;
    navigationDisabled: boolean;
    navigationLevel: NotebookFileTreeNavigationLevel;
    onSelectFolderLevel: () => void;
    onSelectScriptLevel: () => void;
    onSelectPreviousTreeItem: () => void;
    onSelectNextTreeItem: () => void;
    listItem?: boolean;
    triggerClassName?: string;
    triggerRef?: React.Ref<HTMLButtonElement>;
}

export const NotebookActionMenu: React.FC<NotebookActionMenuProps> = (props) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);

    const open = React.useCallback(() => setIsOpen(true), []);
    const close = React.useCallback(() => setIsOpen(false), []);

    const setTriggerRef = React.useCallback((element: HTMLButtonElement | null) => {
        triggerRef.current = element;
        if (typeof props.triggerRef === 'function') {
            props.triggerRef(element);
        } else if (props.triggerRef) {
            props.triggerRef.current = element;
        }
    }, [props.triggerRef]);
    const side = props.listItem ? AnchorSide.OutsideRight : AnchorSide.OutsideBottom;
    const align = props.listItem ? AnchorAlignment.Start : AnchorAlignment.End;

    return (
        <AnchoredOverlay
            open={isOpen}
            onOpen={open}
            onClose={close}
            renderAnchor={(anchorProps) => props.listItem ? (
                <ActionList.ListItem {...anchorProps} ref={setTriggerRef} aria-label="Open notebook actions">
                    <ActionList.Leading><span className={styles.leading_spacer} aria-hidden="true" /></ActionList.Leading>
                    <ActionList.ItemText>More</ActionList.ItemText>
                </ActionList.ListItem>
            ) : (
                <IconButton
                    {...anchorProps}
                    ref={setTriggerRef}
                    className={`${styles.trigger} ${props.triggerClassName ?? ''}`.trim()}
                    variant={ButtonVariant.Default}
                    aria-label="Open notebook actions"
                >
                    <ThreeBarsIcon />
                </IconButton>
            )}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            side={side}
            align={align}
            anchorOffset={8}
            width={OverlaySize.S}
            focusZoneSettings={{ disabled: true }}
            overlayProps={{
                preventFocusOnOpen: false,
            }}
        >
            <div className={styles.overlay} role="dialog" aria-label="Notebook actions">
                <ActionList.List className={styles.action_list} aria-label="Notebook actions">
                    <ActionList.GroupHeading>Notebook</ActionList.GroupHeading>
                    <NotebookCommandList
                        conn={props.conn}
                        notebook={props.notebook}
                        modifyNotebook={props.modifyNotebook}
                        navigationDisabled={props.navigationDisabled}
                        navigationLevel={props.navigationLevel}
                        onSelectFolderLevel={props.onSelectFolderLevel}
                        onSelectScriptLevel={props.onSelectScriptLevel}
                        onSelectPreviousTreeItem={props.onSelectPreviousTreeItem}
                        onSelectNextTreeItem={props.onSelectNextTreeItem}
                    />
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
};
