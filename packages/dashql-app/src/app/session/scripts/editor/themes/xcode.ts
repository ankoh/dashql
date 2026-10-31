import { tags as t } from '@lezer/highlight';
import { xcodeDarkPalette as dark, xcodeLightPalette as light } from '@ankoh/dashql-ui/xcode';
import { createTheme, CreateThemeOptions } from './theme.js';

/// The colors live in @ankoh/dashql-ui, the code blocks of the website use them too

export const defaultSettingsXcodeLight: CreateThemeOptions['settings'] = {
    background: light.background,
    foreground: light.foreground,
    selection: light.selection,
    selectionMatch: light.selectionMatch,
    gutterBackground: light.gutterBackground,
    gutterForeground: light.gutterForeground,
    lineHighlight: light.lineHighlight,
};

export function xcodeLightInit(options?: Partial<CreateThemeOptions>) {
    const { theme = 'light', settings = {}, styles = [] } = options || {};
    return createTheme({
        theme: theme,
        settings: {
            ...defaultSettingsXcodeLight,
            ...settings,
        },
        styles: [
            { tag: [t.comment, t.quote], color: light.comment },
            { tag: [t.typeName, t.typeOperator], color: light.typeOperator },
            { tag: [t.keyword], color: light.keyword, fontWeight: 'bold' },
            { tag: [t.propertyName], color: light.propertyName },
            { tag: [t.string, t.meta], color: light.string },
            { tag: [t.name], color: light.name },
            { tag: [t.typeName], color: light.typeName },
            { tag: [t.variableName], color: light.variableName },
            { tag: [t.definition(t.variableName)], color: light.variableDefinition },
            { tag: [t.regexp, t.link], color: light.link },
            ...styles,
        ],
    });
}

export const xcodeLight = xcodeLightInit();

export const defaultSettingsXcodeDark: CreateThemeOptions['settings'] = {
    background: dark.background,
    foreground: dark.foreground,
    caret: dark.caret,
    selection: dark.selection,
    selectionMatch: dark.selectionMatch,
    lineHighlight: dark.lineHighlight,
};

export const xcodeDarkInit = (options?: Partial<CreateThemeOptions>) => {
    const { theme = 'dark', settings = {}, styles = [] } = options || {};
    return createTheme({
        theme: theme,
        settings: {
            ...defaultSettingsXcodeDark,
            ...settings,
        },
        styles: [
            { tag: [t.comment, t.quote], color: dark.comment },
            { tag: [t.keyword], color: dark.keyword, fontWeight: 'bold' },
            { tag: [t.propertyName], color: dark.propertyName },
            { tag: [t.string, t.meta], color: dark.string },
            { tag: [t.typeName], color: dark.typeName },
            { tag: [t.definition(t.variableName)], color: dark.variableDefinition },
            { tag: [t.name], color: dark.name },
            { tag: [t.variableName], color: dark.variableName },
            { tag: [t.regexp, t.link], color: dark.link },
            ...styles,
        ],
    });
};

export const xcodeDark = xcodeDarkInit();
