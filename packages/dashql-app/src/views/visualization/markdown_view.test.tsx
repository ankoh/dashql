import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { buffers } from '@ankoh/dashql-core';
import { MarkdownView, type MarkdownViewDependencies } from './markdown_view.js';
import { tableFromArrays } from '@ankoh/dashql-runtime/testing/arrow_fixtures';
import { succeededQuery, WithResultTables } from '../../tests/result_tables.js';

const Node = buffers.visualization.MarkdownNodeT;
const NodeType = buffers.visualization.MarkdownNodeType;
const Spec = buffers.visualization.MarkdownSpecT;

function node(nodeType: buffers.visualization.MarkdownNodeType, options: Partial<buffers.visualization.MarkdownNodeT> = {}) {
    return Object.assign(new Node(nodeType), options);
}

const dependencies: MarkdownViewDependencies = {
    logger: { warn: vi.fn() } as any,
};

describe('MarkdownView', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('renders every result row using formatted Arrow values', () => {
        const table = tableFromArrays({
            product: ['Alpha', 'Beta'],
            revenue: new Int32Array([1234567, 2000]),
        });

        act(() => root.render(
            <WithResultTables><MarkdownView
                query={succeededQuery(table)}
                spec={new Spec('', ['product', 'revenue'], node(NodeType.DOCUMENT, { children: [
                    node(NodeType.HEADING, { level: 2, children: [node(NodeType.FIELD, { value: 'product' })] }),
                    node(NodeType.PARAGRAPH, { children: [
                        node(NodeType.TEXT, { value: 'Revenue: ' }),
                        node(NodeType.STRONG, { children: [node(NodeType.FIELD, { value: 'revenue' })] }),
                    ] }),
                ] }))}
                dependencies={dependencies}
            /></WithResultTables>,
        ));

        expect(container.querySelectorAll('[data-markdown-row]')).toHaveLength(2);
        expect(Array.from(container.querySelectorAll('h2')).map(node => node.textContent)).toEqual(['Alpha', 'Beta']);
        expect(container.textContent).toContain('1,234,567');
        expect(container.textContent).toContain('2,000');
    });

    it('renders interpolated Markdown syntax as plain text', () => {
        const table = tableFromArrays({ value: ['**owned** [click](javascript:alert(1))\n# heading'] });

        act(() => root.render(
            <WithResultTables><MarkdownView
                query={succeededQuery(table)}
                spec={new Spec('', ['value'], node(NodeType.DOCUMENT, { children: [
                    node(NodeType.PARAGRAPH, { children: [
                        node(NodeType.TEXT, { value: 'Value: ' }),
                        node(NodeType.FIELD, { value: 'value' }),
                    ] }),
                ] }))}
                dependencies={dependencies}
            /></WithResultTables>,
        ));

        expect(container.querySelector('script')).toBeNull();
        expect(container.querySelector('strong')).toBeNull();
        expect(container.querySelector('a')).toBeNull();
        expect(container.querySelector('h1')).toBeNull();
        expect(container.textContent).toContain('**owned** [click](javascript:alert(1))\n# heading');
    });

    it('renders core-approved links and formatted image alt text', () => {
        const table = tableFromArrays({ product: ['Alpha'] });

        act(() => root.render(
            <WithResultTables><MarkdownView
                query={succeededQuery(table)}
                spec={new Spec('', ['product'], node(NodeType.DOCUMENT, { children: [
                    node(NodeType.PARAGRAPH, { children: [
                        node(NodeType.LINK, { url: 'https://example.com', children: [node(NodeType.TEXT, { value: 'Details' })] }),
                        node(NodeType.IMAGE, { url: '#', children: [node(NodeType.FIELD, { value: 'product' })] }),
                    ] }),
                ] }))}
                dependencies={dependencies}
            /></WithResultTables>,
        ));

        expect(container.querySelector('a')).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' });
        expect(container.querySelector('img')?.alt).toBe('Alpha');
    });
});
