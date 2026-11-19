import * as React from 'react';
import * as dashql from '@akohn/dashql';
import * as styles from './cell_detail_overlay.module.css';

import { peekFormat, type CellDetailProps } from '../data_table/data_table.js';
import { XIcon, ChevronUpIcon, ChevronDownIcon, ScreenFullIcon, ScreenNormalIcon, SymbolIcon } from '../symbol_icon.js';
import { ButtonSize, IconButton, ButtonVariant } from '../button.js';
import { SegmentedControl, SegmentedControlSize } from '../segmented_control.js';
import { JsonView } from '../json/json_view.js';
import { Overlay, OverlaySize } from '../overlay.js';
import { CopyToClipboardButton } from '../clipboard.js';
import { useKeyEvents } from '../../dom/key_events.js';
import { detectPlanEngine } from '../../utils/plan_engine.js';

const LOG_CTX = 'cell_detail_overlay';

enum FormatMode {
    Raw = 0,
    Structured = 1,
    SQL = 2,
    Plan = 3,
}

const FORMAT_LABELS: Record<FormatMode, string> = {
    [FormatMode.Raw]: 'Raw',
    [FormatMode.Structured]: 'Structured',
    [FormatMode.SQL]: 'SQL',
    [FormatMode.Plan]: 'Plan',
};

/// A cell value as SQL
export interface SqlText {
    /// Does the text scan or parse with errors?
    hasErrors: boolean;
    /// The pretty-formatted text, null if the formatter failed
    formattedText: string | null;
}

/// Read a cell value as SQL, null if it is none. The host reads it with its core.
export type DetectSql = (text: string) => SqlText | null;

interface DetectedFormats {
    json: object | null;
    sql: (SqlText & { originalText: string }) | null;
    plan: string | null;
}

/// The formats of a cell value: a plan, a JSON document, or SQL if the host can read it
export function detectFormats(value: string | null, detectSql: DetectSql | null): DetectedFormats {
    const result: DetectedFormats = { json: null, sql: null, plan: null };
    if (value == null) return result;

    const peeked = peekFormat(value);
    if (peeked === 'plan') {
        result.plan = value;
    }

    if (peeked === 'plan' || peeked === 'json') {
        try {
            const parsed = JSON.parse(value);
            if (typeof parsed === 'object' && parsed !== null) {
                result.json = parsed;
            }
        } catch {
            // Not JSON
        }
    }

    // JSON is never meaningful SQL, skip scanning, parsing and formatting large documents
    if (detectSql != null && result.json == null) {
        const sql = detectSql(value);
        if (sql != null) result.sql = { ...sql, originalText: value };
    }
    return result;
}

export function detectStructuredFormats(value: object): DetectedFormats {
    return { json: value, sql: null, plan: null };
}

export const STRUCTURED_ARRAY_PAGE_SIZE = 100;

export function structuredValueToText(value: object): string {
    return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? `${item}n` : item, 2);
}

function pickDefaultMode(formats: DetectedFormats): FormatMode {
    if (formats.plan != null) return FormatMode.Plan;
    if (formats.sql != null && !formats.sql.hasErrors) return FormatMode.SQL;
    if (formats.json != null) return FormatMode.Structured;
    return FormatMode.Raw;
}

function getAvailableModes(formats: DetectedFormats): FormatMode[] {
    const modes: FormatMode[] = [FormatMode.Raw];
    if (formats.json != null) modes.push(FormatMode.Structured);
    if (formats.sql != null) modes.push(FormatMode.SQL);
    if (formats.plan != null) modes.push(FormatMode.Plan);
    return modes;
}

/// The views of a cell value that the host renders, e.g. with its editor
export interface CellDetailViews {
    /// A read-only view of the raw text, wrapping long lines and growing with the text
    rawView: (text: string) => React.ReactNode;
    /// A read-only view of a SQL text, highlighted
    sqlView: (text: string) => React.ReactNode;
    /// The profile of a plan of an engine, the fallback when the text is no plan of the engine
    planView: (props: { engine: dashql.buffers.profile.ProfileEngine; planText: string; className: string; fallback: React.ReactNode }) => React.ReactNode;
}

const PencilAIIcon = SymbolIcon('pencil_ai_16');

interface SqlTextViewProps {
    originalText: string;
    formattedText: string | null;
    sqlView: CellDetailViews['sqlView'];
}

// The SQL text, as written or pretty-formatted
function SqlTextView(props: SqlTextViewProps) {
    const [pretty, setPretty] = React.useState(false);

    const activeText = pretty && props.formattedText != null ? props.formattedText : props.originalText;

    return (
        <div className={styles.codemirror_container}>
            {props.sqlView(activeText)}
            {props.formattedText != null && (
                <div className={styles.pretty_toggle}>
                    <IconButton
                        className={styles.pretty_toggle_button}
                        variant={ButtonVariant.Default}
                        aria-label="Pretty format"
                        aria-pressed={pretty}
                        onClick={() => setPretty(p => !p)}
                    >
                        <PencilAIIcon />
                    </IconButton>
                </div>
            )}
        </div>
    );
}

function StructuredValueView(props: { value: object }) {
    return (
        <JsonView
            className={styles.structured_view}
            value={props.value}
            collapsed={2}
            shortenTextAfterLength={100}
            arrayPageSize={STRUCTURED_ARRAY_PAGE_SIZE}
        />
    );
}


/// The overlay is the detail of a cell of the data table
export interface CellDetailOverlayProps extends CellDetailProps, CellDetailViews {
    /// Read a value as SQL, null while the host cannot, e.g. until its core is set up
    detectSql: DetectSql | null;
}

/// The detail of a cell of the data table: its value as raw text, structured, SQL or a plan
export function CellDetailOverlay(props: CellDetailOverlayProps) {
    if (!props.isOpen) return null;
    return <CellDetailOverlayInner {...props} />;
}


const EMPTY_FORMATS: DetectedFormats = { json: null, sql: null, plan: null };

/// Inner component — only mounted when overlay is open
function CellDetailOverlayInner(props: CellDetailOverlayProps) {
    const [formats, setFormats] = React.useState<DetectedFormats>(EMPTY_FORMATS);
    const [selectedFormat, setSelectedFormat] = React.useState<FormatMode>(FormatMode.Raw);
    const [expanded, setExpanded] = React.useState(false);
    const value = props.structuredValue ?? props.formattedValue;
    // The value that the user picked a format for. A value starts with its default format, but the formats are detected
    // again when the host can read SQL, which must not undo a pick.
    const pickedValue = React.useRef<typeof value | undefined>(undefined);

    React.useEffect(() => {
        const f = props.structuredValue == null
            ? detectFormats(props.formattedValue, props.detectSql)
            : detectStructuredFormats(props.structuredValue);
        setFormats(f);
        setSelectedFormat(selected => pickedValue.current === value && getAvailableModes(f).includes(selected)
            ? selected
            : pickDefaultMode(f));
    }, [props.formattedValue, props.structuredValue, props.detectSql]);

    const availableModes = React.useMemo(() => getAvailableModes(formats), [formats]);

    const onSegmentChange = React.useCallback((index: number) => {
        pickedValue.current = value;
        setSelectedFormat(availableModes[index]);
    }, [availableModes, value]);

    useKeyEvents(React.useMemo(() => [
        {
            key: 'ArrowUp',
            callback: (e: KeyboardEvent) => {
                e.preventDefault();
                if (props.dataRow > 0) {
                    props.onNavigate(-1);
                }
            },
        },
        {
            key: 'ArrowDown',
            callback: (e: KeyboardEvent) => {
                e.preventDefault();
                if (props.dataRow < props.maxRow) {
                    props.onNavigate(1);
                }
            },
        },
    ], [props.dataRow, props.maxRow, props.onNavigate]));

    const rawText = React.useMemo(() => props.structuredValue == null
        ? (props.formattedValue ?? 'NULL')
        : structuredValueToText(props.structuredValue), [props.structuredValue, props.formattedValue]);

    return (
        <Overlay
            centered
            onEscape={props.onClose}
            onClickOutside={props.onClose}
            preventFocusOnOpen
            width={OverlaySize.XL}
            maxHeight={OverlaySize.XL}
            expanded={expanded}
        >
            <div className={styles.modal} data-expanded={expanded || undefined}>
                <div className={styles.main}>
                    <div className={styles.header}>
                        <span className={styles.header_title}>
                            <span className={styles.header_title_label}>row</span>
                            <span className={styles.header_title_equal}>=</span>
                            <span className={styles.header_title_index}>{props.dataRow}</span>
                            <span className={styles.header_title_label}>field</span>
                            <span className={styles.header_title_equal}>=</span>
                            <span className={styles.header_title_field}>{props.columnName ?? 'value'}</span>
                        </span>
                        <div className={styles.header_spacer} />
                        <CopyToClipboardButton
                            variant={ButtonVariant.Invisible}
                            size={ButtonSize.Small}
                            value={rawText}
                            logContext={LOG_CTX}
                            aria-label="Copy raw output"
                            aria-labelledby=""
                        />
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
                    <div className={`${styles.body} ${selectedFormat === FormatMode.Structured ? styles.body_padded : ''}`}>
                        {selectedFormat === FormatMode.Raw && (
                            <div className={styles.codemirror_container}>{props.rawView(rawText)}</div>
                        )}
                        {selectedFormat === FormatMode.Structured && formats.json != null && (
                            <StructuredValueView value={formats.json} />
                        )}
                        {selectedFormat === FormatMode.SQL && formats.sql != null && (
                            <SqlTextView
                                originalText={formats.sql.originalText}
                                formattedText={formats.sql.formattedText}
                                sqlView={props.sqlView}
                            />
                        )}
                        {selectedFormat === FormatMode.Plan && formats.plan != null && (
                            props.planView({
                                engine: detectPlanEngine(formats.plan) ?? dashql.buffers.profile.ProfileEngine.HYPER,
                                planText: formats.plan,
                                className: styles.plan_container,
                                fallback: <div className={styles.plan_error}>Could not render plan</div>,
                            })
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
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-label={expanded ? 'Restore size' : 'Expand'}
                            aria-pressed={expanded}
                            onClick={() => setExpanded(e => !e)}
                        >
                            {expanded ? <ScreenNormalIcon /> : <ScreenFullIcon />}
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
