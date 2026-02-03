import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import * as styles from './prompt_demo.module.css';

import symbols from '../../../static/svg/symbols.generated.svg';

import { EditorState, Extension, StateEffect } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

import { useDashQLCoreSetup } from '../../core_provider.js';
import { useLogger } from '../../platform/logger_provider.js';
import { DashQLExtensions } from '../editor/dashql_extension.js';
import { DashQLUpdateEffect, DashQLProcessorUpdateOut, analyzeScript } from '../editor/dashql_processor.js';
import * as themes from '../editor/themes/index.js';

const LOG_CTX = "prompt_demo";

/// Create CodeMirror extensions for the prompt editor
/// This is a minimal setup without line numbers and gutters
function createPromptExtensions(): Extension[] {
    const keymapExtension = keymap.of([
        ...defaultKeymap,
        ...historyKeymap
    ]);
    const extensions: Extension[] = [
        themes.xcode.xcodeLight,
        history(),
        ...DashQLExtensions,
        keymapExtension,
        placeholder("select * from orders order by timestamp desc limit 10"),
        // Auto-height: let the content determine the height
        EditorView.theme({
            "&": {
                minHeight: "24px",
            },
            ".cm-scroller": {
                overflow: "visible",
            },
            ".cm-content": {
                minHeight: "24px",
                padding: "0",
            },
            ".cm-line": {
                padding: "0",
            },
        }),
    ];
    return extensions;
}

interface PromptEditorProps {
    className?: string;
    onSubmit?: (text: string) => void;
}

/// A minimal prompt editor backed by CodeMirror and wired with dashql-core
const PromptEditor: React.FC<PromptEditorProps> = (props) => {
    const logger = useLogger();
    const setupCore = useDashQLCoreSetup();

    // Core instance and script registry
    const [core, setCore] = React.useState<dashql.DashQL | null>(null);
    const [catalog, setCatalog] = React.useState<dashql.DashQLCatalog | null>(null);
    const [registry, setRegistry] = React.useState<dashql.DashQLScriptRegistry | null>(null);
    const [script, setScript] = React.useState<dashql.DashQLScript | null>(null);

    // Editor DOM node and view
    const [editorNode, setEditorNode] = React.useState<HTMLDivElement | null>(null);
    const [editorView, setEditorView] = React.useState<EditorView | null>(null);

    // Initialize dashql-core
    React.useEffect(() => {
        const init = async () => {
            try {
                const instance = await setupCore(LOG_CTX);
                const cat = instance.createCatalog();
                const reg = instance.createScriptRegistry();
                const scr = instance.createScript(cat, 0);
                setCore(instance);
                setCatalog(cat);
                setRegistry(reg);
                setScript(scr);
                logger.info("prompt editor initialized", {}, LOG_CTX);
            } catch (e) {
                logger.error("failed to initialize prompt editor", { error: String(e) }, LOG_CTX);
            }
        };
        init();
        // Cleanup on unmount
        return () => {
            if (script) script.destroy();
            if (registry) registry.destroy();
            if (catalog) catalog.destroy();
        };
    }, []);

    // Create CodeMirror view when DOM node is mounted
    React.useEffect(() => {
        if (editorNode == null) {
            return;
        }
        logger.info("creating prompt editor view", {}, LOG_CTX);

        const extensions = createPromptExtensions();
        const view = new EditorView({
            state: EditorState.create({ extensions }),
            parent: editorNode,
        });
        setEditorView(view);

        return () => {
            view.destroy();
            setEditorView(null);
        };
    }, [editorNode]);

    // Wire CodeMirror with dashql-core when both are ready
    React.useEffect(() => {
        if (editorView == null || script == null || registry == null) {
            return;
        }

        // Helper to handle processor updates
        const onUpdate = (update: DashQLProcessorUpdateOut) => {
            // Here you could track the processed state
            logger.debug("processor update", {
                scriptKey: String(update.scriptKey),
                hasBuffers: String(update.scriptBuffers != null),
            }, LOG_CTX);
        };

        // Initial setup: push the script into the processor
        const initialBuffers = analyzeScript(script);
        const effects: StateEffect<any>[] = [
            DashQLUpdateEffect.of({
                config: {},
                scriptRegistry: registry,
                scriptKey: 0,
                script: script,
                scriptBuffers: initialBuffers,
                scriptCursor: null,
                scriptCompletion: null,
                derivedFocus: null,
                onUpdate,
            }),
        ];
        editorView.dispatch({ effects });

    }, [editorView, script, registry]);

    // Handle Cmd/Ctrl+Enter to submit
    React.useEffect(() => {
        if (editorView == null || props.onSubmit == null) {
            return;
        }

        const submitKeymap = keymap.of([{
            key: "Mod-Enter",
            run: () => {
                const text = editorView.state.doc.toString();
                if (text.trim()) {
                    props.onSubmit?.(text);
                }
                return true;
            },
        }]);

        // Add the keymap extension
        editorView.dispatch({
            effects: StateEffect.appendConfig.of(submitKeymap),
        });
    }, [editorView, props.onSubmit]);

    return (
        <div className={`${styles.prompt_editor} ${props.className ?? ''}`}>
            <div className={styles.prompt_editor_content} ref={setEditorNode} />
        </div>
    );
};

export function PromptDemoPage(): React.ReactElement {
    const logger = useLogger();

    const handleSubmit = React.useCallback((text: string) => {
        logger.info("prompt submitted", { text }, LOG_CTX);
        console.log("Submitted:", text);
    }, [logger]);

    return (
        <div className={styles.root}>
            <div className={styles.prompt_logo}>
                <svg width="100%" height="100%">
                    <use xlinkHref={`${symbols}#dashql`} />
                </svg>
            </div>
            <div className={styles.prompt_container}>
                <PromptEditor onSubmit={handleSubmit} />
                <div className={styles.prompt_hint}>
                    Press <kbd>⌘</kbd> + <kbd>Enter</kbd> to submit
                </div>
            </div>
        </div>
    );
}
