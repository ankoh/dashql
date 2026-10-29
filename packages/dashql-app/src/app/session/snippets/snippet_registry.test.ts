import * as dashql from '@ankoh/dashql-core';

import { beforeAll, describe, expect, it } from 'vitest';

import { ConnectorType } from '../../connections/connector_info.js';
import { SNIPPET_DATASETS_FOLDER, SNIPPET_ENGINE_CONNECTORS } from './snippet.js';
import { buildSnippetRegistry, bundledSnippetFiles, getBundledSnippets, snippetText, snippetsForConnector } from './snippet_registry.js';
import { createScriptFormatConfig, formatSqlText, formattingDialectForConnector } from '../ui/script_format.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let core: dashql.DashQL;
beforeAll(async () => {
    core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

/// A snippet file with a description
function file(body = 'select 1;', description = 'Selects one.'): string {
    return `${dashql.renderCommentTag('description', description)}\n${body}`;
}

/// The scanner and parser errors of a text
function parseErrors(text: string): string[] {
    const catalog = core.createCatalog();
    const script = core.createScript(catalog);
    try {
        script.insertTextAt(0, text);
        script.parse();
        const parsed = script.getParsed();
        try {
            const reader = parsed.read();
            const errors: string[] = [];
            for (let i = 0; i < reader.scannerErrorsLength(); ++i) errors.push(reader.scannerErrors(i)!.message() ?? '');
            for (let i = 0; i < reader.parserErrorsLength(); ++i) errors.push(reader.parserErrors(i)!.message() ?? '');
            return errors;
        } finally {
            parsed.destroy();
        }
    } finally {
        script.destroy();
        catalog.destroy();
    }
}

describe('Snippet registry', () => {
    it('reads the bundled snippets without errors, the folders below the engines are the categories', () => {
        const files = bundledSnippetFiles();
        const registry = buildSnippetRegistry(core, files);
        expect(registry.errors).toEqual([]);
        expect(Object.keys(files).length).toBeGreaterThan(0);
        expect(new Set(Object.keys(files).map(path => path.split('/')[0]))).toEqual(new Set(SNIPPET_ENGINE_CONNECTORS.keys()));
        const folders = new Set(Object.keys(files).map(path => path.split('/')[1]));
        expect(new Set(registry.snippets.map(snippet => snippet.category))).toEqual(folders);
        for (const snippet of registry.snippets) {
            for (const connector of snippet.connectors) {
                const path = snippet.paths.get(connector)!;
                expect(path.slice(path.indexOf('/') + 1), snippet.id).toEqual(`${snippet.id}.sql`);
                expect(SNIPPET_ENGINE_CONNECTORS.get(path.split('/')[0])).toContain(connector);
            }
        }
        expect(registry.snippets[0].category).toEqual(SNIPPET_DATASETS_FOLDER);
        expect(getBundledSnippets(core)).toBe(getBundledSnippets(core));
    });

    it('parses the text of every bundled snippet for every connector', () => {
        const registry = getBundledSnippets(core);
        for (const snippet of registry.snippets) {
            for (const connector of snippet.connectors) {
                const text = snippetText(snippet, connector);
                expect(parseErrors(text), `${snippet.id} ${ConnectorType[connector]}`).toEqual([]);
            }
        }
    });

    // The browser formats the preview to its width, a snippet must not contain anything the formatter cannot format
    it('formats every bundled snippet for every connector', () => {
        const registry = getBundledSnippets(core);
        for (const snippet of registry.snippets) {
            for (const connector of snippet.connectors) {
                const config = createScriptFormatConfig(dashql.buffers.formatting.FormattingMode.PRETTY, false, 80,
                    dashql.buffers.formatting.KeywordCase.LOWER, formattingDialectForConnector(connector));
                const text = snippetText(snippet, connector);
                expect(formatSqlText(core, text, config), `${snippet.id} ${ConnectorType[connector]}`).not.toBeNull();
            }
        }
    });

    it('keeps the description in the text', () => {
        const registry = buildSnippetRegistry(core, {
            'hyper/json/access.sql': file('select 1;', 'Access a value.'),
        });
        const snippet = registry.byId.get('json/access')!;
        expect(snippetText(snippet, ConnectorType.HYPER)).toEqual(`${file('select 1;', 'Access a value.')}\n`);
    });

    it('merges the engine variants of a snippet', () => {
        const registry = buildSnippetRegistry(core, {
            'hyper/json/access.sql': file("select '{}'::json;"),
            'trino/json/access.sql': file("select json_extract_scalar('{}', '$.a');"),
            'salesforce/json/access.sql': file('select 1;'),
        });
        expect(registry.errors).toEqual([]);
        const snippet = registry.byId.get('json/access')!;
        expect(snippet.connectors.sort()).toEqual([ConnectorType.HYPER, ConnectorType.SALESFORCE_DATA_CLOUD, ConnectorType.TRINO, ConnectorType.SIDB].sort());
        expect(snippet.paths.get(ConnectorType.HYPER)).toEqual('hyper/json/access.sql');
        expect(snippet.paths.get(ConnectorType.SIDB)).toEqual('hyper/json/access.sql');
        expect(snippet.paths.get(ConnectorType.SALESFORCE_DATA_CLOUD)).toEqual('salesforce/json/access.sql');
        expect(snippet.paths.get(ConnectorType.TRINO)).toEqual('trino/json/access.sql');
        expect(snippetText(snippet, ConnectorType.TRINO)).toContain('json_extract_scalar');
        expect(snippetText(snippet, ConnectorType.HYPER)).toContain('::json');
    });

    it('reports invalid snippet files', () => {
        const registry = buildSnippetRegistry(core, {
            'hyper/json/Bad Name.sql': file(),
            'json/no-engine.sql': file(),
            'oracle/json/unknown-engine.sql': file(),
            'hyper/json/metadata.sql': `-- @metadata\n-- {"tags": []}\n-- @end\n${file()}`,
            'hyper/json/no-body.sql': dashql.renderCommentTag('description', 'Nothing.'),
            'hyper/json/inline-comment.sql': file('select 1\n-- one\nwhere true;'),
            'hyper/json/no-description.sql': 'select 1;',
            'hyper/json/fine.sql': file(),
        });
        expect(registry.errors).toHaveLength(6);
        expect(registry.errors).toContainEqual(expect.stringContaining('metadata.sql has a @metadata block'));
        expect(registry.errors).toContainEqual(expect.stringContaining('inline-comment.sql has comments outside its comment tags'));
        expect(registry.snippets.map(snippet => snippet.id)).toEqual(['json/fine', 'json/no-description']);
    });

    it('lists the snippets of a connector with the datasets first, then by path', () => {
        const registry = buildSnippetRegistry(core, {
            'hyper/json/access.sql': file(),
            'trino/json/access.sql': file(),
            'hyper/dates/month.sql': file(),
            'trino/dates/month.sql': file(),
            'hyper/dates/series.sql': file(),
            'hyper/datasets/tpch_1.sql': file(),
            'hyper/my-folder/anything.sql': file(),
            'salesforce/profiles/recent.sql': file(),
        });
        const ids = (connector: ConnectorType) => snippetsForConnector(registry, connector).map(snippet => snippet.id);
        expect(ids(ConnectorType.HYPER)).toEqual(['datasets/tpch_1', 'dates/month', 'dates/series', 'json/access', 'my-folder/anything']);
        expect(ids(ConnectorType.TRINO)).toEqual(['dates/month', 'json/access']);
        expect(ids(ConnectorType.SIDB)).toEqual(ids(ConnectorType.HYPER));
        expect(ids(ConnectorType.SALESFORCE_DATA_CLOUD)).toEqual(['profiles/recent']);
    });
});
