import * as React from 'react';
import * as core from '../../core/index.js';
import * as themes from '../editor/themes/index.js';

import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { useAppConfig } from '../../app_config.js';
import type { ScriptData } from '../../notebook/notebook_state.js';
import { useLogger } from '../../platform/logger_provider.js';
import { CodeMirror } from '../editor/codemirror.js';
import { DashQLScannerDecorationUpdateEffect, DashQLStandaloneScannerDecorationPlugin } from '../editor/dashql_decorations_standalone.js';

const LOG_CTX = 'script_preview';
const PREVIEW_INDENTATION_WIDTH = 2;
const PREVIEW_DEFAULT_MAX_WIDTH_CHARS = 96;
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
}

interface PreviewSnapshot {
    scriptText: string;
    scanned: core.FlatBufferPtr<core.buffers.parser.ScannedScript> | null;
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
        logger.warn('failed to format script preview, using raw script text', {
            scriptKey: scriptKey.toString(),
            error: `${e}`,
            maxWidth: maxWidth.toString(),
        }, LOG_CTX);
        return null;
    }

    try {
        formattedScript.scan();
        const scanned = formattedScript.getScanned();
        const scriptText = readScriptText(formattedScript, logger, scriptKey, LOG_CTX);
        if (scriptText == null) {
            scanned.destroy();
            return null;
        }
        return { scriptText, scanned };
    } catch (e: any) {
        logger.warn('failed to scan formatted script preview', {
            scriptKey: scriptKey.toString(),
            error: `${e}`,
            maxWidth: maxWidth.toString(),
        }, LOG_CTX);
        return null;
    } finally {
        formattedScript.destroy();
    }
}

function readScriptText(script: core.DashQLScript, logger: ReturnType<typeof useLogger>, scriptKey: number, logCtx: string): string | null {
    try {
        return script.toString();
    } catch (e: any) {
        logger.warn('failed to read script preview text', {
            scriptKey: scriptKey.toString(),
            error: `${e}`,
        }, logCtx);
        return null;
    }
}

export const ScriptPreview: React.FC<ScriptPreviewProps> = ({ className, scriptData }) => {
    const config = useAppConfig();
    const logger = useLogger();
    const [view, setView] = React.useState<EditorView | null>(null);
    const [maxWidthChars, setMaxWidthChars] = React.useState(PREVIEW_DEFAULT_MAX_WIDTH_CHARS);
    const [previewSnapshot, setPreviewSnapshot] = React.useState<PreviewSnapshot>(() => ({
        scriptText: readScriptText(scriptData.script, logger, scriptData.scriptKey, LOG_CTX) ?? '',
        scanned: null,
    }));
    const formattingDebugMode = config?.settings?.formattingDebugMode ?? false;

    // Track the number of characters that can fit in the preview editor
    React.useLayoutEffect(() => {
        if (view == null) {
            return;
        }
        const measure = () => {
            const charWidth = view.defaultCharacterWidth;
            const availableWidth = view.scrollDOM.clientWidth;
            if (!(charWidth > 0) || !(availableWidth > 0)) {
                return;
            }
            const nextMaxWidthChars = Math.max(PREVIEW_MIN_WIDTH_CHARS, Math.floor(availableWidth / charWidth));
            setMaxWidthChars(prev => prev === nextMaxWidthChars ? prev : nextMaxWidthChars);
        };
        measure();
        const resizeObserver = new ResizeObserver(measure);
        resizeObserver.observe(view.scrollDOM);
        const frame = requestAnimationFrame(measure);
        return () => {
            cancelAnimationFrame(frame);
            resizeObserver.disconnect();
        };
    }, [view]);

    // Update the preview snapshot when the script or editor dimensions change
    React.useEffect(() => {
        const fallbackText = readScriptText(scriptData.script, logger, scriptData.scriptKey, LOG_CTX) ?? '';
        const nextFormatted = formatPreviewScript(
            scriptData.script,
            scriptData.scriptKey,
            maxWidthChars,
            formattingDebugMode,
            logger,
        );

        setPreviewSnapshot(nextFormatted ?? {
            scriptText: fallbackText,
            scanned: null,
        });
    }, [
        formattingDebugMode,
        logger,
        maxWidthChars,
        scriptData.script,
        scriptData.scriptKey,
    ]);

    // Make sure to clean up the scanned script when the component unmounts
    React.useEffect(() => {
        return () => { previewSnapshot.scanned?.destroy(); };
    }, [previewSnapshot.scanned]);

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
                DashQLScannerDecorationUpdateEffect.of(previewSnapshot.scanned),
            ],
        });
    }, [previewSnapshot, view]);

    return (
        <div className={className}>
            <CodeMirror extensions={SCRIPT_PREVIEW_EXTENSIONS} ref={setView} style={{ height: 'auto' }} />
        </div>
    );
};
