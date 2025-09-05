import { DashQLDecorationPlugins } from './dashql_decorations.js';
import { DashQLProcessorPlugin } from './dashql_processor.js';
import { DashQLTooltipPlugin } from './dashql_tooltips.js';
import { DashQLGutterPlugin } from './dashql_gutters.js';
import { DashQLCompletionPlugin } from './dashql_completion.js';

export const DashQLExtensions = [
    DashQLProcessorPlugin,
    DashQLDecorationPlugins,
    DashQLTooltipPlugin,
    DashQLGutterPlugin,
    DashQLCompletionPlugin,
];
