/// The model of an architecture diagram: a tree of cards and the edges between them, see
/// docs/agents/architecture_diagrams.md. The cards nest like the <g> elements of the SVG, so a card that sits in another
/// one is its child here and in the layers of an SVG editor.

/// The tone of a line of text: the name of a card, what it is, or the details
export type DiagramTone = 'heading' | 'accent' | 'wasm' | 'muted';

export interface DiagramText {
    text: string;
    /// The first line of a card is a heading by default, the others are muted
    tone?: DiagramTone;
}

/// How a card is drawn. A region holds other cards, a box is a leaf. A wasm card is a WebAssembly module, a leaf or a
/// card in a region that holds boxes, and an external box is not in this repository.
export type DiagramCardKind = 'region' | 'box' | 'wasm' | 'external';

export interface DiagramCard {
    /// The id of the card, the <g> of the card is named `<diagram>-<id>`, the name of its layer in an SVG editor
    id: string;
    kind: DiagramCardKind;
    /// The position in the coordinates of the diagram, not relative to the parent: the edges use the same ones
    x: number;
    y: number;
    width: number;
    height: number;
    lines: DiagramText[];
    /// Right aligned on the line of the heading, its parts are tspans
    aside?: DiagramText[];
    /// A label in a pill in the top right corner
    badge?: string;
    /// The cards inside this one
    children?: DiagramCard[];
}

export interface DiagramEdge {
    /// The ids of the cards, the path is named `<diagram>-<from>-to-<to>`
    from: string;
    to: string;
    /// The path in the coordinates of the diagram, it ends with an arrow at the border of the target
    path: string;
    /// A dependency at run time, dashed, instead of one of the build
    runtime?: boolean;
}

/// The text of a card starts this far from its left border
export const CARD_PADDING = 20;
/// The baseline of the first line of a card, relative to its top border
export const CARD_FIRST_LINE = 34;
/// The distance of the baselines of two lines
export const CARD_LINE_HEIGHT = 28;
