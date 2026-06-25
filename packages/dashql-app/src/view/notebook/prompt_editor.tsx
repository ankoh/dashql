import * as React from 'react';
import * as styles from './script_editor.module.css';

import { Extension } from '@codemirror/state';
import { history, historyKeymap } from '@codemirror/commands';
import { EditorView, drawSelection, keymap, placeholder } from '@codemirror/view';

import { CodeMirror } from '../editor/codemirror.js';
import * as themes from '../editor/themes/index.js';

export interface PromptEditorProps {
    className?: string;
    autoHeight?: boolean;
    placeholder?: string;
    /// Text to seed into the editor when it mounts. Lets the parent persist the draft across
    /// remounts (e.g. the SQL/AI Tab toggle, which swaps this editor in and out).
    initialText?: string;
    /// Called on every document change so the parent can persist the draft.
    onChange?: (text: string) => void;
    setView?: (view: EditorView) => void;
}

/// A plain, plugin-free editor for natural-language AI prompts.
///
/// Unlike `ScriptEditor`, this deliberately mounts none of the DashQL extensions: no parser /
/// analyzer mirroring, no SQL autocompletion, no notebook-state wiring. The text is just a
/// prompt — treating it as an isolated editor state means there is no wired state to pollute.
function createPromptEditorExtensions(
    promptText: string | undefined,
    onChangeRef: React.MutableRefObject<((text: string) => void) | undefined>,
): Extension[] {
    const extensions: Extension[] = [
        themes.xcode.xcodeLight,
        EditorView.lineWrapping,
        drawSelection(),
        history(),
        keymap.of(historyKeymap),
        EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                onChangeRef.current?.(update.state.doc.toString());
            }
        }),
    ];
    if (promptText) {
        extensions.push(placeholder(promptText));
    }
    return extensions;
}

export const PromptEditor: React.FC<PromptEditorProps> = (props) => {
    // The change callback flows through a ref so the (build-once) update listener always
    // calls the latest handler without rebuilding the editor.
    const onChangeRef = React.useRef(props.onChange);
    React.useEffect(() => { onChangeRef.current = props.onChange; }, [props.onChange]);

    // The seed text is captured once; the editor is created fresh on each mount, so seeding
    // on view creation restores the persisted draft.
    const initialTextRef = React.useRef(props.initialText);
    const setViewRef = React.useRef(props.setView);
    React.useEffect(() => { setViewRef.current = props.setView; }, [props.setView]);

    // The extension set is fixed for the lifetime of the editor (the placeholder text is
    // effectively constant), so build it once.
    const extensions = React.useMemo(
        () => createPromptEditorExtensions(props.placeholder, onChangeRef),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );
    const [view, setViewState] = React.useState<EditorView | null>(null);

    React.useEffect(() => {
        if (view == null) return;
        // Seed the persisted draft into the freshly created view (cursor lands at the end).
        const initial = initialTextRef.current ?? '';
        if (initial.length > 0) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: initial } });
        }
        setViewRef.current?.(view);
    }, [view]);

    const containerClass = [
        props.autoHeight ? styles.uncommitted_editor : styles.editor,
        styles.prompt_editor,
        props.className,
    ].filter(Boolean).join(' ');

    return (
        <div className={containerClass}>
            <CodeMirror
                ref={setViewState}
                extensions={extensions}
                style={props.autoHeight ? { height: 'auto' } : undefined}
            />
        </div>
    );
};
