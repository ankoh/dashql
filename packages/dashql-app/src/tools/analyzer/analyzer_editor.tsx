import * as React from 'react';
import * as dashql from '@akohn/dashql';

import { EditorView } from '@codemirror/view';

import { CodeMirror } from '../../workbook/editor/codemirror.js';
import { DashQLUpdateEffect } from '../../workbook/editor/dashql_processor.js';
import type { DashQLProcessorUpdateOut } from '../../workbook/editor/completion/dashql_completion_state.js';
import * as editorStyles from '../../workbook/scripts/script_editor.module.css';

export interface AnalyzerEditorProps {
    /// The session of the script, the editor's own: the events of the editor go to it directly
    session: dashql.DashQLScriptSession;
    /// Called after every update of the session that carries a new analysis
    onAnalysis: () => void;
    /// Called with the view once it is created, and with null when it goes
    onView?: (view: EditorView | null) => void;
}

/// The editor of a script of the analyzer tool: the editor of a feed entry on a script session of its own, with the
/// highlighting, the completion and the diagnostics of the core
export function AnalyzerEditor({ session, onAnalysis, onView }: AnalyzerEditorProps) {
    const [view, setView] = React.useState<EditorView | null>(null);
    React.useEffect(() => {
        if (view == null) return;
        onView?.(view);
        return () => onView?.(null);
    }, [view, onView]);
    const analysis = React.useRef(onAnalysis);
    React.useLayoutEffect(() => { analysis.current = onAnalysis; });

    // Bind the session, the layout effect binds before the page paints the analysis
    React.useLayoutEffect(() => {
        if (view == null) return;
        if (session.getText() !== view.state.doc.toString()) {
            session.replaceText(session.getTextVersion(), view.state.doc.toString());
        }
        let last: dashql.buffers.editor.EditorUpdateT | null = null;
        const onUpdate = (out: DashQLProcessorUpdateOut) => {
            const update = out.editorUpdate;
            // A cursor move keeps the update of the last analysis
            if (update == null || update === last || !update.analysisUpdated) return;
            last = update;
            analysis.current();
        };
        last = session.analyze();
        view.dispatch({
            effects: DashQLUpdateEffect.of({
                scriptKey: session.getCatalogEntryId(),
                scriptSession: session,
                editorUpdate: last,
                scriptBuffers: null,
                scriptCompletion: null,
                scriptPendingDiff: null,
                onUpdate,
            }),
        });
        analysis.current();
    }, [view, session]);

    // The view reads the document only when it mounts
    const initialDoc = React.useMemo(() => session.getText(), [session]);
    return (
        <div className={editorStyles.auto_height_editor}>
            <CodeMirror ref={setView} initialDoc={initialDoc} style={{ height: 'auto' }} />
        </div>
    );
}
