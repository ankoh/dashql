import * as React from 'react';
import * as styles from './script_generation.module.css';

import type { EditorView } from '@codemirror/view';

import { ButtonSize, ButtonVariant, IconButton } from '../../../../ui/foundations/button.js';
import { SquareFillIcon, SymbolIcon } from '../../../../ui/foundations/symbol_icon.js';
import { setGenerationPlaceholder } from '../editor/generation_placeholder.js';
import type { ScriptGeneration } from '../use_sql_generations.js';

const CrossIcon = SymbolIcon('x_16');

/// Is the agent working on a script?
export function isGenerating(generation: ScriptGeneration | null): boolean {
    return generation?.status != null;
}

/// Mark where the agent's SQL will appear in the editor of a script, with the agent's latest status line.
/// Synced after every render, the script editor replaces its state when the script session changes.
export function useGenerationPlaceholder(view: EditorView | null, status: string | null): void {
    React.useEffect(() => {
        if (view?.state != null) setGenerationPlaceholder(view, status);
    });
}

interface GenerationStopButtonProps {
    /// The script whose SQL is being generated
    scriptKey: number | null;
    /// The display name of the script
    displayName: string;
    /// Stop the generation of the script
    onStop: (scriptKey: number) => void;
}

/// Stops the generation of the SQL of a script, takes the place of the execute button
export const GenerationStopButton: React.FC<GenerationStopButtonProps> = (props) => (
    <IconButton
        variant={ButtonVariant.Invisible}
        size={ButtonSize.Small}
        aria-label={`Stop the agent working on ${props.displayName}`}
        data-testid="generation-stop"
        onClick={() => {
            if (props.scriptKey != null) props.onStop(props.scriptKey);
        }}
    >
        <SquareFillIcon size={14} />
    </IconButton>
);

interface GenerationErrorProps {
    /// The script whose generation failed
    scriptKey: number | null;
    /// The generation of the script
    generation: ScriptGeneration | null;
    /// Dismiss the error of the script
    onDismiss: (scriptKey: number) => void;
}

/// The error of a failed request or the final message of the agent, until it is dismissed
export const GenerationError: React.FC<GenerationErrorProps> = (props) => {
    const error = props.generation?.error ?? null;
    const note = props.generation?.note ?? null;
    if (error == null && note == null) {
        return null;
    }
    return (
        <div className={error != null ? styles.generation_error : styles.generation_note} role={error != null ? 'alert' : 'note'}>
            <span className={styles.generation_error_message}>{error ?? note}</span>
            <IconButton
                variant={ButtonVariant.Invisible}
                size={ButtonSize.Small}
                aria-label={error != null ? 'Dismiss the error' : 'Dismiss the note'}
                data-testid="generation-error-dismiss"
                onClick={() => {
                    if (props.scriptKey != null) props.onDismiss(props.scriptKey);
                }}
            >
                <CrossIcon size={14} />
            </IconButton>
        </div>
    );
};
