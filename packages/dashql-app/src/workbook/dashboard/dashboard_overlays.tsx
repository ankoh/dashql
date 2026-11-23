import * as React from 'react';

import type { ScriptModel } from '@akohn/dashql-react/models/script_model';
import { ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { ButtonGroup } from '@akohn/dashql-react/components/button_group';
import { Overlay, OverlaySize } from '@akohn/dashql-react/components/overlay';
import { CheckIcon, ScreenFullIcon, ScreenNormalIcon, XIcon } from '@akohn/dashql-react/components/symbol_icon';
import { ChartBuilderOverlay } from '../chart_builder/chart_builder_overlay.js';
import { ResultTableOverlay } from '../../results/result_table_overlay.js';
import { ScriptEditor } from '../scripts/script_editor.js';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import * as styles from './dashboard.module.css';

/// The overlay that the board shows over its cards. The board owns it, a card that gets a renderer is rendered anew
/// as a visualized card and would close an overlay of its own.
export type DashboardOverlayState = { scriptKey: number; kind: 'chart' | 'editor' | 'table' } | null;

interface EditorProps {
    /// The script, it accepts and rejects its staged rewrite
    model: ScriptModel;
    onClose: () => void;
}

/// The editor of a script in an overlay over the board. A staged rewrite shows as a diff in the editor, the header
/// accepts or rejects it. The overlay expands to fill the window like the chart builder.
export function DashboardEditorOverlay(props: EditorProps): React.ReactElement {
    const script = props.model.script;
    const displayName = scriptDisplayName(script.fileName);
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
                    {script.pendingDiff != null && (
                        <ButtonGroup aria-label="Accept or reject the change">
                            <IconButton
                                variant={ButtonVariant.Default}
                                size={ButtonSize.Small}
                                aria-label="Accept change"
                                data-testid="dashboard-editor-accept"
                                onClick={() => void props.model.acceptDiff()}
                            >
                                <CheckIcon size={14} />
                            </IconButton>
                            <IconButton
                                variant={ButtonVariant.Default}
                                size={ButtonSize.Small}
                                aria-label="Reject change"
                                data-testid="dashboard-editor-reject"
                                onClick={() => void props.model.rejectDiff()}
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
                <ScriptEditor workbookId={props.model.workbookId} scriptKey={script.scriptKey} className={styles.editor_dialog_editor} />
            </section>
        </Overlay>
    );
}

interface ChartProps {
    /// The script, every edit of the spec is staged as a diff of it, like in the feed
    model: ScriptModel;
    onClose: () => void;
}

/// The chart builder of a script, the preview shows its latest result
export function DashboardChartOverlay(props: ChartProps): React.ReactElement {
    const { model } = props;
    return (
        <ChartBuilderOverlay
            scriptName={scriptDisplayName(model.script.fileName)}
            visualizeQuery={model.script.annotations.visualizeQuery}
            model={model.query}
            onChange={spec => void model.setVisSpec(spec)}
            onClose={props.onClose}
        />
    );
}

interface TableProps {
    model: ScriptModel;
    onClose: () => void;
}

/// The full result table of a script, the card shows the rows that fit into it
export function DashboardTableOverlay(props: TableProps): React.ReactElement | null {
    if (props.model.query == null) return null;
    return <ResultTableOverlay scriptName={scriptDisplayName(props.model.script.fileName)} model={props.model.query} onClose={props.onClose} />;
}
