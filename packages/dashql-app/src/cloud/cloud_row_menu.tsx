import * as React from 'react';

import * as ActionList from '../ui/foundations/action_list.js';
import { AnchorAlignment, AnchorSide } from '../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../ui/foundations/anchored_overlay.js';
import { ButtonSize, ButtonVariant, IconButton } from '../ui/foundations/button.js';
import { SymbolIcon } from '../ui/foundations/symbol_icon.js';
import { useRowContextMenuOpener, type RowContextMenu } from '../ui/foundations/row_context_menu.js';
import * as actionMenuStyles from '../app/action_menu.module.css';

// The menu of a row of the clouds, in the sidebar and in the overview of a cloud

const MoreIcon = SymbolIcon('kebab_horizontal');

export interface CloudRowMenuItem {
    action: string;
    icon: React.ElementType;
    text: string;
    run: () => void;
    danger?: boolean;
    disabled?: boolean;
}

interface CloudRowMenuProps {
    /// What the menu is for, e.g. the name of the row
    label: string;
    items: CloudRowMenuItem[];
    contextMenu?: RowContextMenu;
    className?: string;
    side?: AnchorSide;
}

export const CloudRowMenu: React.FC<CloudRowMenuProps> = (props) => {
    const [open, setOpen] = React.useState(false);
    useRowContextMenuOpener(props.contextMenu, () => setOpen(true));
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            side={props.side ?? AnchorSide.OutsideRight}
            align={AnchorAlignment.Start}
            anchorOffset={4}
            renderAnchor={(anchorProps) => (
                <IconButton
                    {...anchorProps}
                    ref={triggerRef}
                    size={ButtonSize.Small}
                    variant={ButtonVariant.Invisible}
                    className={props.className}
                    data-testid="cloud-row-menu"
                    aria-label={`More actions for ${props.label}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        anchorProps.onClick?.(event);
                    }}
                >
                    <MoreIcon size={14} />
                </IconButton>
            )}
        >
            <div className={actionMenuStyles.menu} role="dialog" aria-label={`Actions for ${props.label}`}>
                <ActionList.List aria-label={`Actions for ${props.label}`}>
                    {props.items.map(item => (
                        <ActionList.ListItem
                            key={item.action}
                            data-testid="cloud-row-menu-item"
                            data-action={item.action}
                            className={item.danger ? actionMenuStyles.delete_action : undefined}
                            disabled={item.disabled}
                            onClick={(event: React.SyntheticEvent) => {
                                event.stopPropagation();
                                setOpen(false);
                                item.run();
                            }}
                        >
                            <ActionList.Leading><item.icon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>{item.text}</ActionList.ItemText>
                        </ActionList.ListItem>
                    ))}
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
};
