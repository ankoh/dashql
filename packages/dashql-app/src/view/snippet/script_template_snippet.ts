import * as dashql from '@ankoh/dashql-core';

/// A template snippet for a single column identifer
export interface ColumnIdentifierSnippetViewModel {
    /// The text before the placeholder
    textBefore: string;
    /// The text after the placeholder
    textAfter: string;
}

export function readColumnIdentifierSnippet(snippet: dashql.buffers.snippet.ScriptSnippet, tmpNode: dashql.buffers.parser.Node) {
    const text = snippet.text()!;
    let textBefore = text;
    let textAfter = "";

    // Find the column reference.
    // XXX We could be faster here when remembering the column ref node?
    // XXX We actually want to operate on the lexer nodes here as well to be resilient to whitespace and line breaks
    const markers = snippet.nodeMarkersArray()!;
    for (let mi = 0; mi < markers.length; ++mi) {
        if (markers[mi] == dashql.buffers.analyzer.SemanticNodeMarkerType.COLUMN_REFERENCE) {
            const node = snippet.nodes(mi, tmpNode)!;
            const nodeLoc = node.location()!;
            textBefore = text.substring(0, nodeLoc.offset());
            textAfter = text.substring(nodeLoc.offset() + nodeLoc.length());
        }
    }

    return { textBefore, textAfter };
}
