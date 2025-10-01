import { EditorView, keymap } from '@codemirror/view';

export const COMPLETION_KEYMAP = [
    {
        key: 'Tab',

        // We use tab to complete the extended completion templates.
        // This mimics the new LLM-based IDES where ENTER completes the "immediate" candidate, and tab complets accepts the advanced suggestion
        run: (view: EditorView): boolean => {
            return false;
        }
    },
];


export const DashQLCompletionKeymapPlugin = [
    keymap.of(COMPLETION_KEYMAP)
];
