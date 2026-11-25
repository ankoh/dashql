import * as React from 'react';
import * as dashql from '@akohn/dashql';
import * as styles from './script_diagnostics.module.css';

import type { EditorView } from '@codemirror/view';
import { AlertIcon, BracesIcon, XCircleFillIcon, XIcon } from '@akohn/dashql-react/components/symbol_icon';

import type { ScriptData } from '@akohn/dashql/platform/workbook/workbook_scripts';
import type { ScriptReferenceReport } from '@akohn/dashql/platform/workbook/script_reference_check';
import { formattingDialectForConnector, useScriptText } from './script_format.js';
import type { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { Button, ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { JsonView } from '@akohn/dashql-react/components/json/json_view';
import { Overlay, OverlaySize } from '@akohn/dashql-react/components/overlay';
import { revealEditorOffset } from '../editor/dashql_inline_diagnostics.js';

export const SCRIPT_FORMATTING_WARNING = 'This script cannot be formatted';

export interface ScriptDiagnostic {
    severity: 'error' | 'warning';
    message: string;
    /// Where the diagnostic starts in the analyzed text, in UTF-16 code units, null without a place
    offset: number | null;
    details: Record<string, unknown>;
}

function formattingDetails(scriptData: Pick<ScriptData, 'scriptKey' | 'scriptSession'>, connectorType?: ConnectorType): Record<string, unknown> {
    const details: Record<string, unknown> = {
        source: 'formatter',
        severity: 'warning',
        message: SCRIPT_FORMATTING_WARNING,
        scriptKey: scriptData.scriptKey,
    };
    try {
        const dialect = formattingDialectForConnector(connectorType);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dialect,
            dashql.buffers.formatting.FormattingMode.PRETTY,
            80,
            4,
        );
        details.configuration = {
            dialect: dashql.buffers.formatting.FormattingDialect[dialect],
            mode: 'PRETTY',
            maxWidth: 80,
            indentationWidth: 4,
        };
        details.fullyFormattable = scriptData.scriptSession.isFullyFormattable(config, true);
    } catch (error) {
        details.inspectionError = error instanceof Error ? error.message : String(error);
    }
    return details;
}

export function collectScriptDiagnostics(scriptData: Pick<ScriptData, 'scriptKey' | 'scriptSession' | 'editorUpdate'>, isFormattable: boolean,
    connectorType?: ConnectorType, formatting: Record<string, unknown> | null = null,
    references: ScriptReferenceReport | null = null): ScriptDiagnostic[] {
    const diagnostics: ScriptDiagnostic[] = (scriptData.editorUpdate?.diagnostics ?? []).map(diagnostic => {
        const severity = diagnostic.severity === dashql.buffers.editor.EditorDiagnosticSeverity.WARNING
            ? 'warning'
            : 'error';
        const source = dashql.buffers.editor.EditorDiagnosticSource[diagnostic.source].toLowerCase();
        const span = diagnostic.textSpan;
        const textSpan = span == null ? null : {
            offset: Number(span.offset),
            length: Number(span.length),
            end: Number(span.offset + span.length),
        };
        const message = typeof diagnostic.message === 'string' ? diagnostic.message : '';
        return {
            severity,
            message,
            offset: textSpan?.offset ?? null,
            details: { source, severity, message, scriptKey: scriptData.scriptKey, textSpan },
        };
    });

    // The errors of the script references, of the analyzed text
    if (references != null && references.textVersion === scriptData.editorUpdate?.textVersion) {
        for (const mark of references.marks) {
            for (const message of mark.errors) {
                const textSpan = { offset: mark.from, length: mark.to - mark.from, end: mark.to };
                diagnostics.push({
                    severity: 'error',
                    message,
                    offset: mark.from,
                    details: { source: 'script references', severity: 'error', message, scriptKey: scriptData.scriptKey, textSpan },
                });
            }
        }
    }

    if (!isFormattable) {
        diagnostics.push({
            severity: 'warning',
            message: SCRIPT_FORMATTING_WARNING,
            offset: null,
            details: formatting ?? formattingDetails(scriptData, connectorType),
        });
    }
    return diagnostics;
}

/// The count of the diagnostics of a severity, e.g. "2 errors"
export function diagnosticCount(count: number, severity: 'error' | 'warning'): string {
    return `${count} ${severity}${count === 1 ? '' : 's'}`;
}

/// Where a diagnostic is in the text of an editor, e.g. "Ln 3, Col 5". The analysis may lag behind the text, its offset
/// is clamped to the document.
function locationLabel(view: EditorView, offset: number): string {
    const doc = view.state.doc;
    const line = doc.lineAt(Math.max(0, Math.min(offset, doc.length)));
    return `Ln ${line.number}, Col ${Math.min(offset, doc.length) - line.from + 1}`;
}

export const ScriptDiagnosticsButton: React.FC<{
    scriptData: ScriptData;
    isFormattable: boolean;
    connectorType?: ConnectorType;
    /// The size of the icon of the trigger, 16 by default
    iconSize?: number;
    /// The checked script references of the script
    references?: ScriptReferenceReport | null;
    /// The editor of the script. A diagnostic of the list moves its cursor to the diagnostic, without an editor the
    /// list shows its details.
    editorView?: EditorView | null;
}> = ({ scriptData, isFormattable, connectorType, iconSize = 16, references = null, editorView = null }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const [selectedDiagnostic, setSelectedDiagnostic] = React.useState<ScriptDiagnostic | null>(null);
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    // Inspecting the formatter is a full pass over the script, only repeat it when the text changes
    const { scriptKey, scriptSession, editorUpdate } = scriptData;
    const scriptText = useScriptText(scriptData);
    const formatting = React.useMemo(
        () => isFormattable || scriptText == null ? null : formattingDetails({ scriptKey, scriptSession: scriptText.scriptSession }, connectorType),
        [scriptKey, scriptText, isFormattable, connectorType],
    );
    const diagnostics = React.useMemo(
        () => collectScriptDiagnostics({ scriptKey, scriptSession, editorUpdate }, isFormattable, connectorType, formatting, references),
        [scriptKey, scriptSession, editorUpdate, isFormattable, connectorType, formatting, references],
    );
    React.useEffect(() => {
        if (diagnostics.length === 0) {
            if (isOpen) setIsOpen(false);
            if (selectedDiagnostic != null) setSelectedDiagnostic(null);
        }
    }, [diagnostics.length, isOpen, selectedDiagnostic]);
    // A diagnostic picked in the list is revealed once the list closed, the list returns the focus to its trigger and
    // the editor takes it from there
    const [pendingReveal, setPendingReveal] = React.useState<number | null>(null);
    React.useEffect(() => {
        if (pendingReveal == null || isOpen) return;
        setPendingReveal(null);
        if (editorView != null) revealEditorOffset(editorView, pendingReveal);
    }, [pendingReveal, isOpen, editorView]);
    if (diagnostics.length === 0) return null;

    const errorCount = diagnostics.filter(diagnostic => diagnostic.severity === 'error').length;
    const warningCount = diagnostics.length - errorCount;
    const hasErrors = errorCount > 0;
    const summary = [
        errorCount > 0 ? diagnosticCount(errorCount, 'error') : null,
        warningCount > 0 ? diagnosticCount(warningCount, 'warning') : null,
    ].filter(Boolean).join(', ');
    const showDetails = (diagnostic: ScriptDiagnostic) => {
        setIsOpen(false);
        setSelectedDiagnostic(diagnostic);
    };
    const reveal = (offset: number) => {
        setIsOpen(false);
        setPendingReveal(offset);
    };

    return (
        <>
            <AnchoredOverlay
                open={isOpen}
                onOpen={() => setIsOpen(true)}
                onClose={() => setIsOpen(false)}
                side={AnchorSide.OutsideBottom}
                align={AnchorAlignment.End}
                anchorOffset={4}
                width={OverlaySize.M}
                anchorRef={triggerRef}
                returnFocusRef={triggerRef}
                focusZoneSettings={{ disabled: true }}
                renderAnchor={(anchorProps) => hasErrors ? (
                    // Errors show with their count, a script with errors doesn't run as intended
                    <Button
                        {...anchorProps}
                        ref={triggerRef}
                        className={styles.error_trigger}
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        leadingVisual={<XCircleFillIcon size={iconSize} aria-hidden="true" />}
                        aria-label={`Show ${summary}`}
                        data-testid="script-diagnostics"
                        data-severity="error"
                    >
                        {errorCount}
                    </Button>
                ) : (
                    <IconButton
                        {...anchorProps}
                        ref={triggerRef}
                        className={styles.warning_trigger}
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label={`Show ${summary}`}
                        data-testid="script-diagnostics"
                        data-severity="warning"
                    >
                        <AlertIcon size={iconSize} aria-hidden="true" />
                    </IconButton>
                )}
            >
                <section className={styles.overlay} role="dialog" aria-label="Script diagnostics">
                    <header className={styles.header}>
                        <h2 className={styles.title}>Script diagnostics</h2>
                        <span className={styles.summary}>{summary}</span>
                    </header>
                    <ul className={styles.list}>
                        {diagnostics.map((diagnostic, index) => {
                            // A diagnostic with a place in the text moves the cursor of the editor there
                            const offset = editorView != null ? diagnostic.offset : null;
                            return (
                                <li key={`${diagnostic.severity}-${index}`} className={styles.entry}>
                                    <button
                                        type="button"
                                        className={styles.item}
                                        onClick={() => offset != null ? reveal(offset) : showDetails(diagnostic)}
                                        aria-label={offset != null ? `Go to: ${diagnostic.message}` : `Show details: ${diagnostic.message}`}
                                    >
                                        <span
                                            className={diagnostic.severity === 'error' ? styles.error_icon : styles.warning_icon}
                                            aria-hidden="true"
                                        >
                                            {diagnostic.severity === 'error'
                                                ? <XCircleFillIcon size={16} />
                                                : <AlertIcon size={16} />}
                                        </span>
                                        <span className={styles.message}>{diagnostic.message}</span>
                                        {offset != null && editorView != null && (
                                            <span className={styles.location}>{locationLabel(editorView, offset)}</span>
                                        )}
                                    </button>
                                    {offset != null && (
                                        <IconButton
                                            className={styles.details_button}
                                            variant={ButtonVariant.Invisible}
                                            size={ButtonSize.Small}
                                            aria-label={`Show details: ${diagnostic.message}`}
                                            onClick={() => showDetails(diagnostic)}
                                        >
                                            <BracesIcon size={14} />
                                        </IconButton>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </section>
            </AnchoredOverlay>
            {selectedDiagnostic != null && (
                <Overlay
                    centered
                    width={OverlaySize.L}
                    maxHeight={OverlaySize.XL}
                    returnFocusRef={triggerRef}
                    onEscape={() => setSelectedDiagnostic(null)}
                    onClickOutside={() => setSelectedDiagnostic(null)}
                >
                    <section className={styles.detail_overlay} role="dialog" aria-label="Diagnostic details">
                        <header className={styles.detail_header}>
                            <h2 className={styles.title}>Diagnostic details</h2>
                            <IconButton
                                variant={ButtonVariant.Invisible}
                                size={ButtonSize.Small}
                                aria-label="Close diagnostic details"
                                onClick={() => setSelectedDiagnostic(null)}
                            >
                                <XIcon size={16} />
                            </IconButton>
                        </header>
                        <div className={styles.json_details}>
                            <JsonView
                                value={selectedDiagnostic.details}
                                collapsed={2}
                                shortenTextAfterLength={100}
                            />
                        </div>
                    </section>
                </Overlay>
            )}
        </>
    );
};
