import { DashQLDecorationPlugin } from './dashql_decorations.js';
import { DashQLProcessorPlugin } from './dashql_processor.js';
import { DashQLCursorDiagnosticsPlugin } from './dashql_cursor_diagnostics.js';
import { DashQLGutterPlugin } from './dashql_gutters.js';
import { DashQLCompletionHintPlugin } from './dashql_completion_hint.js';
import { DashQLCompletionListPlugin } from './dashql_completion_list.js';
import { DashQLCompletionKeymapPlugin } from './dashql_completion_keymap.js';

export const DashQLExtensions = [
    DashQLProcessorPlugin,
    DashQLCompletionHintPlugin,
    DashQLCompletionListPlugin,
    DashQLCompletionKeymapPlugin,
    DashQLDecorationPlugin,
    DashQLCursorDiagnosticsPlugin,
    DashQLGutterPlugin,
];
