import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Bazel fills in the paths, they differ between the build in bazel-bin and the dev server in the source tree.
// The package root of @ankoh/dashql-ui, the code, tokens and fonts shared with the app
const uiPath = resolve(process.cwd(), '__UI_PATH__');
// The SVG symbols of the brand logos, generated from //packages/dashql-app:svg_logo_files
const svgSymbolsPath = resolve(process.cwd(), '__SVG_SYMBOLS_PATH__');
// The favicons of the app, //packages/dashql-app:favicons
const faviconsPath = resolve(process.cwd(), '../dashql-app/static/favicons/dashql');

function realpath(path: string): string {
    try {
        return realpathSync(path);
    } catch {
        return path;
    }
}

// The code blocks use the Xcode light theme of the app editor, the colors come from @ankoh/dashql-ui.
// Node loads the palette when it evaluates the config, Vite has nothing to bundle there.
const { xcodeLightPalette: xcode } = await import(/* @vite-ignore */ join(uiPath, 'dist/editor/xcode_palette.js'));
const xcodeLightTheme = {
    name: 'dashql-xcode-light',
    type: 'light',
    colors: {
        'editor.background': xcode.background,
        // Most of the unhighlighted SQL are names of columns and tables, the editor colors them as names
        'editor.foreground': xcode.name,
    },
    tokenColors: [
        { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: xcode.comment } },
        {
            scope: ['keyword', 'keyword.other', 'keyword.control', 'keyword.operator.logical', 'storage', 'storage.type', 'constant.language'],
            settings: { foreground: xcode.keyword, fontStyle: 'bold' },
        },
        { scope: ['keyword.operator', 'punctuation', 'constant.numeric'], settings: { foreground: xcode.foreground, fontStyle: '' } },
        { scope: ['string', 'punctuation.definition.string'], settings: { foreground: xcode.string, fontStyle: '' } },
        { scope: ['support.function', 'entity.name.function'], settings: { foreground: xcode.variableName, fontStyle: '' } },
        { scope: ['entity.name.type', 'support.type', 'entity.name.class'], settings: { foreground: xcode.typeName, fontStyle: '' } },
        { scope: ['markup.underline.link'], settings: { foreground: xcode.link } },
    ],
};

export default defineConfig({
    site: 'https://about.dashql.app',
    output: 'static',
    build: { inlineStylesheets: 'never' },
    integrations: [mdx(), react(), sitemap()],
    markdown: { shikiConfig: { theme: xcodeLightTheme } },
    // The app dev server runs on 9002
    server: { port: 9003 },
    vite: {
        server: {
            strictPort: true,
            fs: {
                allow: [resolve(process.cwd(), '../..'), realpath(uiPath), realpath(dirname(svgSymbolsPath)), realpath(faviconsPath)],
            },
        },
        build: {
            assetsInlineLimit: 0,
            // Without it, the static pages of Astro lose the links to the stylesheets of the CSS Modules
            cssCodeSplit: false,
        },
        css: {
            modules: { localsConvention: 'camelCase' },
        },
        optimizeDeps: {
            exclude: ['@ankoh/dashql-ui/particle_flow'],
        },
        resolve: {
            alias: [
                { find: /^@ankoh\/dashql-ui\/particle_flow$/, replacement: join(uiPath, 'dist/particle_flow/attach_particle_flow.js') },
                { find: /^@ankoh\/dashql-ui\/((fonts|styles)\/.*\.css)$/, replacement: join(uiPath, '$1') },
                { find: /^@dashql\/svg-symbols$/, replacement: `${svgSymbolsPath}?url` },
                { find: /^@dashql\/favicons\/(.*)$/, replacement: join(faviconsPath, '$1') },
            ],
        },
    },
});
