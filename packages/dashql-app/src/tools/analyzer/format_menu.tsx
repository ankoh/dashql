import * as React from 'react';
import * as dashql from '@akohn/dashql';
import * as styles from '../../app/action_menu.module.css';

import { Button, ButtonSize, ButtonVariant } from '@akohn/dashql-react/components/button';
import * as ActionList from '@akohn/dashql-react/components/action_list';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { BroomIcon } from '@akohn/dashql-react/components/symbol_icon';

export interface FormatMenuProps {
    /// The name of the script in the labels
    scriptName: string;
    /// Formatting needs the editor of the script
    disabled: boolean;
    onFormat: (mode: dashql.buffers.formatting.FormattingMode) => void;
}

/// The format button of a script card, it opens the formatting modes like the action menu of a feed entry
export function FormatMenu({ scriptName, disabled, onFormat }: FormatMenuProps) {
    const [open, setOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const run = (mode: dashql.buffers.formatting.FormattingMode) => {
        setOpen(false);
        onFormat(mode);
    };
    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            anchorOffset={4}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            renderAnchor={anchorProps => (
                <Button
                    {...anchorProps}
                    ref={triggerRef}
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    leadingVisual={BroomIcon}
                    disabled={disabled}
                >
                    Format
                </Button>
            )}
        >
            <div className={styles.menu} role="dialog" aria-label={`Format the ${scriptName}`}>
                <ActionList.List aria-label={`Format the ${scriptName}`}>
                    <ActionList.ListItem data-action="format-pretty" onClick={() => run(dashql.buffers.formatting.FormattingMode.PRETTY)}>
                        <ActionList.ItemText>Format Pretty</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem data-action="format-compact" onClick={() => run(dashql.buffers.formatting.FormattingMode.COMPACT)}>
                        <ActionList.ItemText>Format Compact</ActionList.ItemText>
                    </ActionList.ListItem>
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
}
