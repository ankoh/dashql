import * as dashql from '../../core/index.js';

import { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';

import { resolveSymbolSpan } from '../../core/tokens.js';
import { DashQLProcessorPlugin, DashQLProcessorState, DashQLScriptBuffers } from './dashql_processor.js';

import './dashql_code_actions.css';

const INLINE_SOURCE_SQL = 'Inline source SQL';

export interface CodeActionTarget {
    from: number;
    to: number;
    producerScriptKey: number;
    canInline: boolean;
}

function readProducerScriptKey(spec: dashql.buffers.analyzer.VisualizationSpec): number | null {
    const packedTableId = spec.sourceResolvedTableId();
    return packedTableId === 0n ? null : dashql.ExternalObjectID.getOrigin(packedTableId);
}

export function findInlineSourceSQLTarget(
    state: DashQLProcessorState,
    textOffset: number,
): CodeActionTarget | null {
    const parsed = state.scriptBuffers.parsed?.read();
    const analyzed = state.scriptBuffers.analyzed?.read();
    const tokens = parsed?.tokens();
    if (!parsed || !analyzed || !tokens) return null;

    const tmpSpec = new dashql.buffers.analyzer.VisualizationSpec();
    const tmpNode = new dashql.buffers.parser.Node();
    for (let i = 0; i < analyzed.visualizationSpecsLength(); ++i) {
        const spec = analyzed.visualizationSpecs(i, tmpSpec);
        if (spec?.sourceKind() !== dashql.buffers.analyzer.VisSourceKind.SCRIPT_REFERENCE) continue;

        const producerScriptKey = readProducerScriptKey(spec);
        if (producerScriptKey == null) continue;

        const sourceNode = parsed.nodes(spec.sourceAstNodeId(), tmpNode);
        const sourceSpan = sourceNode?.symbolSpan();
        if (!sourceSpan) continue;

        const location = resolveSymbolSpan(tokens, sourceSpan);
        if (textOffset < location.offset || textOffset > location.offset + location.length) continue;

        return {
            from: location.offset,
            to: location.offset + location.length,
            producerScriptKey,
            canInline: true,
        };
    }
    return null;
}

export function buildInlineSourceSQL(
    state: DashQLProcessorState,
    target: CodeActionTarget,
): string | null {
    const sourceScript = state.lookupScript?.(target.producerScriptKey);
    if (!state.script || !sourceScript) return null;

    const originalText = state.script.toString();
    const sourceSQL = sourceScript.toString().trim().replace(/;\s*$/, '');
    const inlineText = `${originalText.substring(0, target.from)}(${sourceSQL})${originalText.substring(target.to)}`;
    return formatRewrittenScript(state.script, inlineText);
}

export function inlineAllScriptReferences(state: DashQLProcessorState): string | null {
    if (!state.script || !state.lookupScript) return null;
    return inlineAllScriptReferencesInScript(state.script, state.scriptBuffers, state.lookupScript);
}

export function inlineAllScriptReferencesInScript(
    script: dashql.DashQLScript,
    scriptBuffers: DashQLScriptBuffers,
    lookupScript: (scriptKey: number) => dashql.DashQLScript | null,
): string | null {
    const parsed = scriptBuffers.parsed?.read();
    const analyzed = scriptBuffers.analyzed?.read();
    const tokens = parsed?.tokens();
    if (!parsed || !analyzed || !tokens) return null;

    const replacements: Array<{ from: number; to: number; sourceSQL: string }> = [];
    const tmpSpec = new dashql.buffers.analyzer.VisualizationSpec();
    const tmpNode = new dashql.buffers.parser.Node();
    for (let i = 0; i < analyzed.visualizationSpecsLength(); ++i) {
        const spec = analyzed.visualizationSpecs(i, tmpSpec);
        if (spec?.sourceKind() !== dashql.buffers.analyzer.VisSourceKind.SCRIPT_REFERENCE) continue;

        const producerScriptKey = readProducerScriptKey(spec);
        const sourceScript = producerScriptKey == null ? null : lookupScript(producerScriptKey);
        const sourceNode = parsed.nodes(spec.sourceAstNodeId(), tmpNode);
        const sourceSpan = sourceNode?.symbolSpan();
        if (!sourceScript || !sourceSpan) continue;

        const location = resolveSymbolSpan(tokens, sourceSpan);
        replacements.push({
            from: location.offset,
            to: location.offset + location.length,
            sourceSQL: sourceScript.toString().trim().replace(/;\s*$/, ''),
        });
    }
    if (replacements.length === 0) return null;

    let inlineText = script.toString();
    for (const replacement of replacements.sort((left, right) => right.from - left.from)) {
        inlineText = `${inlineText.substring(0, replacement.from)}(${replacement.sourceSQL})${inlineText.substring(replacement.to)}`;
    }
    return formatRewrittenScript(script, inlineText);
}

function formatRewrittenScript(script: dashql.DashQLScript, text: string): string {
    const catalog = script.ptr.api.createCatalog();
    const rewritten = script.ptr.api.createScript(catalog);
    let formatted: dashql.DashQLScript | null = null;
    try {
        rewritten.insertTextAt(0, text);
        formatted = rewritten.format(new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.PRETTY,
            80,
            4,
        ));
        return formatted.toString();
    } finally {
        formatted?.ptr.destroy();
        rewritten.ptr.destroy();
        catalog.destroy();
    }
}

class CodeActionMenu {
    readonly root: HTMLDivElement;
    private view: EditorView | null = null;
    private target: CodeActionTarget | null = null;
    private inlineButton: HTMLButtonElement;

    constructor() {
        this.root = document.createElement('div');
        this.root.className = 'dashql-code-action-menu';
        this.root.setAttribute('role', 'menu');
        this.root.hidden = true;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dashql-code-action-item';
        button.setAttribute('role', 'menuitem');
        button.textContent = INLINE_SOURCE_SQL;
        button.addEventListener('click', () => this.apply());
        this.root.appendChild(button);
        this.inlineButton = button;

        const goToDefinition = document.createElement('button');
        goToDefinition.type = 'button';
        goToDefinition.className = 'dashql-code-action-item';
        goToDefinition.setAttribute('role', 'menuitem');
        goToDefinition.textContent = 'Go to definition';
        goToDefinition.addEventListener('click', () => this.navigate());
        this.root.appendChild(goToDefinition);
    }

    mount(): void {
        document.body.appendChild(this.root);
        document.addEventListener('pointerdown', this.handlePointerDown, true);
        document.addEventListener('keydown', this.handleKeyDown, true);
    }

    destroy(): void {
        document.removeEventListener('pointerdown', this.handlePointerDown, true);
        document.removeEventListener('keydown', this.handleKeyDown, true);
        this.root.remove();
    }

    open(view: EditorView, target: CodeActionTarget, event: MouseEvent): void {
        this.view = view;
        this.target = target;
        this.inlineButton.hidden = !target.canInline;
        this.root.style.left = `${Math.min(event.clientX, window.innerWidth - 220)}px`;
        this.root.style.top = `${Math.min(event.clientY, window.innerHeight - 48)}px`;
        this.root.hidden = false;
        (this.root.firstElementChild as HTMLButtonElement).focus();
    }

    close(): void {
        this.root.hidden = true;
        this.view = null;
        this.target = null;
    }

    private apply(): void {
        if (!this.view || !this.target) return;
        const state = this.view.state.field(DashQLProcessorPlugin);
        const rewritten = buildInlineSourceSQL(state, this.target);
        if (rewritten == null) return;
        this.view.dispatch({
            changes: { from: 0, to: this.view.state.doc.length, insert: rewritten },
            userEvent: 'input.code-action.inline-source-sql',
        });
        this.close();
        this.view.focus();
    }

    private navigate(): void {
        if (!this.view || !this.target) return;
        const state = this.view.state.field(DashQLProcessorPlugin);
        state.onNavigateToScript?.(this.target.producerScriptKey);
        this.close();
    }

    private handlePointerDown = (event: PointerEvent): void => {
        if (!this.root.hidden && !this.root.contains(event.target as Node)) this.close();
    };

    private handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && !this.root.hidden) {
            this.close();
            event.preventDefault();
        }
    };
}

export const DashQLCodeActionPlugin: Extension = ViewPlugin.fromClass(class {
    readonly menu = new CodeActionMenu();

    constructor(readonly view: EditorView) {
        this.menu.mount();
        view.dom.addEventListener('contextmenu', this.handleContextMenu);
    }

    destroy(): void {
        this.view.dom.removeEventListener('contextmenu', this.handleContextMenu);
        this.menu.destroy();
    }

    private handleContextMenu = (event: MouseEvent): void => {
        const offset = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (offset == null) return;

        const state = this.view.state.field(DashQLProcessorPlugin);
        const target = findScriptReferenceTarget(state, offset);
        if (!target) return;

        event.preventDefault();
        this.menu.open(this.view, target, event);
    };
});

function findScriptReferenceTarget(state: DashQLProcessorState, textOffset: number): CodeActionTarget | null {
    const inlineTarget = findInlineSourceSQLTarget(state, textOffset);
    if (inlineTarget) return inlineTarget;

    const analyzed = state.scriptBuffers.analyzed?.read();
    const parsed = state.scriptBuffers.parsed?.read();
    const tokens = parsed?.tokens();
    if (!analyzed || !parsed || !tokens) return null;

    const tmpRef = new dashql.buffers.analyzer.TableReference();
    const tmpResolved = new dashql.buffers.analyzer.ResolvedTable();
    for (let i = 0; i < analyzed.tableReferencesLength(); ++i) {
        const ref = analyzed.tableReferences(i, tmpRef);
        const resolved = ref?.resolvedTable(tmpResolved);
        const packedTableId = resolved?.catalogTableId() ?? 0n;
        if (!ref || packedTableId === 0n) continue;

        const span = ref.symbolSpan();
        if (!span) continue;
        const location = resolveSymbolSpan(tokens, span);
        if (textOffset < location.offset || textOffset > location.offset + location.length) continue;

        const producerScriptKey = dashql.ExternalObjectID.getOrigin(packedTableId);
        if (!state.lookupScript?.(producerScriptKey)) return null;
        return {
            from: location.offset,
            to: location.offset + location.length,
            producerScriptKey,
            canInline: false,
        };
    }
    return null;
}
