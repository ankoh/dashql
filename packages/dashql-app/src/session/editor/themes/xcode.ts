import { tags as t } from '@lezer/highlight';
import { createTheme } from './theme.js';

/// The Xcode theme of the editors, in the color scheme of the app.
/// The colors are the --code_* tokens of @ankoh/dashql-ui/styles/tokens.css, which pick the light or the dark
/// Xcode palette with light-dark(). The editors switch with the color scheme without being reconfigured.
export const xcodeTheme = createTheme({
    settings: {
        background: 'var(--code_bg)',
        foreground: 'var(--code_fg)',
        caret: 'var(--code_caret)',
        selection: 'var(--code_selection)',
        selectionMatch: 'var(--code_selection_match)',
        gutterBackground: 'var(--code_bg)',
        gutterForeground: 'var(--code_gutter_fg)',
        gutterBorder: 'transparent',
        lineHighlight: 'var(--code_line_highlight)',
    },
    styles: [
        { tag: [t.comment, t.quote], color: 'var(--code_comment)' },
        { tag: [t.typeName, t.typeOperator], color: 'var(--code_type_operator)' },
        { tag: [t.keyword], color: 'var(--code_keyword)', fontWeight: 'bold' },
        { tag: [t.propertyName], color: 'var(--code_property_name)' },
        { tag: [t.string, t.meta], color: 'var(--code_string)' },
        { tag: [t.name], color: 'var(--code_name)' },
        { tag: [t.typeName], color: 'var(--code_type_name)' },
        { tag: [t.variableName], color: 'var(--code_variable_name)' },
        { tag: [t.definition(t.variableName)], color: 'var(--code_variable_definition)' },
        { tag: [t.regexp, t.link], color: 'var(--code_link)' },
    ],
});
