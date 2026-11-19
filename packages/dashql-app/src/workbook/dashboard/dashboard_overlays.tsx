import * as React from 'react';

import { useQueryModel } from '@akohn/dashql-react/models/query_model';
import { ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { ButtonGroup } from '@akohn/dashql-react/components/button_group';
import { Overlay, OverlaySize } from '@akohn/dashql-react/components/overlay';
import { CheckIcon, ScreenFullIcon, ScreenNormalIcon, XIcon } from '@akohn/dashql-react/components/symbol_icon';
import { ChartBuilderOverlay } from '../chart_builder/chart_builder_overlay.js';
import { ResultTableOverlay } from '../../results/result_table_overlay.js';
import { ScriptEditor } from '../scripts/script_editor.js';
import type { ScriptData } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import * as styles from './dashboard.module.css';

/// The overlay that the board shows over its cards. The board owns it, a card that gets a renderer is rendered anew
/// as a visualized card and would close an overlay of its own.
export type DashboardOverlayState = { scriptKey: number; kind: 'chart' | 'editor' | 'table' } | null;

interface EditorProps {
    workbookId: string;
    script: ScriptData;
    onAcceptDiff: (scriptKey: number) => void;
    onRejectDiff: (scriptKey: number) => void;
    onClose: () => void;
}

/// The editor of a script in an overlay over the board. A staged rewrite shows as a diff in the editor, the header
/// accepts or rejects it. The overlay expands to fill the window like the chart builder.
export function DashboardEditorOverlay(props: EditorProps): React.ReactElement {
    const displayName = scriptDisplayName(props.script.fileName);
    const ignoreOutsideClick = React.useCallback(() => {}, []);
    const [expanded, setExpanded] = React.useState(false);
    return (
        <Overlay
            centered
            width={OverlaySize.XL}
            height={OverlaySize.L}
            maxHeight={OverlaySize.L}
            onEscape={props.onClose}
            onClickOutside={ignoreOutsideClick}
            expanded={expanded}
        >
            <section className={styles.editor_dialog} role="dialog" aria-modal="true" aria-label={`Edit ${displayName}`} data-testid="dashboard-editor-overlay">
                <header className={styles.editor_dialog_header}>
                    <h2 className={styles.card_title}>{displayName}</h2>
                    {props.script.pendingDiff != null && (
                        <ButtonGroup aria-label="Accept or reject the change">
                            <IconButton
                                variant={ButtonVariant.Default}
                                size={ButtonSize.Small}
                                aria-label="Accept change"
                                data-testid="dashboard-editor-accept"
                                onClick={() => props.onAcceptDiff(props.script.scriptKey)}
                            >
                                <CheckIcon size={14} />
                            </IconButton>
                            <IconButton
                                variant={ButtonVariant.Default}
                                size={ButtonSize.Small}
                                aria-label="Reject change"
                                data-testid="dashboard-editor-reject"
                                onClick={() => props.onRejectDiff(props.script.scriptKey)}
                            >
                                <XIcon size={14} />
                            </IconButton>
                        </ButtonGroup>
                    )}
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label={expanded ? 'Restore size' : 'Expand'}
                        aria-pressed={expanded}
                        data-testid="dashboard-editor-expand"
                        onClick={() => setExpanded(e => !e)}
                    >
                        {expanded ? <ScreenNormalIcon size={16} /> : <ScreenFullIcon size={16} />}
                    </IconButton>
                    <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label="Close" onClick={props.onClose}>
                        <XIcon size={16} />
                    </IconButton>
                </header>
                <ScriptEditor workbookId={props.workbookId} scriptKey={props.script.scriptKey} className={styles.editor_dialog_editor} />
            </section>
        </Overlay>
    );
}

interface ChartProps {
    workbookId: string;
    script: ScriptData;
    onChange: (spec: string) => void;
    onClose: () => void;
}

/// The chart builder of a script, the preview shows its latest result
export function DashboardChartOverlay(props: ChartProps): React.ReactElement {
    const model = useQueryModel(props.script.latestQueryId);
    return (
        <ChartBuilderOverlay
            scriptName={scriptDisplayName(props.script.fileName)}
            visualizeQuery={props.script.annotations.visualizeQuery}
            model={model}
            onChange={props.onChange}
            onClose={props.onClose}
        />
    );
}

interface TableProps {
    workbookId: string;
    script: ScriptData;
    onClose: () => void;
}

/// The full result table of a script, the card shows the rows that fit into it
export function DashboardTableOverlay(props: TableProps): React.ReactElement | null {
    const model = useQueryModel(props.script.latestQueryId);
    if (model == null) return null;
    return <ResultTableOverlay scriptName={scriptDisplayName(props.script.fileName)} model={model} onClose={props.onClose} />;
}
