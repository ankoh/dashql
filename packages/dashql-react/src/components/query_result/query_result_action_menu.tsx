import * as React from 'react';
import * as styles from './query_result_action_menu.module.css';

import { ButtonSize, ButtonVariant, IconButton } from '../button.js';
import * as ActionList from '../action_list.js';
import { AnchorAlignment, AnchorSide } from '../../dom/anchored_position.js';
import { AnchoredOverlay } from '../anchored_overlay.js';
import { SymbolIcon } from '../symbol_icon.js';

const MoreIcon = SymbolIcon('kebab_horizontal');
const ProjectionIcon = SymbolIcon('columns_16');

/// The projection of the columns of a result in its script: the new text of the script, or why it cannot get one
export type ResultProjection = { text: string } | { error: string };

export interface QueryResultActionMenuProps {
    /// Does the query have a result? The menu stays closed without one.
    hasResult: boolean;
    /// The projection of the columns of the result in its script, asked when the menu opens. Null when the host cannot
    /// tell, e.g. while the script is gone.
    projectColumns: () => ResultProjection | null;
    /// Stage the new text of the script
    applyProjection: (text: string) => void;
}

/// The actions of a query result that rewrite the script of the result
export function QueryResultActionMenu(props: QueryResultActionMenuProps): React.ReactElement {
    const [open, setOpen] = React.useState(false);
    // The rewrite is computed when the menu opens, the item says why a script cannot get it
    const [projection, setProjection] = React.useState<ResultProjection | null>(null);
    const triggerRef = React.useRef<HTMLButtonElement>(null);

    const openMenu = () => {
        setProjection(null);
        setOpen(true);
        setProjection(props.projectColumns());
    };
    const applyProjection = () => {
        setOpen(false);
        if (projection == null || !('text' in projection)) return;
        props.applyProjection(projection.text);
    };
    const projectionText = projection != null && 'text' in projection ? projection.text : null;
    const projectionError = projection != null && 'error' in projection ? projection.error : null;

    return (
        <AnchoredOverlay
            open={open}
            onOpen={openMenu}
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
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    aria-label="More actions for the query result"
                    data-testid="query-result-more-actions"
                    disabled={!props.hasResult}
                >
                    <MoreIcon size={16} />
                </IconButton>
            )}
        >
            <div className={styles.menu} role="dialog" aria-label="Query result actions">
                <ActionList.List aria-label="Query result actions">
                    <ActionList.ListItem
                        data-testid="query-result-project-columns"
                        disabled={projectionText == null}
                        onClick={applyProjection}
                    >
                        <ActionList.Leading><ProjectionIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>
                            <ActionList.ItemTextTitle>Project Columns</ActionList.ItemTextTitle>
                            {projectionError != null ? <ActionList.ItemTextDescription>{projectionError}</ActionList.ItemTextDescription> : undefined}
                        </ActionList.ItemText>
                    </ActionList.ListItem>
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
}
