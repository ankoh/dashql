import * as React from 'react';
import * as dashql from '../../core/index.js';
import * as styles from './script_diagnostics.module.css';

import { AlertIcon, XCircleFillIcon, XIcon } from '@primer/octicons-react';

import type { ScriptData } from '../../scripts/notebook_scripts.js';
import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { ButtonSize, ButtonVariant, IconButton } from '../foundations/button.js';
import { JsonView } from '../json/json_view.js';
import { Overlay, OverlaySize } from '../foundations/overlay.js';

export const SCRIPT_FORMATTING_WARNING = 'This script cannot be formatted';

export interface ScriptDiagnostic {
    severity: 'error' | 'warning';
    message: string;
    details: Record<string, unknown>;
}

function spanDetails(span: { offset(): number; length(): number } | null): Record<string, number> | null {
    if (span == null) return null;
    const offset = span.offset();
    const length = span.length();
    return { offset, length, end: offset + length };
}

function pushParserDiagnostics(
    diagnostics: ScriptDiagnostic[],
    source: 'scanner' | 'parser',
    scriptKey: number,
    length: number,
    read: (index: number, target: dashql.buffers.parser.Error) => dashql.buffers.parser.Error | null,
): void {
    const target = new dashql.buffers.parser.Error();
    for (let i = 0; i < length; ++i) {
        const error = read(i, target);
        if (error == null) continue;
        const message = error.message();
        if (!message) continue;
        diagnostics.push({
            severity: 'error',
            message,
            details: {
                source,
                severity: 'error',
                message,
                hint: error.hint(),
                scriptKey,
                textSpan: spanDetails(error.textSpan()),
                symbolSpan: spanDetails(error.symbolSpan()),
            },
        });
    }
}

function formattingDetails(scriptData: ScriptData): Record<string, unknown> {
    const details: Record<string, unknown> = {
        source: 'formatter',
        severity: 'warning',
        message: SCRIPT_FORMATTING_WARNING,
        scriptKey: scriptData.scriptKey,
    };
    try {
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.PRETTY,
            80,
            4,
        );
        details.configuration = {
            dialect: 'DUCKDB',
            mode: 'PRETTY',
            maxWidth: 80,
            indentationWidth: 4,
        };
        const nodeIds = scriptData.script.getUnformattableNodes(config, true);
        const parsed = scriptData.script.getParsed();
        try {
            details.unformattableNodes = nodeIds.map(nodeId => {
                const node = parsed.read().nodes(nodeId);
                return {
                    nodeId,
                    nodeType: node == null ? null : dashql.buffers.parser.NodeType[node.nodeType()],
                    attributeKey: node == null ? null : dashql.buffers.parser.AttributeKey[node.attributeKey()],
                    symbolSpan: node == null ? null : spanDetails(node.symbolSpan()),
                };
            });
        } finally {
            parsed.destroy();
        }
    } catch (error) {
        details.inspectionError = error instanceof Error ? error.message : String(error);
    }
    return details;
}

export function collectScriptDiagnostics(scriptData: ScriptData, isFormattable: boolean): ScriptDiagnostic[] {
    const diagnostics: ScriptDiagnostic[] = [];
    const parsed = scriptData.scriptAnalysis.buffers.parsed?.read() ?? null;
    if (parsed != null) {
        pushParserDiagnostics(
            diagnostics,
            'scanner',
            scriptData.scriptKey,
            parsed.scannerErrorsLength(),
            (index, target) => parsed.scannerErrors(index, target),
        );
        pushParserDiagnostics(
            diagnostics,
            'parser',
            scriptData.scriptKey,
            parsed.parserErrorsLength(),
            (index, target) => parsed.parserErrors(index, target),
        );
    }

    const analyzed = scriptData.scriptAnalysis.buffers.analyzed?.read() ?? null;
    if (analyzed != null) {
        const target = new dashql.buffers.analyzer.AnalyzerError();
        for (let i = 0; i < analyzed.errorsLength(); ++i) {
            const error = analyzed.errors(i, target);
            if (error == null) continue;
            const message = error.message();
            if (!message) continue;
            const severity = error.severity() === dashql.buffers.analyzer.AnalyzerErrorSeverity.WARNING
                ? 'warning'
                : 'error';
            const errorType = error.errorType();
            diagnostics.push({
                severity,
                message,
                details: {
                    source: 'analyzer',
                    severity,
                    message,
                    code: dashql.buffers.analyzer.AnalyzerErrorType[errorType],
                    codeValue: errorType,
                    astNodeId: error.astNodeId(),
                    scriptKey: scriptData.scriptKey,
                    textSpan: spanDetails(error.textSpan()),
                    symbolSpan: spanDetails(error.symbolSpan()),
                },
            });
        }
    }

    if (!isFormattable) {
        diagnostics.push({
            severity: 'warning',
            message: SCRIPT_FORMATTING_WARNING,
            details: formattingDetails(scriptData),
        });
    }
    return diagnostics;
}

export const ScriptDiagnosticsButton: React.FC<{
    scriptData: ScriptData;
    isFormattable: boolean;
}> = ({ scriptData, isFormattable }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const [selectedDiagnostic, setSelectedDiagnostic] = React.useState<ScriptDiagnostic | null>(null);
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    const diagnostics = collectScriptDiagnostics(scriptData, isFormattable);
    React.useEffect(() => {
        if (diagnostics.length === 0) {
            if (isOpen) setIsOpen(false);
            if (selectedDiagnostic != null) setSelectedDiagnostic(null);
        }
    }, [diagnostics.length, isOpen, selectedDiagnostic]);
    if (diagnostics.length === 0) return null;

    const hasErrors = diagnostics.some(diagnostic => diagnostic.severity === 'error');
    const errorCount = diagnostics.filter(diagnostic => diagnostic.severity === 'error').length;
    const warningCount = diagnostics.length - errorCount;
    const label = hasErrors ? 'Show script errors' : 'Show script warnings';
    const summary = [
        errorCount > 0 ? `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}` : null,
        warningCount > 0 ? `${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}` : null,
    ].filter(Boolean).join(', ');

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
                renderAnchor={(anchorProps) => (
                    <IconButton
                        {...anchorProps}
                        ref={triggerRef}
                        className={hasErrors ? styles.error_trigger : styles.warning_trigger}
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label={label}
                    >
                        {hasErrors
                            ? <XCircleFillIcon size={16} aria-hidden="true" />
                            : <AlertIcon size={16} aria-hidden="true" />}
                    </IconButton>
                )}
            >
                <section className={styles.overlay} role="dialog" aria-label="Script diagnostics">
                    <header className={styles.header}>
                        <h2 className={styles.title}>Script diagnostics</h2>
                        <span className={styles.summary}>{summary}</span>
                    </header>
                    <ul className={styles.list}>
                        {diagnostics.map((diagnostic, index) => (
                            <li key={`${diagnostic.severity}-${index}`}>
                                <button
                                    type="button"
                                    className={styles.item}
                                    onClick={() => {
                                        setIsOpen(false);
                                        setSelectedDiagnostic(diagnostic);
                                    }}
                                    aria-label={`Show details: ${diagnostic.message}`}
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
                                </button>
                            </li>
                        ))}
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
