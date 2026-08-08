import { EditorState, Extension, Prec, StateEffect, StateField, Transaction } from '@codemirror/state';
import { EditorView, keymap, showTooltip, Tooltip } from '@codemirror/view';

import { listShellCommandCompletions, ShellCommandCompletion } from './notebook_shell_commands.js';
import * as styles from '../../editor/dashql_completion_list.module.css';

interface ShellCompletionState {
    from: number;
    to: number;
    candidates: readonly ShellCommandCompletion[];
    selected: number;
}

const SelectNextShellCompletion = StateEffect.define<-1 | 1>();
const CloseShellCompletion = StateEffect.define<null>();

export function deriveShellCommandCompletion(
    state: EditorState,
    previous: ShellCompletionState | null = null,
): ShellCompletionState | null {
    const selection = state.selection.main;
    if (!selection.empty || selection.head !== state.doc.length || state.doc.lines !== 1) return null;

    const text = state.doc.toString();
    const leadingWhitespace = text.length - text.trimStart().length;
    const input = text.slice(leadingWhitespace);
    if (!input.startsWith('.')) return null;

    const normalized = input.toLowerCase();
    const candidates = listShellCommandCompletions().filter(candidate =>
        candidate.label.toLowerCase().startsWith(normalized),
    );
    if (candidates.length === 0) return null;
    if (candidates.length === 1 && candidates[0].label.toLowerCase() === normalized) return null;

    const previousLabel = previous?.candidates[previous.selected]?.label;
    const selected = Math.max(0, candidates.findIndex(candidate => candidate.label === previousLabel));
    return { from: leadingWhitespace, to: selection.head, candidates, selected };
}

function applySelectedShellCompletion(view: EditorView): boolean {
    const completion = view.state.field(ShellCommandCompletionField, false);
    if (completion == null) return false;
    const candidate = completion.candidates[completion.selected];
    if (candidate == null) return false;

    view.dispatch({
        changes: { from: completion.from, to: completion.to, insert: candidate.label },
        selection: { anchor: completion.from + candidate.label.length },
        userEvent: 'input.complete',
    });
    return true;
}

function moveShellCompletion(view: EditorView, direction: -1 | 1): boolean {
    if (view.state.field(ShellCommandCompletionField, false) == null) return false;
    view.dispatch({ effects: SelectNextShellCompletion.of(direction) });
    return true;
}

function closeShellCompletion(view: EditorView): boolean {
    if (view.state.field(ShellCommandCompletionField, false) == null) return false;
    view.dispatch({ effects: CloseShellCompletion.of(null) });
    return true;
}

function createShellCompletionTooltip(completion: ShellCompletionState): Tooltip {
    return {
        pos: completion.from,
        end: completion.to,
        create: view => {
            const dom = document.createElement('div');
            dom.className = styles.overlay_container;
            dom.setAttribute('role', 'listbox');
            dom.setAttribute('aria-label', 'Shell commands');

            const list = document.createElement('div');
            list.className = styles.list_container;

            completion.candidates.forEach((candidate, index) => {
                const option = document.createElement('div');
                option.className = index === completion.selected
                    ? `${styles.candidate_container} ${styles.selected}`
                    : styles.candidate_container;
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', String(index === completion.selected));

                const icon = document.createElement('span');
                icon.className = styles.candidate_icon;
                icon.textContent = 'CMD';
                const label = document.createElement('span');
                label.className = styles.candidate_name;
                label.textContent = candidate.label;
                option.append(icon, label);
                option.addEventListener('mousedown', event => {
                    event.preventDefault();
                    view.dispatch({
                        changes: { from: completion.from, to: completion.to, insert: candidate.label },
                        selection: { anchor: completion.from + candidate.label.length },
                        userEvent: 'input.complete',
                    });
                    view.focus();
                });
                list.appendChild(option);
            });
            dom.appendChild(list);
            return { dom };
        },
    };
}

export const ShellCommandCompletionField = StateField.define<ShellCompletionState | null>({
    create: state => deriveShellCommandCompletion(state),
    update: (previous, transaction: Transaction) => {
        for (const effect of transaction.effects) {
            if (effect.is(CloseShellCompletion)) return null;
            if (effect.is(SelectNextShellCompletion) && previous != null) {
                const selected = (previous.selected + effect.value + previous.candidates.length)
                    % previous.candidates.length;
                return { ...previous, selected };
            }
        }
        if (!transaction.docChanged && !transaction.selection) return previous;
        return deriveShellCommandCompletion(transaction.state, previous);
    },
    provide: field => showTooltip.computeN([field], state => {
        const completion = state.field(field);
        return completion == null ? [] : [createShellCompletionTooltip(completion)];
    }),
});

export const ShellCommandCompletionExtension: Extension = [
    ShellCommandCompletionField,
    Prec.highest(keymap.of([
        { key: 'Enter', run: applySelectedShellCompletion },
        { key: 'Tab', run: applySelectedShellCompletion },
        { key: 'ArrowDown', run: view => moveShellCompletion(view, 1) },
        { key: 'ArrowUp', run: view => moveShellCompletion(view, -1) },
        { key: 'Escape', run: closeShellCompletion },
    ])),
];
