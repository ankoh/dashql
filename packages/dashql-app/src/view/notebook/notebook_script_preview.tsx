import * as React from 'react';
import * as core from '../../core/index.js';
import * as themes from '../editor/themes/index.js';

import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { useAppConfig } from '../../app_config.js';
import type { ScriptData } from '../../notebook/notebook_state.js';
import { useLogger } from '../../platform/logger_provider.js';
import { CodeMirror } from '../editor/codemirror.js';
import { DashQLProcessorPlugin, DashQLUpdateEffect, type DashQLScriptBuffers } from '../editor/dashql_processor.js';
import { DashQLScannerDecorationPlugin } from '../editor/dashql_decorations.js';

const SCRIPT_PREVIEW_EXTENSIONS: Extension[] = [
    themes.monochrome.monochromeLight,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    DashQLProcessorPlugin,
    DashQLScannerDecorationPlugin,
];

export interface ScriptPreviewProps {
    className?: string;
    scriptData: ScriptData;
}

interface FormattedPreview {
    script: core.DashQLScript;
    scanned: core.FlatBufferPtr<core.buffers.parser.ScannedScript> | null;
    parsed: core.FlatBufferPtr<core.buffers.parser.ParsedScript> | null;
}

const LOG_CTX = 'script_preview';
const PREVIEW_INDENTATION_WIDTH = 2;
const PREVIEW_MAX_WIDTH_CHARS = 96;

function destroyFormattedPreview(preview: FormattedPreview | null) {
    if (preview == null) {
        return;
    }
    preview.scanned?.destroy();
    preview.parsed?.destroy();
    preview.script.destroy();
}

function formatPreviewScript(
    sourceScript: core.DashQLScript,
    scriptKey: number,
    maxWidth: number,
    debugMode: boolean,
    logger: ReturnType<typeof useLogger>,
): FormattedPreview | null {
    const config = new core.buffers.formatting.FormattingConfigT(
        core.buffers.formatting.FormattingDialect.DUCKDB,
        core.buffers.formatting.FormattingMode.COMPACT,
        maxWidth,
        PREVIEW_INDENTATION_WIDTH,
        debugMode,
    );

    let formattedScript: core.DashQLScript;
    try {
        formattedScript = sourceScript.format(config);
    } catch (e: any) {
        logger.warn('failed to format script preview, using raw script text', {
            scriptKey: scriptKey.toString(),
            error: `${e}`,
            maxWidth: maxWidth.toString(),
        }, LOG_CTX);
        return null;
    }

    let scanned: core.FlatBufferPtr<core.buffers.parser.ScannedScript> | null = null;
    let parsed: core.FlatBufferPtr<core.buffers.parser.ParsedScript> | null = null;

    try {
        formattedScript.scan();
        scanned = formattedScript.getScanned();
    } catch (_e: any) {
    }
    try {
        formattedScript.parse();
        parsed = formattedScript.getParsed();
    } catch (_e: any) {
    }

    return { script: formattedScript, scanned, parsed };
}

export const ScriptPreview: React.FC<ScriptPreviewProps> = ({ className, scriptData }) => {
    const config = useAppConfig();
    const logger = useLogger();
    const [view, setView] = React.useState<EditorView | null>(null);
    const formattedPreviewRef = React.useRef<FormattedPreview | null>(null);
    const [, setFormattedVersion] = React.useState(0);
    const rawScriptText = scriptData.script.toString();
    const formattingDebugMode = config?.settings?.formattingDebugMode ?? false;

    React.useEffect(() => {
        const nextFormatted = formatPreviewScript(
            scriptData.script,
            scriptData.scriptKey,
            PREVIEW_MAX_WIDTH_CHARS,
            formattingDebugMode,
            logger,
        );
        const prevFormatted = formattedPreviewRef.current;
        if (prevFormatted === nextFormatted || (prevFormatted == null && nextFormatted == null)) {
            return;
        }
        formattedPreviewRef.current = nextFormatted;
        destroyFormattedPreview(prevFormatted);
        setFormattedVersion(version => version + 1);
    }, [formattingDebugMode, logger, rawScriptText, scriptData.script, scriptData.scriptKey]);

    React.useEffect(() => () => {
        destroyFormattedPreview(formattedPreviewRef.current);
        formattedPreviewRef.current = null;
    }, []);

    const formattedPreview = formattedPreviewRef.current;
    const script = formattedPreview?.script ?? scriptData.script;
    const scriptText = script.toString();
    const scriptBuffers = React.useMemo<DashQLScriptBuffers>(() => ({
        scanned: formattedPreview?.scanned ?? scriptData.scriptAnalysis.buffers.scanned,
        parsed: formattedPreview?.parsed ?? scriptData.scriptAnalysis.buffers.parsed,
        analyzed: null,
        destroy: () => { },
    }), [
        formattedPreview?.parsed,
        formattedPreview?.scanned,
        scriptData.scriptAnalysis.buffers.parsed,
        scriptData.scriptAnalysis.buffers.scanned,
    ]);

    React.useEffect(() => {
        if (view == null) {
            return;
        }
        const state = view.state.field(DashQLProcessorPlugin);
        if (state.script !== script) {
            view.setState(EditorState.create({
                extensions: SCRIPT_PREVIEW_EXTENSIONS,
            }));
        }
        view.dispatch({
            changes: {
                from: 0,
                to: view.state.doc.length,
                insert: scriptText,
            },
            effects: [
                DashQLUpdateEffect.of({
                    config: {},
                    scriptRegistry: null,
                    scriptKey: scriptData.scriptKey,
                    script,
                    scriptBuffers,
                    scriptCursor: null,
                    scriptCompletion: null,
                    derivedFocus: null,
                    onUpdate: () => { },
                }),
            ],
        });
    }, [view, scriptData.scriptKey, script, scriptText, scriptBuffers]);

    return (
        <div className={className}>
            <CodeMirror extensions={SCRIPT_PREVIEW_EXTENSIONS} ref={setView} style={{ height: 'auto' }} />
        </div>
    );
};
