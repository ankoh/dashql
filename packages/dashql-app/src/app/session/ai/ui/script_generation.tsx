import * as React from 'react';

import type { EditorView } from '@codemirror/view';

import { setGenerationPlaceholder } from '../editor/generation_placeholder.js';
import type { ScriptGeneration } from '../use_sql_generations.js';

/// Is the agent working on a script?
export function isGenerating(generation: ScriptGeneration | null): boolean {
    return generation?.status != null;
}

/// Mark where the agent's SQL will appear in the editor of a script while the agent works on it.
/// The status lines of the agent are shown by the composer, the placeholder has none.
/// Synced after every render, the script editor replaces its state when the script session changes.
export function useGenerationPlaceholder(view: EditorView | null, generating: boolean): void {
    React.useEffect(() => {
        if (view?.state != null) setGenerationPlaceholder(view, generating ? '' : null);
    });
}
