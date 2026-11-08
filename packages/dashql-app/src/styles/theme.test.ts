import { xcodeDarkPalette, xcodeLightPalette } from '@ankoh/dashql-ui/editor/xcode_palette';
import TOKENS_CSS from '@ankoh/dashql-ui/styles/tokens.css?raw';

// The stylesheets of the app. The theme and its flavors live in @ankoh/dashql-ui, the app defines no colors.
// A Bazel build replaces the pattern with the declared stylesheets, bazel-bin keeps stale copies of moved sources.
const APP_STYLESHEETS = import.meta.glob<string>([
    '../**/*.css',
], { query: '?raw', import: 'default', eager: true });

// The named colors that a stylesheet could pick instead of a token
const NAMED_COLORS = [
    'white', 'black', 'red', 'green', 'blue', 'gray', 'grey', 'silver', 'goldenrod', 'orange', 'yellow', 'purple',
    'pink', 'navy', 'teal', 'maroon', 'olive', 'lime', 'aqua', 'fuchsia', 'cyan', 'magenta', 'brown', 'gold',
    'whitesmoke', 'lightgray', 'lightgrey', 'darkgray', 'darkgrey', 'dimgray', 'dimgrey', 'gainsboro',
];

const COLOR_LITERAL = new RegExp(
    String.raw`#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|(?<![-\w])(?:${NAMED_COLORS.join('|')})(?![-\w])`,
);

// The declarations of a stylesheet without its comments, with their line numbers
function declarations(css: string): { line: number; property: string; value: string }[] {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
    const out: { line: number; property: string; value: string }[] = [];
    const pattern = /([-\w]+)\s*:\s*([^;{}]+)[;}]/g;
    for (const match of withoutComments.matchAll(pattern)) {
        const line = withoutComments.slice(0, match.index).split('\n').length;
        out.push({ line, property: match[1], value: match[2] });
    }
    return out;
}

// The light and the dark value of a token of the theme
function tokenValues(name: string): [string, string] {
    const match = new RegExp(String.raw`--${name}:\s*light-dark\(([^,]+),\s*([^)]+)\);`).exec(TOKENS_CSS);
    if (match == null) throw new Error(`missing token --${name}`);
    return [match[1].trim(), match[2].trim()];
}

describe('theme', () => {
    it('keeps the colors of the stylesheets in the theme', () => {
        const violations: string[] = [];
        for (const [path, css] of Object.entries(APP_STYLESHEETS)) {
            for (const { line, property, value } of declarations(css)) {
                const where = `${path}:${line} ${property}: ${value.trim()}`;
                if (COLOR_LITERAL.test(value)) {
                    violations.push(`${where} (a color literal, use a token of the theme)`);
                } else if (/--base_color_/.test(value)) {
                    violations.push(`${where} (a color of the palette, use a token of the theme)`);
                } else if (/--neutral_hue|--neutral_tint/.test(value)) {
                    violations.push(`${where} (a grey of its own, use a token of the theme)`);
                } else if (/light-dark\(/.test(value)) {
                    violations.push(`${where} (a color of its own, add a token to the theme)`);
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it('takes the colors of code from the Xcode palettes', () => {
        const expected: [string, string | undefined, string | undefined][] = [
            ['code_fg', xcodeLightPalette.foreground, xcodeDarkPalette.foreground],
            ['code_caret', xcodeLightPalette.caret ?? xcodeLightPalette.foreground, xcodeDarkPalette.caret],
            ['code_selection', xcodeLightPalette.selection, xcodeDarkPalette.selection],
            ['code_selection_match', xcodeLightPalette.selectionMatch, xcodeDarkPalette.selectionMatch],
            ['code_gutter_fg', xcodeLightPalette.gutterForeground, xcodeDarkPalette.gutterForeground ?? xcodeDarkPalette.comment],
            ['code_line_highlight', xcodeLightPalette.lineHighlight, xcodeDarkPalette.lineHighlight],
            ['code_comment', xcodeLightPalette.comment, xcodeDarkPalette.comment],
            ['code_keyword', xcodeLightPalette.keyword, xcodeDarkPalette.keyword],
            ['code_type_operator', xcodeLightPalette.typeOperator, xcodeDarkPalette.typeOperator ?? xcodeDarkPalette.foreground],
            ['code_type_name', xcodeLightPalette.typeName, xcodeDarkPalette.typeName],
            ['code_property_name', xcodeLightPalette.propertyName, xcodeDarkPalette.propertyName],
            ['code_string', xcodeLightPalette.string, xcodeDarkPalette.string],
            ['code_name', xcodeLightPalette.name, xcodeDarkPalette.name],
            ['code_variable_name', xcodeLightPalette.variableName, xcodeDarkPalette.variableName],
            ['code_variable_definition', xcodeLightPalette.variableDefinition, xcodeDarkPalette.variableDefinition],
            ['code_link', xcodeLightPalette.link, xcodeDarkPalette.link],
        ];
        for (const [name, light, dark] of expected) {
            const [tokenLight, tokenDark] = tokenValues(name);
            expect([name, tokenLight.toLowerCase(), tokenDark.toLowerCase()]).toEqual([name, light?.toLowerCase(), dark?.toLowerCase()]);
        }
    });
});
