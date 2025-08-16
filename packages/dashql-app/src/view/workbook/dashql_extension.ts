import { DashQLDecorations } from './dashql_decorations.js';
import { DashQLProcessor } from './dashql_processor.js';
import { DashQLTooltips } from './dashql_tooltips.js';
import { DashQLGutters } from './dashql_gutters.js';
import { DashQLCompletion } from './dashql_completion.js';

export const DashQLExtensions = [
    DashQLProcessor,
    DashQLDecorations,
    DashQLTooltips,
    DashQLGutters,
    DashQLCompletion,
];
