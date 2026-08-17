import * as React from 'react';
import * as themes from '../scripts/editor/themes/index.js';

import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { useAppConfig } from '../../config/app_config.js';
import type { ScriptData } from '../scripts/notebook_scripts.js';
import { useNotebookScripts } from '../scripts/notebook_scripts_registry.js';
import { useLogger } from '../../../platform/logger/logger_provider.js';
import { CodeMirror } from '../scripts/editor/codemirror.js';
import { DashQLStandaloneScannerDecorationPlugin } from '../scripts/editor/dashql_decorations_standalone.js';
import { DashQLStandaloneDiffDecorationPlugin } from '../scripts/editor/dashql_diff_decorations.js';
import { createStoryDecorations } from '../scripts/editor/dashql_story_decorations.js';
import { useApplyPreviewSnapshot, usePreviewSnapshot } from './script_preview_lifecycle.js';
import { useScriptPreviewWidth } from './script_preview_width.js';

export {
    releaseAppliedPreviewSnapshot,
    releasePreviewSnapshot,
    type PreviewSnapshot,
} from './script_preview_lifecycle.js';

const SCRIPT_PREVIEW_LAYOUT = EditorView.theme({
    '.cm-scroller': {
        overflow: 'hidden',
    },
});

export interface ScriptPreviewProps {
    className?: string;
    /// The notebook the script belongs to. Used to reach the core instance for the compact diff.
    notebookId: string;
    scriptData: ScriptData;
    onReady?: (ready: boolean) => void;
    /// Story controls expand inline in the feed and open Details from the fixed overview cards.
    storyActivation?: 'toggle' | 'open';
    onStoryActivate?: () => void;
    /// Show collapsed statement controls for descriptions. The overview keeps its SQL preview compact.
    showStoryControls?: boolean;
    /// The feed always shows line numbers (and story fold arrows); compact grid cards do not.
    showStoryGutter?: boolean;
    /// Last formatted text retained by the parent feed across virtual row unmounts.
    initialTextHint?: string;
    onFormattedText?: (scriptText: string) => void;
    onFormattingStatus?: (formattable: boolean) => void;
}

export const ScriptPreview: React.FC<ScriptPreviewProps> = ({ className, notebookId, scriptData, onReady, storyActivation = 'toggle', onStoryActivate, showStoryControls = true, showStoryGutter = true, initialTextHint = '', onFormattedText, onFormattingStatus }) => {
    const config = useAppConfig();
    const logger = useLogger();
    // Reach the core instance (mirrors ScriptEditor) so a staged rewrite can be diffed against its
    // compact-formatted prior text. The preview only reads state; it never dispatches actions here.
    const [notebookScripts] = useNotebookScripts(notebookId);
    const instance = notebookScripts?.instance ?? null;
    const [view, setView] = React.useState<EditorView | null>(null);
    const formattingDebugMode = config?.settings?.formattingDebugMode ?? false;
    const maxWidthChars = useScriptPreviewWidth(view);
    const { previewSnapshot, descriptionPreview } = usePreviewSnapshot({
        instance,
        scriptData,
        showStoryControls,
        initialTextHint,
        maxWidthChars,
        formattingDebugMode,
        logger,
        onReady,
        onFormattedText,
        onFormattingStatus,
    });
    const previewExtensions = React.useMemo((): Extension[] => [
        themes.xcode.xcodeLight,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        SCRIPT_PREVIEW_LAYOUT,
        DashQLStandaloneScannerDecorationPlugin,
        DashQLStandaloneDiffDecorationPlugin,
        ...createStoryDecorations({
            activation: storyActivation,
            onActivate: () => onStoryActivate?.(),
            // The normal feed owns its line-number sidebar even for plain SQL. The fold gutter
            // appears only when a documented statement has a story control to collapse.
            showGutter: showStoryGutter,
        }).extensions,
    ], [onStoryActivate, showStoryGutter, storyActivation]);

    useApplyPreviewSnapshot(view, previewSnapshot, descriptionPreview, onReady);

    return (
        <div className={className}>
            <CodeMirror
                key={descriptionPreview != null ? `description-${storyActivation}` : 'compact'}
                extensions={previewExtensions}
                initialDoc={initialTextHint}
                ref={setView}
                style={{ height: 'auto' }}
            />
        </div>
    );
};
