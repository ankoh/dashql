import * as React from 'react';
import * as themes from '../../scripts/editor/themes/index.js';

import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { type Extension } from '@codemirror/state';
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view';

import { CodeMirror } from '../../scripts/editor/codemirror.js';
import type { ChartSpec } from './chart_spec_paths.js';
import * as styles from './chart_builder.module.css';

/// Parse the text of the editor, a spec must be a JSON object
export function parseChartSpec(text: string): { spec: ChartSpec } | { error: string } {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        return { error: 'The Vega-Lite spec must be a JSON object' };
    }
    return { spec: value as ChartSpec };
}

interface Props {
    /// The spec when the editor opens. The editor owns its text afterwards.
    initialSpec: ChartSpec;
    /// A valid edit of the spec
    onChange: (spec: ChartSpec) => void;
}

/// The JSON of the chart spec. Every edit that parses to an object updates the chart, others show the parse error.
export function ChartSpecJsonEditor(props: Props): React.ReactElement {
    const [error, setError] = React.useState<string | null>(null);
    const onChangeRef = React.useRef(props.onChange);
    onChangeRef.current = props.onChange;
    const initialDoc = React.useMemo(() => JSON.stringify(props.initialSpec, null, 2), []);

    const extensions = React.useMemo<Extension[]>(() => [
        themes.xcode.xcodeLight,
        json(),
        lineNumbers(),
        foldGutter(),
        bracketMatching(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
        EditorView.contentAttributes.of({ 'aria-label': 'Vega-Lite spec JSON' }),
        EditorView.updateListener.of(update => {
            if (!update.docChanged) return;
            const parsed = parseChartSpec(update.state.doc.toString());
            if ('error' in parsed) {
                setError(parsed.error);
            } else {
                setError(null);
                onChangeRef.current(parsed.spec);
            }
        }),
    ], []);

    return (
        <div className={styles.json_pane}>
            <div className={styles.json_editor} data-testid="chart-json-editor">
                <CodeMirror extensions={extensions} initialDoc={initialDoc} />
            </div>
            {error != null && (
                <div className={styles.json_error} role="alert" data-testid="chart-json-error">{error}</div>
            )}
        </div>
    );
}
