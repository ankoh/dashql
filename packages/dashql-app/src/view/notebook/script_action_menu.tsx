import * as React from 'react';

import type { EditorView } from '@codemirror/view';

import { inlineAllScriptReferences } from '../editor/dashql_code_actions.js';
import { DashQLProcessorPlugin } from '../editor/dashql_processor.js';
import * as ActionList from '../foundations/action_list.js';
import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { ButtonSize, ButtonVariant, IconButton } from '../foundations/button.js';
import { OverlaySize } from '../foundations/overlay.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';

import * as styles from './script_action_menu.module.css';

interface ScriptActionMenuProps {
    editorView?: EditorView | null;
    onInlineScriptRefs?: () => void;
}

export const ScriptActionMenu: React.FC<ScriptActionMenuProps> = ({ editorView = null, onInlineScriptRefs }) => {
    const [open, setOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const MoreIcon = SymbolIcon('kebab_horizontal');

    const inlineScriptRefs = React.useCallback(() => {
        if (onInlineScriptRefs) {
            onInlineScriptRefs();
        } else if (editorView) {
            const state = editorView.state.field(DashQLProcessorPlugin);
            const rewritten = inlineAllScriptReferences(state);
            if (rewritten == null) return;
            editorView.dispatch({
                changes: { from: 0, to: editorView.state.doc.length, insert: rewritten },
                userEvent: 'input.code-action.inline-script-refs',
            });
            editorView.focus();
        } else {
            return;
        }
        setOpen(false);
    }, [editorView, onInlineScriptRefs]);

    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            renderAnchor={(anchorProps) => (
                <IconButton
                    {...anchorProps}
                    ref={triggerRef}
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    aria-label="Open code actions"
                >
                    <MoreIcon size={16} />
                </IconButton>
            )}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            anchorOffset={8}
            width={OverlaySize.S}
            focusZoneSettings={{ disabled: true }}
            overlayProps={{ preventFocusOnOpen: false }}
        >
            <div className={styles.overlay} role="dialog" aria-label="Code actions">
                <ActionList.List aria-label="Code actions">
                    <ActionList.ListItem onClick={inlineScriptRefs} disabled={!editorView && !onInlineScriptRefs}>
                        <ActionList.ItemText>Inline script refs</ActionList.ItemText>
                    </ActionList.ListItem>
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
};
