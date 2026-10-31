/// The colors of the Xcode editor themes, shared by the editor of the app (CodeMirror) and the code blocks of the
/// website (Shiki). The names follow the highlight tags of the app editor.

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

export const xcodeLightPalette: XcodePalette = {
    background: '#fff',
    foreground: '#3D3D3D',
    selection: '#BBDFFF',
    selectionMatch: '#BBDFFF',
    gutterBackground: '#fff',
    gutterForeground: '#AFAFAF',
    lineHighlight: '#d5e6ff69',
    comment: '#707F8D',
    keyword: '#aa0d91',
    typeOperator: '#aa0d91',
    typeName: '#522BB2',
    propertyName: '#032f62',
    string: '#D23423',
    name: '#032f62',
    variableName: '#23575C',
    variableDefinition: '#327A9E',
    link: '#0e0eff',
};

export const xcodeDarkPalette: XcodePalette = {
    background: '#292A30',
    foreground: '#CECFD0',
    caret: '#fff',
    selection: '#727377',
    selectionMatch: '#727377',
    lineHighlight: '#ffffff0f',
    comment: '#7F8C98',
    keyword: '#FF7AB2',
    typeName: '#DABAFF',
    propertyName: '#6BAA9F',
    string: '#FF8170',
    name: '#6BAA9F',
    variableName: '#ACF2E4',
    variableDefinition: '#6BDFFF',
    link: '#FF8170',
};
