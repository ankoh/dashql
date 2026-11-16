import palettes from './xcode_palettes.json' with { type: 'json' };

/// The colors of the Xcode editor themes, shared by the editor of the app (CodeMirror) and the code blocks of the
/// website (Shiki). The names follow the highlight tags of the app editor. They are plain JSON because Node reads them
/// when it evaluates the config of the website.

export interface XcodePalette {
    background: string;
    foreground: string;
    caret?: string;
    selection: string;
    selectionMatch: string;
    gutterBackground?: string;
    gutterForeground?: string;
    lineHighlight: string;
    comment: string;
    keyword: string;
    /// Type operators, and type names of the light theme where no typeName color is set
    typeOperator?: string;
    typeName: string;
    propertyName: string;
    string: string;
    name: string;
    variableName: string;
    variableDefinition: string;
    link: string;
}

export const xcodeLightPalette: XcodePalette = palettes.light;

export const xcodeDarkPalette: XcodePalette = palettes.dark;
