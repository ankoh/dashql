import * as React from 'react';

import { buffers } from '@akohn/dashql';
import { ArrowTableFormatter } from '@akohn/dashql/platform/compute/arrow_formatter';
import { QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import type { QueryModel } from '../../models/query_model.js';
import * as styles from './markdown_view.module.css';
import { CardPlaceholder, QueryStatusPlaceholder } from '../card_placeholder.js';
import { useResultRows } from './result_rows.js';
import { useLogger } from '../../logger.js';

type MarkdownNode = buffers.visualization.MarkdownNodeT;
type MarkdownSpec = buffers.visualization.MarkdownSpecT;
const NodeType = buffers.visualization.MarkdownNodeType;

/// The first rows of a result that a Markdown card renders, a document per row
export const MARKDOWN_CARD_ROWS = 100;

export interface MarkdownViewProps {
    /// The query, the view renders the document once per row of its result
    model: QueryModel | null;
    spec: MarkdownSpec | null;
}

function renderChildren(node: { children: MarkdownNode[] }, fields: Map<string, string | null>, key: string) {
    return node.children.map((child, index) => renderNode(child, fields, `${key}.${index}`));
}

function renderPlainText(nodes: MarkdownNode[], fields: Map<string, string | null>): string {
    return nodes.map(node => {
        switch (node.nodeType) {
            case NodeType.TEXT:
                return readString(node.value);
            case NodeType.FIELD: {
                const field = readString(node.value);
                return fields.has(field) ? fields.get(field) ?? '' : `{{${field}}}`;
            }
            case NodeType.HARD_BREAK:
                return '\n';
            case NodeType.THEMATIC_BREAK:
                return '';
            default:
                return renderPlainText(node.children, fields);
        }
    }).join('');
}

function readString(value: string | Uint8Array | null): string {
    if (typeof value === 'string') return value;
    return value == null ? '' : new TextDecoder().decode(value);
}

function renderNode(node: MarkdownNode, fields: Map<string, string | null>, key: string): React.ReactNode {
    switch (node.nodeType) {
        case NodeType.DOCUMENT:
        case NodeType.SPAN:
            return <React.Fragment key={key}>{renderChildren(node, fields, key)}</React.Fragment>;
        case NodeType.PARAGRAPH:
            return <p key={key}>{renderChildren(node, fields, key)}</p>;
        case NodeType.BLOCKQUOTE:
            return <blockquote key={key}>{renderChildren(node, fields, key)}</blockquote>;
        case NodeType.LIST_ITEM:
            return <li key={key}>{renderChildren(node, fields, key)}</li>;
        case NodeType.EMPHASIS:
            return <em key={key}>{renderChildren(node, fields, key)}</em>;
        case NodeType.STRONG:
            return <strong key={key}>{renderChildren(node, fields, key)}</strong>;
        case NodeType.HEADING: {
            const Heading = `h${node.level}` as React.ElementType;
            return <Heading key={key}>{renderChildren(node, fields, key)}</Heading>;
        }
        case NodeType.LIST: {
            const children = renderChildren(node, fields, key);
            return node.ordered
                ? <ol key={key} start={node.start}>{children}</ol>
                : <ul key={key}>{children}</ul>;
        }
        case NodeType.TEXT:
            return readString(node.value);
        case NodeType.FIELD: {
            const field = readString(node.value);
            return fields.has(field) ? fields.get(field) : `{{${field}}}`;
        }
        case NodeType.INLINE_CODE:
            return <code key={key}>{renderChildren(node, fields, key)}</code>;
        case NodeType.CODE_BLOCK: {
            const language = readString(node.language);
            return <pre key={key}><code className={language ? `language-${language}` : undefined}>{renderChildren(node, fields, key)}</code></pre>;
        }
        case NodeType.LINK:
            return <a key={key} href={readString(node.url)} title={readString(node.title) || undefined} target="_blank" rel="noopener noreferrer">{renderChildren(node, fields, key)}</a>;
        case NodeType.IMAGE: {
            const alt = renderPlainText(node.children, fields);
            return <img key={key} src={readString(node.url)} title={readString(node.title) || undefined} alt={alt} />;
        }
        case NodeType.HARD_BREAK:
            return <br key={key} />;
        case NodeType.THEMATIC_BREAK:
            return <hr key={key} />;
        case NodeType.NONE:
            return null;
    }
}

const NO_FIELDS = new Map<string, string | null>();

/// A document without images: an image becomes its alt text, the page loads nothing that a text names
function withoutImages(node: MarkdownNode): MarkdownNode {
    if (node.nodeType === NodeType.IMAGE) {
        const span = new buffers.visualization.MarkdownNodeT();
        span.nodeType = NodeType.SPAN;
        span.children = node.children.map(withoutImages);
        return span;
    }
    if (node.children.length === 0) return node;
    const copy = Object.assign(new buffers.visualization.MarkdownNodeT(), node);
    copy.children = node.children.map(withoutImages);
    return copy;
}

/// A Markdown document without fields, e.g. the answer of an agent, as the core compiled it (`compileMarkdown`).
/// Images show their alt text.
export function MarkdownText(props: { document: MarkdownNode; className?: string; 'data-testid'?: string }): React.ReactElement {
    const document = React.useMemo(() => withoutImages(props.document), [props.document]);
    return (
        <div className={props.className} data-testid={props['data-testid']}>
            {renderNode(document, NO_FIELDS, 'md')}
        </div>
    );
}

/// The Markdown document of a visualization, rendered once per row of the result with the formatted values of its
/// fields. The view reads the first rows of the result, at most `MARKDOWN_CARD_ROWS`.
export function MarkdownView(props: MarkdownViewProps): React.ReactElement {
    const logger = useLogger();
    const query = props.model?.query ?? null;
    const succeeded = query?.status === QueryExecutionStatus.SUCCEEDED;
    const { table, rows, reading } = useResultRows(props.model, 'first', MARKDOWN_CARD_ROWS);

    const renderedRows = React.useMemo(() => {
        if (props.spec == null || table == null) return null;
        const fields = new Map<string, number>();
        table.schema.fields.forEach((field, index) => {
            if (!fields.has(field.name)) fields.set(field.name, index);
        });
        const formatter = new ArrowTableFormatter(table.schema, table.batches, logger);
        const rows: Array<Map<string, string | null>> = [];
        for (let row = 0; row < table.numRows; ++row) {
            const values = new Map<string, string | null>();
            for (const field of props.spec.fields) {
                const column = fields.get(field);
                if (column != null) values.set(field, formatter.getValue(row, column));
            }
            rows.push(values);
        }
        return rows;
    }, [props.spec, table, logger]);

    if (props.spec == null) {
        return <CardPlaceholder message="No visualization available" />;
    }
    if (!succeeded) {
        return <QueryStatusPlaceholder query={query} />;
    }
    if (reading) {
        return <CardPlaceholder />;
    }
    if (renderedRows == null) {
        return <CardPlaceholder message="No visualization available" />;
    }
    if (renderedRows.length === 0) {
        return <CardPlaceholder message="Result is empty" />;
    }
    const document = props.spec.document;
    if (document == null) {
        return <CardPlaceholder message="No visualization available" />;
    }

    return (
        <div className={styles.root}>
            {renderedRows.map((fields, row) => (
                <article key={row} className={styles.row} data-markdown-row>
                    {renderNode(document, fields, String(row))}
                </article>
            ))}
            {rows > renderedRows.length && (
                <p className={styles.more} data-testid="markdown-more-rows">
                    {rows - renderedRows.length} more rows
                </p>
            )}
        </div>
    );
}
