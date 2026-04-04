import { tags as t } from '@lezer/highlight';
import { createTheme, CreateThemeOptions } from './theme.js';

export const defaultSettingsMonochromeLight: CreateThemeOptions['settings'] = {
    background: '#f7f7f8',
    foreground: '#7a7a7a',
    selection: '#d8d8dc',
    selectionMatch: '#e3e3e7',
    lineHighlight: '#f7f7f8',
};

export function monochromeLightInit(options?: Partial<CreateThemeOptions>) {
    const { theme = 'light', settings = {}, styles = [] } = options || {};
    return createTheme({
        theme,
        settings: {
            ...defaultSettingsMonochromeLight,
            ...settings,
        },
        styles: [
            { tag: [t.comment, t.quote], color: '#909090' },
            { tag: [t.keyword], color: '#777777', fontWeight: 'bold' },
            { tag: [t.string, t.meta], color: '#818181' },
            { tag: [t.name], color: '#767676' },
            { tag: [t.typeName, t.typeOperator], color: '#7d7d7d' },
            { tag: [t.variableName], color: '#787878' },
            { tag: [t.definition(t.variableName)], color: '#787878' },
            { tag: [t.regexp, t.link], color: '#858585' },
            ...styles,
        ],
    });
}

export const monochromeLight = monochromeLightInit();
