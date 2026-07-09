import { Prec } from '@codemirror/state';
import { EditorView, keymap, KeyBinding, Panel, showPanel } from '@codemirror/view';

import { DashQLDiffAcceptEffect, DashQLDiffRejectEffect, DashQLProcessorPlugin } from './dashql_processor.js';

import './dashql_diff_hint.css';

/// Accept the pending diff: keep the current (new) text and clear the overlay.
export function acceptPendingDiff(view: EditorView): boolean {
    const processor = view.state.field(DashQLProcessorPlugin);
    if (processor.scriptPendingDiff == null) {
        return false;
    }
    view.dispatch({ effects: DashQLDiffAcceptEffect.of(null) });
    return true;
}

/// Reject the pending diff: restore the prior text verbatim and clear the overlay.
export function rejectPendingDiff(view: EditorView): boolean {
    const processor = view.state.field(DashQLProcessorPlugin);
    const pending = processor.scriptPendingDiff;
    if (pending == null) {
        return false;
    }
    // Restore the prior text in the same transaction that clears the overlay. The processor's
    // docChanged branch mirrors the restore to the WASM rope; `updateDiff` sees the reject effect
    // and clears the pending diff before the auto-accept check can fire.
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: pending.priorText },
        effects: DashQLDiffRejectEffect.of(null),
    });
    return true;
}

/// Build the floating Accept / Reject panel shown while a pending diff exists.
function createDiffPanel(view: EditorView): Panel {
    const dom = document.createElement('div');
    dom.className = 'dashql-diff-hint';

    const label = document.createElement('span');
    label.className = 'dashql-diff-hint-label';
    label.textContent = 'Suggested rewrite';
    dom.appendChild(label);

    const accept = document.createElement('button');
    accept.className = 'dashql-diff-hint-accept';
    accept.type = 'button';
    accept.textContent = 'Accept ⏎';
    accept.onmousedown = (e) => {
        // Keep editor focus so the accept doesn't blur-then-fire another transaction.
        e.preventDefault();
    };
    accept.onclick = () => acceptPendingDiff(view);
    dom.appendChild(accept);

    const reject = document.createElement('button');
    reject.className = 'dashql-diff-hint-reject';
    reject.type = 'button';
    reject.textContent = 'Reject ⎋';
    reject.onmousedown = (e) => {
        e.preventDefault();
    };
    reject.onclick = () => rejectPendingDiff(view);
    dom.appendChild(reject);

    return { dom, top: false };
}

/// Show the Accept / Reject panel only while a pending diff exists.
const DiffHintPanel = showPanel.from(DashQLProcessorPlugin, state =>
    state.scriptPendingDiff != null ? createDiffPanel : null,
);

/// Enter accepts, Escape rejects. Both no-op (return false, letting the key fall through) when no
/// diff is pending, and defer to an active completion via lower precedence than the completion
/// keymap (which is registered at Prec.highest).
const KEYBINDINGS: KeyBinding[] = [
    { key: 'Enter', run: acceptPendingDiff },
    { key: 'Escape', run: rejectPendingDiff },
];

export const DashQLDiffHintPlugin = [
    DiffHintPanel,
    Prec.high(keymap.of(KEYBINDINGS)),
];
