import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { HighlightStyle, TagStyle, syntaxHighlighting } from '@codemirror/language';
import { StyleSpec } from 'style-mod';

export interface CreateThemeOptions {
    /**
     * Settings to customize the look of the editor, like background, gutter, selection and others.
     */
    settings: Settings;
    /** Syntax highlighting styles. */
    styles: TagStyle[];
}

export interface Settings {
    /** Editor background color. */
    background?: string;
    /** Editor background image. */
    backgroundImage?: string;
    /** Default text color. */
    foreground?: string;
    /** Caret color. */
    caret?: string;
    /** Selection background. */
    selection?: string;
    /** Selection match background. */
    selectionMatch?: string;
    /** Background of highlighted lines. */
    lineHighlight?: string;
    /** Gutter background. */
    gutterBackground?: string;
    /** Text color inside gutter. */
    gutterForeground?: string;
    /** Text active color inside gutter. */
    gutterActiveForeground?: string;
    /** Gutter right border color. */
    gutterBorder?: string;
    /** set editor font */
    fontFamily?: string;
}

/// Create a theme of the editors.
/// The colors are CSS colors that may refer to the tokens of the theme of the app. CodeMirror's own base theme
/// picks its light variant, the theme covers the parts it colors: panels, tooltips, matches and brackets.
export const createTheme = ({ settings = {}, styles = [] }: CreateThemeOptions): Extension => {
    const themeOptions: Record<string, StyleSpec> = {
        '.cm-gutters': {},
    };
    const baseStyle: StyleSpec = {};
    if (settings.background) {
        baseStyle.backgroundColor = settings.background;
    }
    if (settings.backgroundImage) {
        baseStyle.backgroundImage = settings.backgroundImage;
    }
    if (settings.foreground) {
        baseStyle.color = settings.foreground;
    }
    if (settings.background || settings.foreground) {
        themeOptions['&'] = baseStyle;
    }

    if (settings.fontFamily) {
        themeOptions['&.cm-editor .cm-scroller'] = {
            fontFamily: settings.fontFamily,
        };
    }
    if (settings.gutterBackground) {
        themeOptions['.cm-gutters'].backgroundColor = settings.gutterBackground;
    }
    if (settings.gutterForeground) {
        themeOptions['.cm-gutters'].color = settings.gutterForeground;
    }
    if (settings.gutterBorder) {
        themeOptions['.cm-gutters'].borderRightColor = settings.gutterBorder;
    }

    if (settings.caret) {
        themeOptions['.cm-content'] = {
            caretColor: settings.caret,
        };
        themeOptions['.cm-cursor, .cm-dropCursor'] = {
            borderLeftColor: settings.caret,
        };
    }
    const activeLineGutterStyle: StyleSpec = {};
    if (settings.gutterActiveForeground) {
        activeLineGutterStyle.color = settings.gutterActiveForeground;
    }
    if (settings.lineHighlight) {
        themeOptions['.cm-activeLine'] = {
            backgroundColor: settings.lineHighlight,
        };
        activeLineGutterStyle.backgroundColor = settings.lineHighlight;
    }
    themeOptions['.cm-activeLineGutter'] = activeLineGutterStyle;

    if (settings.selection) {
        themeOptions[
            '&.cm-focused .cm-selectionBackground, & .cm-selectionLayer .cm-selectionBackground'
        ] = {
            background: settings.selection + ' !important',
        };
    }
    if (settings.selectionMatch) {
        themeOptions['& .cm-selectionMatch'] = {
            backgroundColor: settings.selectionMatch,
        };
    }
    themeOptions['.cm-panels'] = {
        backgroundColor: 'var(--color_bg_subtle)',
        color: 'var(--color_fg)',
    };
    themeOptions['.cm-panels.cm-panels-top'] = { borderBottom: '1px solid var(--color_border)' };
    themeOptions['.cm-panels.cm-panels-bottom'] = { borderTop: '1px solid var(--color_border)' };
    themeOptions['.cm-tooltip'] = {
        backgroundColor: 'var(--color_bg_card)',
        color: 'var(--color_fg)',
        border: '1px solid var(--color_border)',
    };
    themeOptions['.cm-tooltip-autocomplete ul li[aria-selected]'] = {
        backgroundColor: 'var(--color_accent_muted)',
        color: 'var(--color_fg)',
    };
    themeOptions['.cm-searchMatch'] = {
        backgroundColor: 'var(--color_attention_muted)',
        outline: '1px solid var(--color_attention_fg)',
    };
    themeOptions['.cm-searchMatch.cm-searchMatch-selected'] = {
        backgroundColor: 'var(--color_accent_muted)',
    };
    themeOptions['.cm-matchingBracket, &.cm-focused .cm-matchingBracket'] = {
        backgroundColor: 'var(--color_bg_selected)',
    };
    themeOptions['.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket'] = {
        backgroundColor: 'var(--color_danger_muted)',
    };
    const themeExtension = EditorView.theme(themeOptions);

    const highlightStyle = HighlightStyle.define(styles);
    const extension = [themeExtension, syntaxHighlighting(highlightStyle)];

    return extension;
};

export default createTheme;
