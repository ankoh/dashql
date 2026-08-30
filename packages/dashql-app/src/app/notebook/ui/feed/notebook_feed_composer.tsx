import * as React from 'react';
import * as styles from './notebook_feed.module.css';

import type { EditorView } from '@codemirror/view';
import { CodeIcon, ComposeIcon, PaperAirplaneIcon, SparklesFillIcon, SquareFillIcon, XIcon } from '../../../../ui/foundations/symbol_icon.js';

import { ButtonSize, ButtonVariant, IconButton } from '../../../../ui/foundations/button.js';
import { ButtonGroup } from '../../../../ui/foundations/button_group.js';
import { SegmentedControl, SegmentedControlSize } from '../../../../ui/foundations/segmented_control.js';
import { IndicatorStatus, StatusIndicator } from '../../../../ui/foundations/status_indicator.js';
import { COMPOSE_INPUT_MODE_AI } from '../../scripts/notebook_commands.js';
import { PromptEditor } from '../prompt_editor.js';
import { ScriptEditor } from '../script_editor.js';

interface NotebookFeedComposerProps {
    notebookId: string;
    scriptKey: number;
    inputMode: number;
    setInputMode: (mode: number) => void;
    aiAvailable: boolean;
    aiContextName: string | null;
    aiPromptTextRef: React.MutableRefObject<string>;
    agentActive: boolean;
    disconnected: boolean;
    onClearAIContext: () => void;
    onCancelAgentRun: () => void;
    onSave: () => void;
    onSend: () => void;
    onEditorView: (view: EditorView) => void;
}

export const NotebookFeedComposer: React.FC<NotebookFeedComposerProps> = (props) => (
    <div className={styles.compose_card}>
        {props.inputMode === COMPOSE_INPUT_MODE_AI ? (
            <PromptEditor
                className={styles.compose_card_body}
                autoHeight
                placeholder="Show account balance over time as line chart"
                initialText={props.aiPromptTextRef.current}
                onChange={(text) => { props.aiPromptTextRef.current = text; }}
                setView={props.onEditorView}
            />
        ) : (
            <ScriptEditor
                notebookId={props.notebookId}
                scriptKey={props.scriptKey}
                className={styles.compose_card_body}
                autoHeight
                setView={props.onEditorView}
            />
        )}
        <div className={styles.compose_action_bar}>
            <div className={styles.compose_mode_group}>
                <SegmentedControl
                    aria-label="Input mode"
                    size={SegmentedControlSize.Small}
                    onChange={props.setInputMode}
                >
                    <SegmentedControl.Button
                        leadingVisual={CodeIcon}
                        selected={props.inputMode !== COMPOSE_INPUT_MODE_AI}
                    >
                        SQL
                    </SegmentedControl.Button>
                    <SegmentedControl.Button
                        leadingVisual={SparklesFillIcon}
                        selected={props.inputMode === COMPOSE_INPUT_MODE_AI}
                        disabled={!props.aiAvailable}
                        title={props.aiAvailable ? 'Ctrl + M to toggle' : 'Configure an AI provider in settings'}
                    >
                        AI
                    </SegmentedControl.Button>
                </SegmentedControl>
                {props.inputMode === COMPOSE_INPUT_MODE_AI && props.aiContextName != null && (
                    <button
                        type="button"
                        className={styles.compose_context_bean}
                        title={props.aiContextName}
                        aria-label={`Remove ${props.aiContextName} AI context`}
                        onClick={props.onClearAIContext}
                    >
                        <span className={styles.compose_context_name}>
                            <span className={styles.compose_context_name_text}>{props.aiContextName}</span>
                        </span>
                        <span className={styles.compose_context_remove} aria-hidden="true">
                            <XIcon size={12} />
                        </span>
                    </button>
                )}
            </div>
            <div className={styles.compose_send_group}>
                {props.inputMode === COMPOSE_INPUT_MODE_AI && props.agentActive ? (
                    <>
                        <StatusIndicator
                            className={styles.compose_progress_spinner}
                            status={IndicatorStatus.Running}
                            width="16px"
                            height="16px"
                            fill="currentColor"
                        />
                        <IconButton
                            variant={ButtonVariant.Default}
                            size={ButtonSize.Small}
                            className={styles.compose_send_button}
                            aria-label="Stop agent run"
                            onClick={props.onCancelAgentRun}
                        >
                            <SquareFillIcon />
                        </IconButton>
                    </>
                ) : props.inputMode !== COMPOSE_INPUT_MODE_AI ? (
                    <ButtonGroup aria-label="Draft actions">
                        <IconButton
                            variant={ButtonVariant.Default}
                            size={ButtonSize.Small}
                            aria-label="Save"
                            onClick={props.onSave}
                        >
                            <ComposeIcon />
                        </IconButton>
                        <IconButton
                            variant={ButtonVariant.Default}
                            size={ButtonSize.Small}
                            aria-label="Execute"
                            disabled={props.disconnected}
                            onClick={props.onSend}
                        >
                            <PaperAirplaneIcon />
                        </IconButton>
                    </ButtonGroup>
                ) : (
                    <IconButton
                        variant={ButtonVariant.Default}
                        size={ButtonSize.Small}
                        className={styles.compose_send_button}
                        aria-label="Send to AI"
                        onClick={props.onSend}
                    >
                        <PaperAirplaneIcon />
                    </IconButton>
                )}
            </div>
        </div>
    </div>
);
