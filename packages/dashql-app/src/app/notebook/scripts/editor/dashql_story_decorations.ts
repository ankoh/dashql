import * as core from '../../../../core/index.js';

import { Decoration, DecorationSet, EditorView, GutterMarker, gutter, lineNumbers, WidgetType } from '@codemirror/view';
import { EditorState, type Extension, Range, RangeSet, RangeSetBuilder, StateEffect, StateEffectType, StateField, Transaction } from '@codemirror/state';

interface StoryStatement {
    id: number;
    from: number;
    to: number;
    label: string;
}

interface StoryModel {
    statements: StoryStatement[];
}

export type StoryActivation = 'toggle' | 'open';

interface StoryConfig {
    activation: StoryActivation;
    onActivate?: (statementId: number) => void;
    showGutter?: boolean;
}

export interface StoryState {
    model: StoryModel | null;
    expanded: ReadonlySet<number>;
    decorations: DecorationSet;
    atomicRanges: DecorationSet;
    gutterMarkers: RangeSet<GutterMarker>;
}

export const DashQLStoryUpdateEffect: StateEffectType<core.FlatBufferPtr<core.buffers.parser.ParsedScript> | null> =
    StateEffect.define<core.FlatBufferPtr<core.buffers.parser.ParsedScript> | null>();
export const DashQLStoryToggleStatementEffect: StateEffectType<number> = StateEffect.define<number>();

/// Convert core's UTF-8 byte offsets to the UTF-16 offsets CodeMirror uses.
function utf8Offsets(text: string): number[] {
    const offsets: number[] = [];
    let bytes = 0;
    let utf16 = 0;
    for (const codePoint of text) {
        offsets[bytes] = utf16;
        const byteLength = new TextEncoder().encode(codePoint).length;
        for (let i = 1; i < byteLength; ++i) offsets[bytes + i] = utf16;
        bytes += byteLength;
        utf16 += codePoint.length;
    }
    offsets[bytes] = utf16;
    return offsets;
}

/// Return whether any statement has description comments. This lets the preview preserve its compact
/// rendering for ordinary SQL while using raw source offsets only when descriptions are present.
export function hasStatementDescriptions(parsed: core.FlatBufferPtr<core.buffers.parser.ParsedScript>): boolean {
    const reader = parsed.read();
    const statement = new core.buffers.parser.Statement();
    for (let i = 0; i < reader.statementsLength(); ++i) {
        const current = reader.statements(i, statement);
        if (current != null && current.descriptionCount() > 0) return true;
    }
    return false;
}

/// Project parser description spans into the current CodeMirror document. Keep this conversion beside
/// the decorations that consume it: FlatBuffers use UTF-8 bytes while CodeMirror uses UTF-16 offsets.
function buildStoryModel(state: EditorState, parsed: core.FlatBufferPtr<core.buffers.parser.ParsedScript> | null): StoryModel | null {
    if (parsed == null) return null;
    const text = state.doc.toString();
    const offsets = utf8Offsets(text);
    const reader = parsed.read();
    if (reader.scannerErrorsLength() > 0 || reader.parserErrorsLength() > 0) return null;
    const statement = new core.buffers.parser.Statement();
    const span = new core.buffers.parser.TextSpan();
    const statements: StoryStatement[] = [];
    for (let i = 0; i < reader.statementsLength(); ++i) {
        const current = reader.statements(i, statement);
        const currentSpan = current?.statementSpan(span);
        if (current == null || currentSpan == null || current.descriptionCount() === 0) continue;
        const from = offsets[currentSpan.offset()];
        const to = offsets[currentSpan.offset() + currentSpan.length()];
        if (from == null || to == null || from >= to || current.descriptionBegin() + current.descriptionCount() > reader.commentsLength()) {
            return null;
        }
        statements.push({
            id: i,
            from,
            to,
            label: current.statementType() === core.buffers.parser.StatementType.VIS_VISUALISE
                ? 'visualize statement'
                : 'select statement',
        });
    }
    return statements.length > 0 ? { statements } : null;
}

class ExpandStatementControl extends WidgetType {
    constructor(
        private readonly statementId: number,
        private readonly label: string,
        private readonly activation: StoryActivation,
        private readonly onActivate: ((statementId: number) => void) | undefined,
    ) { super(); }

    eq(other: ExpandStatementControl) {
        return this.statementId === other.statementId && this.label === other.label && this.activation === other.activation;
    }

    toDOM(view: EditorView): HTMLElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dashql-story-sql-control';
        button.dataset.dashqlStoryControl = 'true';
        button.dataset.dashqlStoryStatement = String(this.statementId);
        button.setAttribute('aria-expanded', 'false');
        button.textContent = this.label;
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (this.activation === 'open') {
                this.onActivate?.(this.statementId);
                return;
            }
            view.dispatch({ effects: DashQLStoryToggleStatementEffect.of(this.statementId) });
            requestAnimationFrame(() => {
                view.dom.querySelector<HTMLButtonElement>(`[data-dashql-story-statement="${this.statementId}"]`)?.focus();
            });
        });
        return button;
    }

    ignoreEvent() { return false; }
}

class StoryFoldMarker extends GutterMarker {
    constructor(
        private readonly statementId: number,
        private readonly expanded: boolean,
    ) { super(); }

    eq(other: StoryFoldMarker) { return this.statementId === other.statementId && this.expanded === other.expanded; }

    toDOM(view: EditorView): HTMLElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dashql-story-fold-control';
        button.dataset.dashqlStoryControl = 'true';
        button.dataset.dashqlStoryStatement = String(this.statementId);
        button.setAttribute('aria-expanded', String(this.expanded));
        button.setAttribute('aria-label', this.expanded ? 'Collapse SQL statement' : 'Expand SQL statement');
        button.textContent = this.expanded ? '▾' : '▸';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            view.dispatch({ effects: DashQLStoryToggleStatementEffect.of(this.statementId) });
            requestAnimationFrame(() => {
                view.dom.querySelector<HTMLButtonElement>(`[data-dashql-story-statement="${this.statementId}"]`)?.focus();
            });
        });
        return button;
    }

    ignoreEvent() { return false; }
}

class StoryFoldSpacer extends GutterMarker {
    toDOM(): HTMLElement {
        const spacer = document.createElement('span');
        spacer.className = 'dashql-story-fold-spacer';
        return spacer;
    }
}

function buildDecorations(state: EditorState, model: StoryModel | null, expanded: ReadonlySet<number>, config: StoryConfig): Pick<StoryState, 'decorations' | 'atomicRanges' | 'gutterMarkers'> {
    if (model == null) return { decorations: Decoration.none, atomicRanges: Decoration.none, gutterMarkers: RangeSet.empty };
    const ranges: Range<Decoration>[] = [];
    const atomic: Range<Decoration>[] = [];
    const gutterBuilder = new RangeSetBuilder<GutterMarker>();
    for (const statement of model.statements) {
        const isExpanded = expanded.has(statement.id);
        if (config.activation === 'open' || !isExpanded) {
            const replacement = Decoration.replace({
                widget: new ExpandStatementControl(statement.id, statement.label, config.activation, config.onActivate),
                inclusive: false,
            });
            ranges.push(replacement.range(statement.from, statement.to));
            atomic.push(replacement.range(statement.from, statement.to));
        }
        if (config.activation === 'toggle') gutterBuilder.add(statement.from, statement.from, new StoryFoldMarker(statement.id, isExpanded));
    }
    return { decorations: Decoration.set(ranges, true), atomicRanges: Decoration.set(atomic, true), gutterMarkers: gutterBuilder.finish() };
}

export function createStoryDecorations(config: StoryConfig): { extensions: Extension[]; field: StateField<StoryState> } {
    const field = StateField.define<StoryState>({
        create(state) {
            return { model: null, expanded: new Set(), ...buildDecorations(state, null, new Set(), config) };
        },
        update(value, transaction: Transaction) {
            let model = value.model;
            let expanded = value.expanded;
            for (const effect of transaction.effects) {
                if (effect.is(DashQLStoryUpdateEffect)) {
                    model = buildStoryModel(transaction.state, effect.value);
                    expanded = new Set();
                } else if (effect.is(DashQLStoryToggleStatementEffect) && model?.statements.some(s => s.id === effect.value)) {
                    const nextExpanded = new Set(expanded);
                    nextExpanded.has(effect.value) ? nextExpanded.delete(effect.value) : nextExpanded.add(effect.value);
                    expanded = nextExpanded;
                }
            }
            if (model === value.model && expanded === value.expanded && !transaction.docChanged) return value;
            return { model, expanded, ...buildDecorations(transaction.state, model, expanded, config) };
        },
        provide: field => [
            EditorView.decorations.from(field, value => value.decorations),
            EditorView.atomicRanges.of(view => view.state.field(field).atomicRanges),
        ],
    });
    const foldGutter = gutter({
        class: 'dashql-story-fold-gutter',
        markers: view => view.state.field(field).gutterMarkers,
        initialSpacer: () => new StoryFoldSpacer(),
    });
    return {
        extensions: config.showGutter === false ? [field] : [lineNumbers(), field, foldGutter],
        field,
    };
}
