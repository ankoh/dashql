import * as dashql from '@akohn/dashql';

import { EditorView } from '@codemirror/view';

import { DashQLProcessorPlugin } from './dashql_processor.js';

/// How far the pointer may move between the press and the release of a click
const CLICK_SLOP_PX = 4;

/// The press of a primary button without a modifier, the release at the same point is a click
const presses = new WeakMap<EditorView, { x: number; y: number }>();

/// A plain click on a named parameter, `:min` or `from :orders`, calls `onParameterClick` of the processor. The core
/// names the parameter under the cursor that the click placed (`parameter` of the cursor context), the click only has
/// to hit its text. The click still places the cursor.
/// A click is a press and a release at the same point, not the `click` event: the press puts the semantic focus on a
/// table reference, the editor draws the token again and the browser drops the click of an element that left the DOM.
export const DashQLParameterClickPlugin = EditorView.domEventHandlers({
    mousedown(event, view) {
        // A double click selects a word, a modifier extends the selection or adds a cursor
        if (event.button !== 0 || event.detail !== 1 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
            presses.delete(view);
        } else {
            presses.set(view, { x: event.clientX, y: event.clientY });
        }
        return false;
    },
    mouseup(event, view) {
        const press = presses.get(view);
        presses.delete(view);
        if (press == null || Math.abs(event.clientX - press.x) > CLICK_SLOP_PX || Math.abs(event.clientY - press.y) > CLICK_SLOP_PX) {
            return false;
        }
        const state = view.state.field(DashQLProcessorPlugin, false);
        const onParameterClick = state?.onParameterClick;
        if (onParameterClick == null || !view.state.selection.main.empty) return false;
        const parameter = state?.editorUpdate?.primaryCursorContext?.parameter;
        const span = parameter?.textSpan;
        if (parameter == null || span == null) return false;
        const from = Number(span.offset);
        const to = from + Number(span.length);
        // The cursor also lands at the end of a parameter for a click right of it, e.g. at the end of the line
        const start = view.coordsAtPos(from, 1);
        const end = view.coordsAtPos(to, -1);
        if (start == null || end == null) return false;
        const hit = start.top === end.top
            ? event.clientX >= start.left && event.clientX <= end.right && event.clientY >= start.top && event.clientY <= end.bottom
            : event.clientY >= start.top && event.clientY <= end.bottom;
        if (!hit) return false;
        const table = parameter.kind === dashql.buffers.analyzer.ParameterKind.TABLE;
        onParameterClick({ name: String(parameter.name ?? ''), table, from, to }, view);
        return false;
    },
});
