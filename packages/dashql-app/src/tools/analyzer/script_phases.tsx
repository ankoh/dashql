import * as React from 'react';
import * as dashql from '@akohn/dashql';

import { classNames } from '@akohn/dashql-react/dom/classnames';
import * as styles from './script_phases.module.css';

/// What the core knows about a script after a phase, null if the phase didn't run
export interface ScriptPhasesProps {
    /// The text of the script
    text: string;
    /// The parse, with the tokens of the scanner
    parsed: dashql.buffers.parser.ParsedScriptT | null;
    /// The analysis
    analyzed: dashql.buffers.analyzer.AnalyzedScriptT | null;
}

/// The spans of the core count UTF-8 bytes, the text of a span is decoded from the bytes of the script
class ScriptBytes {
    private readonly bytes: Uint8Array;
    private readonly decoder = new TextDecoder();
    constructor(text: string) {
        this.bytes = new TextEncoder().encode(text);
    }
    slice(offset: number, length: number): string {
        return this.decoder.decode(this.bytes.subarray(offset, offset + length));
    }
}

/// The name of an enum value of the buffers, the number if the enum doesn't know it
function enumName(values: Record<number, string>, value: number): string {
    return values[value] ?? String(value);
}

/// The text of a range of symbols, from its first token to its last
function symbolText(parsed: dashql.buffers.parser.ParsedScriptT, bytes: ScriptBytes, span: dashql.buffers.parser.SymbolSpanT | null): string {
    const tokens = parsed.tokens;
    if (span == null || span.length === 0 || tokens == null) return '';
    const first = span.offset;
    const last = span.offset + span.length - 1;
    if (last >= tokens.tokenOffsets.length) return '';
    const begin = tokens.tokenOffsets[first];
    return bytes.slice(begin, tokens.tokenOffsets[last] + tokens.tokenLengths[last] - begin);
}

/// The text of a list of errors of a phase
function ErrorList(props: { errors: { message: string | Uint8Array | null; textSpan: dashql.buffers.parser.TextSpanT | null }[]; bytes: ScriptBytes }) {
    if (props.errors.length === 0) return null;
    return (
        <ul className={styles.errors}>
            {props.errors.map((error, i) => (
                <li key={i} role="alert">
                    {typeof error.message === 'string' ? error.message : 'error'}
                    {error.textSpan != null && error.textSpan.length > 0 && (
                        <code className={styles.error_text}>{props.bytes.slice(error.textSpan.offset, error.textSpan.length)}</code>
                    )}
                </li>
            ))}
        </ul>
    );
}

function Section(props: React.PropsWithChildren<{ title: string; summary: string }>) {
    return (
        <section className={styles.section} aria-label={props.title}>
            <div className={styles.section_header}>
                <span className={styles.section_title}>{props.title}</span>
                <span className={styles.section_summary}>{props.summary}</span>
            </div>
            <div className={styles.section_body}>{props.children}</div>
        </section>
    );
}

const TOKEN_CLASSES: Partial<Record<dashql.buffers.parser.ScannerTokenType, string>> = {
    [dashql.buffers.parser.ScannerTokenType.KEYWORD]: styles.token_keyword,
    [dashql.buffers.parser.ScannerTokenType.IDENTIFIER]: styles.token_identifier,
    [dashql.buffers.parser.ScannerTokenType.OPERATOR]: styles.token_operator,
    [dashql.buffers.parser.ScannerTokenType.DOT]: styles.token_operator,
    [dashql.buffers.parser.ScannerTokenType.DOT_TRAILING]: styles.token_operator,
    [dashql.buffers.parser.ScannerTokenType.LITERAL_STRING]: styles.token_string,
    [dashql.buffers.parser.ScannerTokenType.LITERAL_INTEGER]: styles.token_number,
    [dashql.buffers.parser.ScannerTokenType.LITERAL_FLOAT]: styles.token_number,
    [dashql.buffers.parser.ScannerTokenType.LITERAL_HEX]: styles.token_number,
    [dashql.buffers.parser.ScannerTokenType.LITERAL_BINARY]: styles.token_number,
    [dashql.buffers.parser.ScannerTokenType.LITERAL_BOOLEAN]: styles.token_number,
};

/// A token of the scanner or a comment, in the order of the text
interface TokenChip {
    /// The index of the symbol, null for a comment
    symbol: number | null;
    type: dashql.buffers.parser.ScannerTokenType;
    offset: number;
    length: number;
}

/// The tokens of a node of the AST, a range of symbols
interface SymbolRange {
    begin: number;
    end: number;
}

/// The tokens of the scanner as a wrapping line, the comments between them. The tokens of the node under the pointer
/// in the AST are highlighted.
function ScannerSection(props: { parsed: dashql.buffers.parser.ParsedScriptT; bytes: ScriptBytes; focus: SymbolRange | null }) {
    const { parsed, bytes, focus } = props;
    const chips = React.useMemo(() => {
        const tokens = parsed.tokens;
        const chips: TokenChip[] = [];
        let comment = 0;
        const comments = parsed.comments;
        const count = tokens?.tokenOffsets.length ?? 0;
        for (let i = 0; i < count; ++i) {
            const offset = tokens!.tokenOffsets[i];
            for (; comment < comments.length && comments[comment].offset < offset; ++comment) {
                chips.push({ symbol: null, type: dashql.buffers.parser.ScannerTokenType.COMMENT, offset: comments[comment].offset, length: comments[comment].length });
            }
            chips.push({ symbol: i, type: tokens!.tokenTypes[i], offset, length: tokens!.tokenLengths[i] });
        }
        for (; comment < comments.length; ++comment) {
            chips.push({ symbol: null, type: dashql.buffers.parser.ScannerTokenType.COMMENT, offset: comments[comment].offset, length: comments[comment].length });
        }
        return chips;
    }, [parsed]);
    const tokenCount = parsed.tokens?.tokenOffsets.length ?? 0;
    const summary = `${tokenCount} ${tokenCount === 1 ? 'token' : 'tokens'}, ${parsed.comments.length} ${parsed.comments.length === 1 ? 'comment' : 'comments'}`
        + (parsed.scannerErrors.length > 0 ? `, ${parsed.scannerErrors.length} errors` : '');
    return (
        <Section title="Scanner" summary={summary}>
            <ErrorList errors={parsed.scannerErrors} bytes={bytes} />
            <div className={styles.tokens}>
                {chips.map(chip => {
                    const focused = chip.symbol != null && focus != null && chip.symbol >= focus.begin && chip.symbol < focus.end;
                    return (
                        <span
                            key={`${chip.symbol ?? 'c'}:${chip.offset}`}
                            className={classNames(
                                styles.token,
                                chip.symbol == null ? styles.token_comment : TOKEN_CLASSES[chip.type],
                                focused && styles.token_focus,
                            )}
                            data-token={chip.symbol ?? 'comment'}
                            data-focus={focused || undefined}
                        >
                            {bytes.slice(chip.offset, chip.length)}
                        </span>
                    );
                })}
            </div>
        </Section>
    );
}

/// Does a node of this type have children? Arrays and objects have, the others keep a value
function hasChildren(type: dashql.buffers.parser.NodeType): boolean {
    return type === dashql.buffers.parser.NodeType.ARRAY || type > dashql.buffers.parser.NodeType.OBJECT_KEYS_;
}

/// A node type without the prefix of its group, `OBJECT_SQL_SELECT` is `SELECT`
function shortNodeType(type: dashql.buffers.parser.NodeType): string {
    return enumName(dashql.buffers.parser.NodeType, type).replace(/^(OBJECT|ENUM)_/, '').replace(/^SQL_/, '');
}

/// How a node relates to the node under the pointer
const enum NodeRole {
    None = 0,
    Focus = 1,
    Child = 2,
    Parent = 3,
}

/// The text of a leaf in its chip, at most this many characters
const LEAF_TEXT_LENGTH = 24;

interface NodeChipProps {
    id: number;
    node: dashql.buffers.parser.NodeT;
    role: NodeRole;
    text: string;
}

/// An attribute key without the prefix of its group, `SQL_SELECT_FROM` is `SELECT_FROM`, null for none
function shortAttributeKey(key: dashql.buffers.parser.AttributeKey): string | null {
    return key === dashql.buffers.parser.AttributeKey.NONE ? null : enumName(dashql.buffers.parser.AttributeKey, key).replace(/^SQL_/, '');
}

/// A node of the AST in one line: its attribute key, its type, and the text of a leaf
const NodeChip = React.memo(function NodeChip({ id, node, role, text }: NodeChipProps) {
    const leaf = !hasChildren(node.nodeType);
    const key = shortAttributeKey(node.attributeKey);
    return (
        <span
            className={classNames(
                styles.node,
                leaf && styles.node_leaf,
                role === NodeRole.Focus && styles.node_focus,
                role === NodeRole.Child && styles.node_child,
                role === NodeRole.Parent && styles.node_parent,
            )}
            data-node={id}
            data-role={role === NodeRole.Focus ? 'focus' : role === NodeRole.Child ? 'child' : role === NodeRole.Parent ? 'parent' : undefined}
        >
            {key != null && <span className={styles.node_key}>{key}</span>}
            <span>{shortNodeType(node.nodeType)}</span>
            {leaf && text.length > 0 && (
                <span className={styles.node_text}>{text.length > LEAF_TEXT_LENGTH ? `${text.slice(0, LEAF_TEXT_LENGTH)}…` : text}</span>
            )}
        </span>
    );
});

/// The nodes of the AST as a wrapping line in the order of the array of the parser, a label at the start of every
/// statement. The node under the pointer highlights its children and its parent in their colors.
function ParserSection(props: { parsed: dashql.buffers.parser.ParsedScriptT; bytes: ScriptBytes; focus: number | null; setFocus: (focus: number | null) => void }) {
    const { parsed, bytes, focus, setFocus } = props;

    const texts = React.useMemo(() => parsed.nodes.map(node => symbolText(parsed, bytes, node.symbolSpan)), [parsed, bytes]);
    const statementAt = React.useMemo(() => {
        const starts = new Map<number, number>();
        parsed.statements.forEach((statement, i) => { if (statement.nodeCount > 0) starts.set(statement.nodesBegin, i); });
        return starts;
    }, [parsed]);

    const focusNode = focus != null ? parsed.nodes[focus] ?? null : null;

    const roleOf = (id: number): NodeRole => {
        if (focus == null || focusNode == null) return NodeRole.None;
        if (id === focus) return NodeRole.Focus;
        if (id === focusNode.parent) return NodeRole.Parent;
        if (hasChildren(focusNode.nodeType) && id >= focusNode.childrenBeginOrValue && id < focusNode.childrenBeginOrValue + focusNode.childrenCount) return NodeRole.Child;
        return NodeRole.None;
    };
    const onPointerOver = (event: React.PointerEvent) => {
        const cell = (event.target as Element).closest('[data-node]');
        if (cell != null) setFocus(Number(cell.getAttribute('data-node')));
    };

    const errors = parsed.parserErrors.length;
    const summary = `${parsed.nodes.length} ${parsed.nodes.length === 1 ? 'node' : 'nodes'}, ${parsed.statements.length} ${parsed.statements.length === 1 ? 'statement' : 'statements'}`
        + (errors > 0 ? `, ${errors} errors` : '');
    return (
        <Section title="Parser" summary={summary}>
            <ErrorList errors={parsed.parserErrors} bytes={bytes} />
            <div className={styles.ast} onPointerOver={onPointerOver} onPointerLeave={() => setFocus(null)}>
                {parsed.nodes.map((node, id) => {
                    const statement = statementAt.get(id);
                    const cell = <NodeChip key={id} id={id} node={node} role={roleOf(id)} text={texts[id]} />;
                    if (statement == null) return cell;
                    const type = enumName(dashql.buffers.parser.StatementType, parsed.statements[statement].statementType);
                    return (
                        <React.Fragment key={id}>
                            <span className={styles.statement_label}>
                                <span>{statement}</span>
                                <span className={styles.statement_type}>{type}</span>
                            </span>
                            {cell}
                        </React.Fragment>
                    );
                })}
            </div>
        </Section>
    );
}

/// A string of the buffers, a string field may also be bytes
function bufferString(value: string | Uint8Array | null | undefined): string {
    return typeof value === 'string' ? value : '';
}

/// A qualified table name as `database.schema.table`, without the parts it doesn't have
function qualifiedTableName(name: dashql.buffers.analyzer.QualifiedTableNameT | null): string {
    if (name == null) return '';
    return [name.databaseName, name.schemaName, name.tableName].map(bufferString).filter(part => part.length > 0).join('.');
}

/// The text of a fact in its chip, at most this many characters
const FACT_TEXT_LENGTH = 40;

/// A fact of the analysis in one chip
interface AnalysisFact {
    key: string;
    /// The AST node of the fact, highlighted with the node under the pointer
    node: number | null;
    /// The kind of an expression
    kind?: string;
    /// The text of the fact, e.g. the text of its node
    text: string;
    /// What the analyzer found, e.g. the resolved table
    detail?: string;
    /// Did the analyzer resolve the name?
    resolved?: boolean;
}

/// A row of facts of one kind, the facts linked to the one under the pointer are highlighted in their own color
function FactRow(props: { title: string; facts: AnalysisFact[]; focus: number | null; linked?: Set<number> }) {
    if (props.facts.length === 0) return null;
    return (
        <div className={styles.fact_row} aria-label={props.title}>
            <span className={styles.fact_title}>{props.title}</span>
            <div className={styles.facts}>
                {props.facts.map(fact => {
                    const text = fact.text.replace(/\s+/g, ' ');
                    const focused = fact.node != null && fact.node === props.focus;
                    const linked = fact.node != null && props.linked?.has(fact.node) === true;
                    return (
                        <span
                            key={fact.key}
                            className={classNames(
                                styles.fact,
                                fact.resolved === true && styles.fact_resolved,
                                fact.resolved === false && styles.fact_unresolved,
                                focused && styles.fact_focus,
                                linked && styles.fact_linked,
                            )}
                            data-ast-node={fact.node ?? undefined}
                            data-fact={props.title}
                            data-focus={focused || undefined}
                            data-linked={linked || undefined}
                        >
                            {fact.kind != null && <span className={styles.fact_kind}>{fact.kind}</span>}
                            <span>{text.length > FACT_TEXT_LENGTH ? `${text.slice(0, FACT_TEXT_LENGTH)}…` : text}</span>
                            {fact.detail != null && <span className={styles.fact_detail}>{fact.detail}</span>}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}

/// The null id of the buffers
const NONE = 0xFFFFFFFF;

/// The kinds of resolved table references as their chips name them, an unresolved one has none
const TABLE_RESOLUTIONS: Record<dashql.buffers.analyzer.TableResolutionType, string | null> = {
    [dashql.buffers.analyzer.TableResolutionType.UNRESOLVED]: null,
    [dashql.buffers.analyzer.TableResolutionType.CATALOG]: 'catalog',
    [dashql.buffers.analyzer.TableResolutionType.SCRIPT]: 'script',
    [dashql.buffers.analyzer.TableResolutionType.TABLE_PARAMETER]: 'parameter',
    [dashql.buffers.analyzer.TableResolutionType.CTE]: 'cte',
};

/// A column ref and the table ref that it reads, by their AST nodes
interface FactLink {
    column: number;
    table: number;
}

/// The kinds of constant expressions as their chips name them
const CONSTANT_KINDS: Partial<Record<dashql.buffers.algebra.ExpressionSubType, string>> = {
    [dashql.buffers.algebra.ExpressionSubType.Literal]: 'literal',
    [dashql.buffers.algebra.ExpressionSubType.UnaryExpression]: 'unary',
    [dashql.buffers.algebra.ExpressionSubType.BinaryExpression]: 'binary',
    [dashql.buffers.algebra.ExpressionSubType.NaryExpression]: 'n-ary',
    [dashql.buffers.algebra.ExpressionSubType.Comparison]: 'comparison',
    [dashql.buffers.algebra.ExpressionSubType.FunctionCallExpression]: 'call',
    [dashql.buffers.algebra.ExpressionSubType.ConstTypeCast]: 'cast',
    [dashql.buffers.algebra.ExpressionSubType.ConstIntervalCast]: 'cast',
    [dashql.buffers.algebra.ExpressionSubType.ConstFunctionCast]: 'cast',
};

/// The facts of an analysis by their kind, each with the AST node it belongs to. The analyzer records only some
/// expressions: the column references, the function calls and the constant subtrees (literals, constant casts, and
/// arithmetic or comparisons over constants). Other operators, e.g. an AND or a comparison of columns, are no
/// expressions of the analysis, so the rows name what is recorded instead of listing "expressions".
function analysisFacts(analyzed: dashql.buffers.analyzer.AnalyzedScriptT, parsed: dashql.buffers.parser.ParsedScriptT | null, bytes: ScriptBytes) {
    const text = (span: dashql.buffers.parser.SymbolSpanT | null) => parsed == null ? '' : symbolText(parsed, bytes, span);
    const nodeText = (node: number) => text(parsed?.nodes[node]?.symbolSpan ?? null);
    // The table references with the kind of their resolution, the resolved name only if the reference reads differently
    const tableRefsByNode = new Map<number, { kind: string | null; name: string }>();
    const tableReferences = analyzed.tableReferences.map((ref, i): AnalysisFact => {
        const refText = text(ref.symbolSpan) || qualifiedTableName(ref.tableName);
        const kind = TABLE_RESOLUTIONS[ref.resolution] ?? null;
        const resolvedName = ref.resolvedTable == null ? null : qualifiedTableName(ref.resolvedTable.tableName);
        tableRefsByNode.set(ref.astNodeId, { kind, name: resolvedName ?? qualifiedTableName(ref.tableName) });
        return {
            key: `r${i}`,
            node: ref.astNodeId,
            text: refText,
            detail: kind == null ? 'unresolved' : resolvedName == null || resolvedName === refText ? kind : `${kind} ${resolvedName}`,
            resolved: kind != null,
        };
    });
    const columns: AnalysisFact[] = [];
    const links: FactLink[] = [];
    const calls: AnalysisFact[] = [];
    analyzed.expressions.forEach((expression, i) => {
        if (expression.innerType === dashql.buffers.algebra.ExpressionSubType.FunctionCallExpression) {
            calls.push({
                key: `e${i}`,
                node: expression.astNodeId,
                text: text(expression.symbolSpan),
                detail: expression.isConstexpr ? 'const' : undefined,
            });
        } else if (expression.innerType === dashql.buffers.algebra.ExpressionSubType.ColumnRefExpression) {
            // A column names the table ref that it reads, a derived table, or an output column of its own scope
            const column = expression.inner as dashql.buffers.algebra.ColumnRefExpressionT;
            const resolved = column.resolution !== dashql.buffers.algebra.ColumnResolutionType.UNRESOLVED;
            const source = column.resolvedSourceAstNodeId;
            const table = source === NONE ? null : tableRefsByNode.get(source) ?? null;
            if (table != null) links.push({ column: expression.astNodeId, table: source });
            columns.push({
                key: `c${i}`,
                node: expression.astNodeId,
                text: text(expression.symbolSpan),
                detail: !resolved ? 'unresolved' : source === NONE ? 'output' : table == null ? 'subquery' : `${table.kind} ${table.name}`,
                resolved,
            });
        }
    });
    // The rarer parts of an analysis only by their count
    const counts: [string, number][] = [
        ['visualization specs', analyzed.visualizationSpecs.length],
        ['client function calls', analyzed.clientFunctionCalls.length],
        ['insert statements', analyzed.insertStatements.length],
        ['function declarations', analyzed.functionDeclarations.length],
    ];
    const others = counts.filter(([, count]) => count > 0).map(([what, count]): AnalysisFact => ({ key: what, node: null, text: `${count} ${what}` }));
    return {
        tables: analyzed.tables.map((table, i): AnalysisFact => ({
            key: `t${i}`,
            node: table.astNodeId,
            text: qualifiedTableName(table.tableName),
            detail: `${table.tableColumns.length} ${table.tableColumns.length === 1 ? 'column' : 'columns'}`,
        })),
        tableReferences,
        columns,
        links,
        calls,
        functions: analyzed.functionReferences.map((ref, i): AnalysisFact => ({
            key: `f${i}`,
            node: ref.astNodeId,
            text: bufferString(ref.functionName?.functionName) || nodeText(ref.astNodeId),
        })),
        // The roots of the constant subtrees with the kind of their root
        constants: analyzed.constantExpressions.map((constant, i): AnalysisFact => {
            const type = analyzed.expressions[constant.expressionId]?.innerType ?? dashql.buffers.algebra.ExpressionSubType.NONE;
            return {
                key: `k${i}`,
                node: constant.astNodeId,
                kind: CONSTANT_KINDS[type] ?? enumName(dashql.buffers.algebra.ExpressionSubType, type),
                text: text(constant.symbolSpan),
            };
        }),
        parameters: analyzed.parameters.map((parameter, i): AnalysisFact => ({
            key: `p${i}`,
            node: parameter.astNodeId,
            text: bufferString(parameter.name) || text(parameter.symbolSpan),
        })),
        inferred: analyzed.inferredTableSchemas.map((schema, i): AnalysisFact => ({
            key: `i${i}`,
            node: schema.tableName?.astNodeId ?? null,
            text: qualifiedTableName(schema.tableName),
            detail: schema.columns.map(column => bufferString(column.columnName)).join(', '),
        })),
        scopes: analyzed.nameScopes.map((scope): AnalysisFact => ({
            key: `s${scope.scopeId}`,
            node: scope.astNodeId,
            text: `scope ${scope.scopeId}`,
            detail: [
                `${scope.tableReferences.length} ${scope.tableReferences.length === 1 ? 'table' : 'tables'}`,
                `${scope.expressions.length} ${scope.expressions.length === 1 ? 'column' : 'columns'}`,
                scope.childScopes.length > 0 ? `${scope.childScopes.length} inner` : null,
            ].filter(part => part != null).join(', '),
        })),
        others,
    };
}

/// The facts linked to the node under the pointer: the table ref that a column ref reads, or the column refs that read
/// a table ref
function linkedFacts(focus: number | null, links: FactLink[]): Set<number> {
    const linked = new Set<number>();
    if (focus == null) return linked;
    for (const link of links) {
        if (link.column === focus) linked.add(link.table);
        if (link.table === focus) linked.add(link.column);
    }
    return linked;
}

/// The analysis: its errors, and its facts as rows of chips by their kind. A fact is highlighted with its AST node,
/// the node of the fact under the pointer is highlighted in the AST and its tokens in the scanner.
function AnalyzerSection(props: {
    analyzed: dashql.buffers.analyzer.AnalyzedScriptT;
    parsed: dashql.buffers.parser.ParsedScriptT | null;
    bytes: ScriptBytes;
    focus: number | null;
    setFocus: (focus: number | null) => void;
}) {
    const { analyzed, parsed, bytes, focus, setFocus } = props;
    const facts = React.useMemo(() => analysisFacts(analyzed, parsed, bytes), [analyzed, parsed, bytes]);
    const linked = React.useMemo(() => linkedFacts(focus, facts.links), [focus, facts]);
    // References to CTEs count as resolved, they have no catalog ids and are not in the index of the resolved tables
    const resolved = facts.tableReferences.filter(fact => fact.resolved).length;
    const summary = [
        `${analyzed.tables.length} ${analyzed.tables.length === 1 ? 'table' : 'tables'}`,
        `${analyzed.tableReferences.length} table refs (${resolved} resolved)`,
        `${facts.columns.length} column refs`,
        `${facts.calls.length} ${facts.calls.length === 1 ? 'call' : 'calls'}`,
        `${facts.constants.length} ${facts.constants.length === 1 ? 'constant' : 'constants'}`,
        `${analyzed.nameScopes.length} name scopes`,
        analyzed.errors.length > 0 ? `${analyzed.errors.length} errors` : null,
    ].filter(part => part != null).join(', ');
    const onPointerOver = (event: React.PointerEvent) => {
        const fact = (event.target as Element).closest('[data-ast-node]');
        setFocus(fact == null ? null : Number(fact.getAttribute('data-ast-node')));
    };
    return (
        <Section title="Analyzer" summary={summary}>
            <ErrorList errors={analyzed.errors} bytes={bytes} />
            <div className={styles.analysis} onPointerOver={onPointerOver} onPointerLeave={() => setFocus(null)}>
                <FactRow title="Tables" facts={facts.tables} focus={focus} />
                <FactRow title="Table refs" facts={facts.tableReferences} focus={focus} linked={linked} />
                <FactRow title="Column refs" facts={facts.columns} focus={focus} linked={linked} />
                <FactRow title="Calls" facts={facts.calls} focus={focus} />
                <FactRow title="Constants" facts={facts.constants} focus={focus} />
                <FactRow title="Function refs" facts={facts.functions} focus={focus} />
                <FactRow title="Parameters" facts={facts.parameters} focus={focus} />
                <FactRow title="Inferred" facts={facts.inferred} focus={focus} />
                <FactRow title="Scopes" facts={facts.scopes} focus={focus} />
                <FactRow title="Other" facts={facts.others} focus={focus} />
            </div>
        </Section>
    );
}

/// What the scanner, the parser and the analyzer know about a script
export function ScriptPhases({ text, parsed, analyzed }: ScriptPhasesProps) {
    const bytes = React.useMemo(() => new ScriptBytes(text), [text]);
    // The node under the pointer in the AST or of the fact of the analysis under the pointer, the scanner highlights
    // its tokens
    const [focus, setFocus] = React.useState<number | null>(null);
    const span = focus != null ? parsed?.nodes[focus]?.symbolSpan ?? null : null;
    const focusTokens = React.useMemo(
        () => span == null || span.length === 0 ? null : { begin: span.offset, end: span.offset + span.length },
        [span],
    );
    return (
        <div className={styles.phases}>
            {parsed != null ? <ScannerSection parsed={parsed} bytes={bytes} focus={focusTokens} /> : <Section title="Scanner" summary="not scanned" />}
            {parsed != null ? <ParserSection parsed={parsed} bytes={bytes} focus={focus} setFocus={setFocus} /> : <Section title="Parser" summary="not parsed" />}
            {analyzed != null
                ? <AnalyzerSection analyzed={analyzed} parsed={parsed} bytes={bytes} focus={focus} setFocus={setFocus} />
                : <Section title="Analyzer" summary="not analyzed" />}
        </div>
    );
}
