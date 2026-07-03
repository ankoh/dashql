import * as React from 'react';
import * as core from '../../core/index.js';
import * as themes from '../editor/themes/index.js';

import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { useAppConfig } from '../../app_config.js';
import type { ScriptData } from '../../notebook/notebook_state.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { stringifyError } from '../../platform/logger/logger.js';
import { CodeMirror } from '../editor/codemirror.js';
import { DashQLScannerDecorationUpdateEffect, DashQLStandaloneScannerDecorationPlugin } from '../editor/dashql_decorations_standalone.js';

const LOG_CTX = 'script_preview';
const PREVIEW_INDENTATION_WIDTH = 2;
const PREVIEW_MIN_WIDTH_CHARS = 24;

const SCRIPT_PREVIEW_LAYOUT = EditorView.theme({
    '.cm-scroller': {
        overflow: 'hidden',
    },
});

const SCRIPT_PREVIEW_EXTENSIONS: Extension[] = [
    themes.xcode.xcodeLight,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    SCRIPT_PREVIEW_LAYOUT,
    DashQLStandaloneScannerDecorationPlugin,
];

export interface ScriptPreviewProps {
    className?: string;
    scriptData: ScriptData;
    onReady?: (ready: boolean) => void;
}

interface PreviewSnapshot {
    scriptText: string;
    parsed: core.FlatBufferPtr<core.buffers.parser.ParsedScript> | null;
}

/// Helper to read a script text
function readScriptText(script: core.DashQLScript, logger: ReturnType<typeof useLogger>, scriptKey: number, logCtx: string): string | null {
    try {
        return script.toString();
    } catch (e: any) {
        logger.warn('Failed to read script preview text', {
            scriptKey: scriptKey.toString(),
            error: stringifyError(e),
        }, logCtx);
        return null;
    }
}

/// Helper to format a preview script
function formatPreviewScript(
    sourceScript: core.DashQLScript,
    scriptKey: number,
    maxWidth: number,
    debugMode: boolean,
    logger: ReturnType<typeof useLogger>,
): PreviewSnapshot | null {
    const config = new core.buffers.formatting.FormattingConfigT(
        core.buffers.formatting.FormattingDialect.DUCKDB,
        core.buffers.formatting.FormattingMode.COMPACT,
        maxWidth,
        PREVIEW_INDENTATION_WIDTH,
        debugMode,
    );

    let formattedScript: core.DashQLScript;
    try {
        formattedScript = sourceScript.format(config, null, true);
    } catch (e: any) {
        logger.warn('Failed to format script preview, using raw script text', {
            scriptKey: scriptKey.toString(),
            error: stringifyError(e),
            maxWidth: maxWidth.toString(),
        }, LOG_CTX);
        return null;
    }

    try {
        formattedScript.analyze();
        const parsed = formattedScript.getParsed();
        const scriptText = readScriptText(formattedScript, logger, scriptKey, LOG_CTX);
        if (scriptText == null) {
            parsed.destroy();
            return null;
        }
        return { scriptText, parsed };
    } catch (e: any) {
        logger.warn('Failed to analyze formatted script preview', {
            scriptKey: scriptKey.toString(),
            error: stringifyError(e),
            maxWidth: maxWidth.toString(),
        }, LOG_CTX);
        return null;
    } finally {
        formattedScript.destroy();
    }
}

export const ScriptPreview: React.FC<ScriptPreviewProps> = ({ className, scriptData, onReady }) => {
    const config = useAppConfig();
    const logger = useLogger();
    const [view, setView] = React.useState<EditorView | null>(null);
    const [maxWidthChars, setMaxWidthChars] = React.useState<number | null>(null);
    const [previewSnapshot, setPreviewSnapshot] = React.useState<PreviewSnapshot>(() => ({
        scriptText: '',
        parsed: null,
    }));
    const formattingDebugMode = config?.settings?.formattingDebugMode ?? false;

    // Track the number of characters that can fit in the preview editor
    React.useLayoutEffect(() => {
        if (view == null) {
            return;
        }
        let hasMeasured = false;
        const measure = () => {
            const charWidth = view.defaultCharacterWidth;
            const availableWidth = view.scrollDOM.clientWidth;
            if (!(charWidth > 0) || !(availableWidth > 0)) {
                return;
            }
            const nextMaxWidthChars = Math.max(PREVIEW_MIN_WIDTH_CHARS, Math.floor(availableWidth / charWidth));
            setMaxWidthChars(prev => prev === nextMaxWidthChars ? prev : nextMaxWidthChars);
            hasMeasured = true;
        };
        // Don't measure immediately - wait for layout to stabilize
        const resizeObserver = new ResizeObserver(measure);
        resizeObserver.observe(view.scrollDOM);
        // Fallback: measure after a frame if ResizeObserver hasn't fired
        const timeout = setTimeout(() => {
            if (!hasMeasured) {
                measure();
            }
        }, 16);
        return () => {
            resizeObserver.disconnect();
            clearTimeout(timeout);
        };
    }, [view]);

    // Update the preview snapshot when the script or editor dimensions change
    React.useEffect(() => {
        // Don't format until we have measured the actual width
        if (maxWidthChars == null) {
            return;
        }
        const nextFormatted = formatPreviewScript(
            scriptData.script,
            scriptData.scriptKey,
            maxWidthChars,
            formattingDebugMode,
            logger,
        );
        setPreviewSnapshot(nextFormatted ?? {
            scriptText: '',
            parsed: null,
        });
        // Mark as ready after first format attempt (success or failure)
        onReady?.(true);
    }, [
        formattingDebugMode,
        logger,
        maxWidthChars,
        scriptData.script,
        scriptData.scriptKey,
        // Re-analysis produces a fresh `buffers` object even when `script` is mutated in place
        // (e.g. the agent's SET_SCRIPT_TEXT calls `script.replaceText()`, keeping the same JS
        // reference). Depend on it so the preview reformats when the underlying text changes.
        scriptData.scriptAnalysis.buffers,
        onReady,
    ]);

    // Make sure to clean up the parsed script when the component unmounts
    React.useEffect(() => {
        return () => { previewSnapshot.parsed?.destroy(); };
    }, [previewSnapshot.parsed]);

    React.useEffect(() => {
        if (view == null) {
            return;
        }
        view.dispatch({
            changes: {
                from: 0,
                to: view.state.doc.length,
                insert: previewSnapshot.scriptText,
            },
            effects: [
                DashQLScannerDecorationUpdateEffect.of(previewSnapshot.parsed),
            ],
        });
    }, [previewSnapshot, view]);

    return (
        <div className={className}>
            <CodeMirror extensions={SCRIPT_PREVIEW_EXTENSIONS} ref={setView} style={{ height: 'auto' }} />
        </div>
    );
};
