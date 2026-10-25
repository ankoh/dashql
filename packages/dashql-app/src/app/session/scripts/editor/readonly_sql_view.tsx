import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';

import { EditorView } from '@codemirror/view';

import { CodeMirror, createReadonlyCodeMirrorExtensions } from './codemirror.js';
import { DashQLUpdateEffect } from './dashql_processor.js';
import { useDashQLCoreSetup } from '../../../providers/core_provider.js';
import { formatSqlText } from '../../ui/script_format.js';

/// Analyze a SQL text in a throwaway script session, the result highlights the text in a read-only view
export function projectSqlText(
    core: dashql.DashQL,
    catalog: dashql.DashQLCatalog,
    text: string,
): dashql.buffers.editor.EditorUpdateT {
    const session = core.createScriptSession(catalog);
    try {
        session.replaceText(0n, text);
        return session.analyze();
    } finally {
        session.destroy();
    }
}

/// A SQL text with the analysis that highlights it
export interface ProjectedSqlText {
    /// The text, formatted if a formatting was requested and the formatter can format all of it
    text: string;
    /// The analysis of the text, null until the core is set up
    editorUpdate: dashql.buffers.editor.EditorUpdateT | null;
}

/// Format and analyze a SQL text against an empty catalog once the core is set up
export function useProjectedSqlText(
    text: string,
    context: string,
    format: dashql.buffers.formatting.FormattingConfigT | null = null,
): ProjectedSqlText {
    const coreSetup = useDashQLCoreSetup();
    const [core, setCore] = React.useState<dashql.DashQL | null>(null);
    React.useEffect(() => {
        if (coreSetup == null) return;
        let cancelled = false;
        coreSetup(context).then(c => {
            if (!cancelled) setCore(c);
        });
        return () => { cancelled = true; };
    }, [coreSetup, context]);
    return React.useMemo(() => {
        if (core == null) return { text, editorUpdate: null };
        const formatted = format == null ? text : formatSqlText(core, text, format) ?? text;
        const catalog = core.createCatalog();
        try {
            return { text: formatted, editorUpdate: projectSqlText(core, catalog, formatted) };
        } catch {
            return { text: formatted, editorUpdate: null };
        } finally {
            catalog.ptr.destroy();
        }
    }, [core, text, format]);
}

export interface ReadonlySqlViewProps {
    /// The SQL text
    text: string;
    /// The analysis of the text that highlights it, null for plain text
    editorUpdate: dashql.buffers.editor.EditorUpdateT | null;
    /// Wrap long lines instead of scrolling horizontally
    lineWrapping?: boolean;
    /// Grow with the text instead of filling the container
    autoHeight?: boolean;
    /// Called with the view once it is created and whenever its size or font metrics change, e.g. to fit a text to its width
    onResize?: (view: EditorView) => void;
}

/// A read-only CodeMirror view of a SQL text, highlighted by DashQL
export function ReadonlySqlView(props: ReadonlySqlViewProps) {
    const [view, setView] = React.useState<EditorView | null>(null);
    const onResize = React.useRef(props.onResize);
    React.useLayoutEffect(() => { onResize.current = props.onResize; });
    const extensions = React.useMemo(() => {
        const base = createReadonlyCodeMirrorExtensions();
        // CodeMirror reports changes of the size and of the character width, e.g. once the font loaded
        const geometry = EditorView.updateListener.of(update => {
            if (update.geometryChanged) onResize.current?.(update.view);
        });
        return props.lineWrapping ? [...base, EditorView.lineWrapping, geometry] : [...base, geometry];
    }, [props.lineWrapping]);

    React.useEffect(() => {
        if (view != null) onResize.current?.(view);
    }, [view]);

    React.useEffect(() => {
        if (view == null) return;
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: props.text },
            effects: props.editorUpdate == null ? [] : [
                DashQLUpdateEffect.of({
                    scriptKey: 0,
                    scriptSession: null,
                    editorUpdate: props.editorUpdate,
                    scriptBuffers: null,
                    scriptCompletion: null,
                    scriptPendingDiff: null,
                    derivedFocus: null,
                    onUpdate: () => { },
                }),
            ],
        });
    }, [view, props.text, props.editorUpdate]);

    return <CodeMirror ref={setView} extensions={extensions} style={props.autoHeight ? { height: 'auto' } : undefined} />;
}
