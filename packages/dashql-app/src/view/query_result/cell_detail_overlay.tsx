import * as React from 'react';
import * as styles from './cell_detail_overlay.module.css';
import * as dashql from '../../core/index.js';

import { EditorView } from '@codemirror/view';
import { XIcon, ChevronUpIcon, ChevronDownIcon } from '@primer/octicons-react';

import { IconButton, ButtonVariant } from '../foundations/button.js';
import { SegmentedControl, SegmentedControlSize } from '../foundations/segmented_control.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { JsonView } from '../json/json_view.js';
import { CodeMirror, createReadonlyCodeMirrorExtensions } from '../editor/codemirror.js';
import { DashQLUpdateEffect, DashQLScriptBuffers, analyzeScript } from '../editor/dashql_processor.js';
import { Overlay, OverlaySize } from '../foundations/overlay.js';
import { useDashQLCoreSetup } from '../../core_provider.js';

enum FormatMode {
    Raw = 0,
    JSON = 1,
    SQL = 2,
    Plan = 3,
}

const FORMAT_LABELS: Record<FormatMode, string> = {
    [FormatMode.Raw]: 'Raw',
    [FormatMode.JSON]: 'JSON',
    [FormatMode.SQL]: 'SQL',
    [FormatMode.Plan]: 'Plan',
};

interface DetectedFormats {
    json: object | null;
    sql: {
        originalText: string;
        originalScript: dashql.DashQLScript;
        formattedText: string | null;
        formattedScript: dashql.DashQLScript | null;
        catalog: dashql.DashQLCatalog;
        hasErrors: boolean;
    } | null;
}

function detectFormats(core: dashql.DashQL | null, value: string | null): DetectedFormats {
    const result: DetectedFormats = { json: null, sql: null };
    if (value == null) return result;

    try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'object' && parsed !== null) {
            result.json = parsed;
        }
    } catch {
        // Not JSON
    }

    if (core != null) {
        let catalog: dashql.DashQLCatalog | null = null;
        let script: dashql.DashQLScript | null = null;
        let formattedScript: dashql.DashQLScript | null = null;
        try {
            catalog = core.createCatalog();
            script = core.createScript(catalog);
            script.insertTextAt(0, value);
            script.parse();
            const parsed = script.getParsed();
            const hasErrors = parsed != null && (parsed.read().scannerErrorsLength() > 0 || parsed.read().parserErrorsLength() > 0);
            parsed?.destroy();
            let formattedText: string | null = null;
            try {
                const config = new dashql.buffers.formatting.FormattingConfigT(
                    dashql.buffers.formatting.FormattingDialect.DUCKDB,
                    dashql.buffers.formatting.FormattingMode.PRETTY,
                    80,
                    4,
                );
                formattedScript = script.format(config, null);
                formattedScript.parse();
                formattedText = formattedScript.toString();
            } catch {
                // Format failed, but parse succeeded
            }
            result.sql = { originalText: value, originalScript: script, formattedText, formattedScript, catalog, hasErrors };
            return result;
        } catch {
            // Not valid SQL — destroy everything
            formattedScript?.ptr.destroy();
            script?.ptr.destroy();
            catalog?.ptr.destroy();
        }
    }

    return result;
}

function destroyFormats(formats: DetectedFormats) {
    if (formats.sql != null) {
        formats.sql.formattedScript?.ptr.destroy();
        formats.sql.originalScript.ptr.destroy();
        formats.sql.catalog.ptr.destroy();
    }
}

function pickDefaultMode(formats: DetectedFormats): FormatMode {
    if (formats.sql != null && !formats.sql.hasErrors) return FormatMode.SQL;
    if (formats.json != null) return FormatMode.JSON;
    return FormatMode.Raw;
}

function getAvailableModes(formats: DetectedFormats): FormatMode[] {
    const modes: FormatMode[] = [FormatMode.Raw];
    if (formats.json != null) modes.push(FormatMode.JSON);
    if (formats.sql != null) modes.push(FormatMode.SQL);
    return modes;
}

/// Read-only CodeMirror sub-view (no syntax highlighting)
function ReadonlyTextView(props: { text: string }) {
    const [view, setView] = React.useState<EditorView | null>(null);
    const readonlyExtensions = React.useMemo(() => createReadonlyCodeMirrorExtensions(), []);

    React.useEffect(() => {
        if (view == null) return;
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: props.text },
        });
    }, [view, props.text]);

    return (
        <div className={styles.codemirror_container}>
            <CodeMirror ref={setView} extensions={readonlyExtensions} style={{ height: 'auto' }} />
        </div>
    );
}

const PencilAIIcon = SymbolIcon('pencil_ai_16');

interface SqlTextViewProps {
    originalText: string;
    originalScript: dashql.DashQLScript;
    formattedText: string | null;
    formattedScript: dashql.DashQLScript | null;
}

// SQL CodeMirror sub-view (with DashQL syntax highlighting)
function SqlTextView(props: SqlTextViewProps) {
    const [view, setView] = React.useState<EditorView | null>(null);
    const readonlyExtensions = React.useMemo(() => createReadonlyCodeMirrorExtensions(), []);
    const prevBuffersRef = React.useRef<DashQLScriptBuffers | null>(null);
    const [pretty, setPretty] = React.useState(false);

    const activeText = pretty && props.formattedText != null ? props.formattedText : props.originalText;
    const activeScript = pretty && props.formattedScript != null ? props.formattedScript : props.originalScript;

    React.useEffect(() => {
        if (view == null) return;
        const changes = { from: 0, to: view.state.doc.length, insert: activeText };
        if (activeScript != null) {
            const buffers = analyzeScript(activeScript);
            prevBuffersRef.current?.destroy(prevBuffersRef.current);
            prevBuffersRef.current = buffers;
            view.dispatch({
                changes,
                effects: [
                    DashQLUpdateEffect.of({
                        config: {},
                        scriptRegistry: null,
                        scriptKey: activeScript.getCatalogEntryId(),
                        script: activeScript,
                        scriptBuffers: buffers,
                        scriptCursor: null,
                        scriptCompletion: null,
                        derivedFocus: null,
                        onUpdate: () => { },
                    }),
                ],
            });
        } else {
            view.dispatch({ changes });
        }
    }, [view, activeText, activeScript]);

    React.useEffect(() => {
        return () => {
            prevBuffersRef.current?.destroy(prevBuffersRef.current);
            prevBuffersRef.current = null;
        };
    }, []);

    return (
        <div className={styles.codemirror_container}>
            <CodeMirror ref={setView} extensions={readonlyExtensions} style={{ height: 'auto' }} />
            {props.formattedText != null && (
                <div className={styles.pretty_toggle}>
                    <IconButton
                        variant={pretty ? ButtonVariant.Default : ButtonVariant.Invisible}
                        aria-label="Pretty format"
                        onClick={() => setPretty(p => !p)}
                    >
                        <PencilAIIcon />
                    </IconButton>
                </div>
            )}
        </div>
    );
}


export interface CellDetailOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    formattedValue: string | null;
    columnName: string | null;
    dataRow: number;
    maxRow: number;
    onNavigate: (delta: number) => void;
}

/// Public interface
export function CellDetailOverlay(props: CellDetailOverlayProps) {
    if (!props.isOpen) return null;
    return <CellDetailOverlayInner {...props} />;
}


const EMPTY_FORMATS: DetectedFormats = { json: null, sql: null };

/// Inner component — only mounted when overlay is open
function CellDetailOverlayInner(props: CellDetailOverlayProps) {
    const coreSetup = useDashQLCoreSetup();
    const [core, setCore] = React.useState<dashql.DashQL | null>(null);
    const [formats, setFormats] = React.useState<DetectedFormats>(EMPTY_FORMATS);
    const [selectedFormat, setSelectedFormat] = React.useState<FormatMode>(FormatMode.Raw);
    const prevFormatsRef = React.useRef<DetectedFormats | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        coreSetup('cell_detail').then(c => {
            if (!cancelled) setCore(c);
        });
        return () => { cancelled = true; };
    }, [coreSetup]);

    React.useEffect(() => {
        if (prevFormatsRef.current != null) {
            destroyFormats(prevFormatsRef.current);
        }
        const f = detectFormats(core, props.formattedValue);
        prevFormatsRef.current = f;
        setFormats(f);
        setSelectedFormat(pickDefaultMode(f));
    }, [props.formattedValue, core]);

    React.useEffect(() => {
        return () => {
            if (prevFormatsRef.current != null) {
                destroyFormats(prevFormatsRef.current);
                prevFormatsRef.current = null;
            }
        };
    }, []);

    const availableModes = React.useMemo(() => getAvailableModes(formats), [formats]);

    const onSegmentChange = React.useCallback((index: number) => {
        setSelectedFormat(availableModes[index]);
    }, [availableModes]);

    const rawText = props.formattedValue ?? 'NULL';

    return (
        <Overlay
            centered
            onEscape={props.onClose}
            onClickOutside={props.onClose}
            preventFocusOnOpen
            width={OverlaySize.XL}
            maxHeight={OverlaySize.XL}
        >
            <div className={styles.modal}>
                <div className={styles.main}>
                    <div className={styles.header}>
                        <span className={styles.header_title}>
                            <span className={styles.header_title_label}>Data</span>
                            <span className={styles.header_title_bracket}>[</span>
                            <span className={styles.header_title_index}>{props.dataRow}</span>
                            <span className={styles.header_title_bracket}>]</span>
                            <span className={styles.header_title_dot}>.</span>
                            <span className={styles.header_title_field}>{props.columnName ?? 'value'}</span>
                        </span>
                        <div className={styles.header_spacer} />
                        {availableModes.length > 1 && (
                            <SegmentedControl
                                aria-label="Format mode"
                                size={SegmentedControlSize.Small}
                                onChange={onSegmentChange}
                            >
                                {availableModes.map(mode => (
                                    <SegmentedControl.Button
                                        key={mode}
                                        selected={mode === selectedFormat}
                                    >
                                        {FORMAT_LABELS[mode]}
                                    </SegmentedControl.Button>
                                ))}
                            </SegmentedControl>
                        )}
                    </div>
                    <div className={`${styles.body} ${selectedFormat === FormatMode.JSON ? styles.body_padded : ''}`}>
                        {selectedFormat === FormatMode.Raw && (
                            <ReadonlyTextView text={rawText} />
                        )}
                        {selectedFormat === FormatMode.JSON && formats.json != null && (
                            <JsonView
                                value={formats.json}
                                collapsed={2}
                                shortenTextAfterLength={100}
                            />
                        )}
                        {selectedFormat === FormatMode.SQL && formats.sql != null && (
                            <SqlTextView
                                originalText={formats.sql.originalText}
                                originalScript={formats.sql.originalScript}
                                formattedText={formats.sql.formattedText}
                                formattedScript={formats.sql.formattedScript}
                            />
                        )}
                    </div>
                </div>
                <div className={styles.sidebar}>
                    <div className={styles.sidebar_top}>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-label="Close"
                            onClick={props.onClose}
                        >
                            <XIcon />
                        </IconButton>
                    </div>
                    <div className={styles.sidebar_bottom}>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-label="Previous row"
                            onClick={() => props.onNavigate(-1)}
                            disabled={props.dataRow <= 0}
                        >
                            <ChevronUpIcon />
                        </IconButton>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-label="Next row"
                            onClick={() => props.onNavigate(1)}
                            disabled={props.dataRow >= props.maxRow}
                        >
                            <ChevronDownIcon />
                        </IconButton>
                    </div>
                </div>
            </div>
        </Overlay>
    );
}
