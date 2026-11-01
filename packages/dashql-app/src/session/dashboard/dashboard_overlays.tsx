import * as React from 'react';

import { useQueryState } from '../../connections/query_executor.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { Overlay, OverlaySize } from '../../ui/foundations/overlay.js';
import { XIcon } from '../../ui/foundations/symbol_icon.js';
import { ChartBuilderOverlay } from '../chart_builder/chart_builder_overlay.js';
import { ScriptEditor } from '../scripts/script_editor.js';
import type { ScriptData } from '../scripts/session_scripts.js';
import { scriptDisplayName } from '../scripts/script_types.js';
import * as styles from './dashboard.module.css';

/// The overlay that the board shows over its cards. The board owns it, a card that gets a renderer is rendered anew
/// as a visualized card and would close an overlay of its own.
export type DashboardOverlayState = { scriptKey: number; kind: 'chart' | 'editor' } | null;

interface EditorProps {
    sessionId: string;
    script: ScriptData;
    onClose: () => void;
}

/// The editor of a script in an overlay over the board
export function DashboardEditorOverlay(props: EditorProps): React.ReactElement {
    const displayName = scriptDisplayName(props.script.fileName);
    const ignoreOutsideClick = React.useCallback(() => {}, []);
    return (
        <Overlay
            centered
            width={OverlaySize.XL}
            height={OverlaySize.L}
            maxHeight={OverlaySize.L}
            onEscape={props.onClose}
            onClickOutside={ignoreOutsideClick}
        >
            <section className={styles.editor_dialog} role="dialog" aria-modal="true" aria-label={`Edit ${displayName}`} data-testid="dashboard-editor-overlay">
                <header className={styles.editor_dialog_header}>
                    <h2 className={styles.card_title}>{displayName}</h2>
                    <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label="Close" onClick={props.onClose}>
                        <XIcon size={16} />
                    </IconButton>
                </header>
                <ScriptEditor sessionId={props.sessionId} scriptKey={props.script.scriptKey} className={styles.editor_dialog_editor} />
            </section>
        </Overlay>
    );
}

interface ChartProps {
    sessionId: string;
    script: ScriptData;
    onChange: (spec: string) => void;
    onClose: () => void;
}

/// The chart builder of a script, the preview shows its latest result
export function DashboardChartOverlay(props: ChartProps): React.ReactElement {
    const queryState = useQueryState(props.sessionId, props.script.latestQueryId);
    return (
        <ChartBuilderOverlay
            scriptName={scriptDisplayName(props.script.fileName)}
            visualizeQuery={props.script.annotations.visualizeQuery}
            queryState={queryState}
            onChange={props.onChange}
            onClose={props.onClose}
        />
    );
}
