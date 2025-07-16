import { autocompletion } from '@codemirror/autocomplete';
import { keymap } from '@codemirror/view';

import { DashQLDecorations } from './dashql_decorations.js';
import { DashQLProcessor } from './dashql_processor.js';
import { DashQLTooltips } from './dashql_tooltips.js';
import { DashQLGutters } from './dashql_gutters.js';
import { completeDashQL } from './dashql_completion.js';
import {
    DashQLCompletionHint,
    completionHintKeymap
} from './dashql_completion_hint.js';

export const DashQLExtensions = [
    DashQLProcessor,
    DashQLDecorations,
    DashQLTooltips,
    DashQLGutters,
    DashQLCompletionHint,
    keymap.of(completionHintKeymap),
    autocompletion({
        override: [completeDashQL],
    }),
];
