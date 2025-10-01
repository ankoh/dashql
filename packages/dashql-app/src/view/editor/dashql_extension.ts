import { DashQLDecorationPlugin } from './dashql_decorations.js';
import { DashQLProcessorPlugin } from './dashql_processor.js';
import { DashQLCursorDiagnosticsPlugin } from './dashql_cursor_diagnostics.js';
import { DashQLGutterPlugin } from './dashql_gutters.js';
import { DashQLCompletionHintPlugin } from './dashql_completion_hint.js';
import { DashQLCompletionListPlugin } from './dashql_completion_list.js';
import { DashQLCompletionListenerPlugin } from './dashql_completion_listener.js';

export const DashQLExtensions = [
    DashQLProcessorPlugin,
    DashQLCompletionHintPlugin,
    DashQLCompletionListPlugin,
    DashQLCompletionListenerPlugin,
    DashQLDecorationPlugin,
    DashQLCursorDiagnosticsPlugin,
    DashQLGutterPlugin,
];
