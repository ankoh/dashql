import * as React from 'react';
import * as styles from './sql_key_bar.module.css';

import { runScopeHandlers, type EditorView } from '@codemirror/view';
import { cursorCharLeft, cursorCharRight } from '@codemirror/commands';

import { DashQLCompletionStartEffect } from './dashql_processor.js';

/// The characters of SQL that the letter keyboard of a phone hides on another page
const SYMBOLS = [';', '(', ')', "'", '*', ':', ',', '='];

interface Props {
    /// The editor that the keys type into, null while it mounts
    editor: EditorView | null;
    /// Run the script, without it the bar has no Run
    onRun?: () => void;
    className?: string;
}

/// The keys that the keyboard of a touch screen lacks for SQL, a row above it (docs/design/narrow_layouts.md): Run, Tab
/// (the completion), the symbols of SQL and the arrows that move the cursor. A touch screen only, `pointer: coarse`.
/// A key keeps the focus in the editor, so the keyboard stays open.
export function SqlKeyBar(props: Props): React.ReactElement {
    const { editor } = props;
    const keepFocus = (event: React.PointerEvent) => event.preventDefault();
    const act = (action: (view: EditorView) => void) => () => {
        if (editor == null) return;
        action(editor);
        editor.focus();
    };
    // Tab does what the keymap of the editor does with it, e.g. take the selected completion, otherwise it completes
    const tab = act(view => {
        const handled = runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Tab' }), 'editor');
        if (!handled) view.dispatch({ effects: DashQLCompletionStartEffect.of(null) });
    });
    const insert = (text: string) => act(view => view.dispatch(view.state.replaceSelection(text)));
    return (
        <div className={`${styles.key_bar} ${props.className ?? ''}`} role="toolbar" aria-label="SQL keys" data-testid="sql-key-bar">
            {props.onRun != null && (
                <button type="button" className={styles.run} onPointerDown={keepFocus} onClick={props.onRun} data-testid="sql-key-run">Run</button>
            )}
            <button type="button" onPointerDown={keepFocus} onClick={tab}>Tab</button>
            {SYMBOLS.map(symbol => (
                <button key={symbol} type="button" className={styles.symbol} onPointerDown={keepFocus} onClick={insert(symbol)}
                    aria-label={`Type ${symbol}`} data-testid="sql-key-symbol">{symbol}</button>
            ))}
            <button type="button" onPointerDown={keepFocus} onClick={act(view => cursorCharLeft(view))} aria-label="Cursor left">←</button>
            <button type="button" onPointerDown={keepFocus} onClick={act(view => cursorCharRight(view))} aria-label="Cursor right">→</button>
        </div>
    );
}
