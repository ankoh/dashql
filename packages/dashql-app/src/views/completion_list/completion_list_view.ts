import * as dashql from '@ankoh/dashql-core';

import { CompletionCandidateType, getCandidateTypeSymbolColor, getCandidateTypeSymbolText } from './completion_candidate_type.js';

import * as styles from './completion_list.module.css';
import icons from '@ankoh/dashql-svg-symbols';


// This file renders a completion list with a side pane, for the editor and for the shell.
// The rendering deliberately does NOT use React.
// We're implementing the view consolidation manually here.
//
// It knows nothing about its host: the host reads a completion buffer with collectCandidates, passes the position of
// the text that is replaced to placeBelowOrAbove, and keeps the focus in its input.


export interface Position {
    /// The top offset (used when rendering below the cursor)
    top: number | null;
    /// The bottom offset (used when rendering above the cursor)
    bottom: number | null;
    /// The left offset
    left: number;
}

/// An entry of a table in the side pane
interface CandidateDetailsField {
    /// The name of a parameter or column, or the label of a fact
    name: string;
    /// The type, or the value of a fact
    detail: string | null;
    /// The prose
    description: string | null;
}

/// What the side pane shows about a candidate
interface CandidateDetails {
    /// One line: a signature, a type, a table
    detail: string | null;
    /// The prose
    description: string | null;
    /// What the candidate takes
    parameters: CandidateDetailsField[];
    /// What a result holds
    resultDescription: string | null;
    /// The columns of a result or a table
    columns: CandidateDetailsField[];
    /// A call that shows how to write it
    example: string | null;
    /// Short facts
    facts: CandidateDetailsField[];
}

export interface VirtualCandidate {
    /// The candidate type.
    /// Either the object type of the selected object or the first one.
    candidateType: CompletionCandidateType;
    /// The candidate text
    candidateLabel: string;
    /// What the side pane shows, only read for the selected candidate and of its selected object
    details: CandidateDetails | null;
    /// Is selected?
    isSelected: boolean;
    /// The total catalog objects
    totalObjectCount: number;
    /// The selected catalog object
    selectedCatalogObject: number | null;
}

/// Derive the type of a candidate from an object of it, a candidate without objects has only its name tags
function getCandidateType(
    candidate: dashql.buffers.completion.CompletionCandidate,
    object: dashql.buffers.completion.CompletionCandidateObject | null,
): CompletionCandidateType {
    if (candidate.candidateTags() & dashql.buffers.completion.CandidateTag.IDENTITY) {
        return CompletionCandidateType.IDENTITY;
    }
    if (object != null) {
        // A table parameter reads the result of a script or an attachment
        switch (object.tableParameter()) {
            case dashql.buffers.completion.CompletionTableParameter.SCRIPT:
                return CompletionCandidateType.SCRIPT;
            case dashql.buffers.completion.CompletionTableParameter.ATTACHMENT:
                return CompletionCandidateType.ATTACHMENT;
        }
        return (object.objectType() as number) as CompletionCandidateType;
    }
    const nameTags = candidate.nameTags();
    if (nameTags & dashql.buffers.analyzer.NameTag.FUNCTION_NAME) return CompletionCandidateType.FUNCTION;
    if (nameTags & dashql.buffers.analyzer.NameTag.SCHEMA_NAME) return CompletionCandidateType.SCHEMA;
    if (nameTags & dashql.buffers.analyzer.NameTag.OPTION_NAME) return CompletionCandidateType.OPTION;
    return CompletionCandidateType.KEYWORD;
}

/// The inline Markdown of a description: code, bold and links
const INLINE_MARKDOWN = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\([^)\s]+\)/g;

/// Render a description into an element.
/// A description is text, everything goes through text nodes. A link shows its label, a click must not leave the input.
function renderDescription(element: HTMLElement, description: string) {
    const nodes: Node[] = [];
    let offset = 0;
    for (const match of description.matchAll(INLINE_MARKDOWN)) {
        nodes.push(document.createTextNode(description.slice(offset, match.index)));
        offset = match.index + match[0].length;
        if (match[1] !== undefined) {
            const code = document.createElement('code');
            code.textContent = match[1];
            nodes.push(code);
        } else if (match[2] !== undefined) {
            const strong = document.createElement('strong');
            strong.textContent = match[2];
            nodes.push(strong);
        } else {
            nodes.push(document.createTextNode(match[3]));
        }
    }
    nodes.push(document.createTextNode(description.slice(offset)));
    element.replaceChildren(...nodes);
}

/// Read the details of a candidate
function readCandidateDetails(info: dashql.buffers.completion.CompletionCandidateInfo): CandidateDetails {
    const tmpField = new dashql.buffers.completion.CompletionCandidateField();
    const readFields = (length: number, field: (index: number, tmp: dashql.buffers.completion.CompletionCandidateField) => dashql.buffers.completion.CompletionCandidateField | null) => {
        const out: CandidateDetailsField[] = [];
        for (let i = 0; i < length; ++i) {
            const f = field(i, tmpField)!;
            out.push({ name: f.name()!, detail: f.detail(), description: f.description() });
        }
        return out;
    };
    return {
        detail: info.detail(),
        description: info.description(),
        parameters: readFields(info.parametersLength(), (i, tmp) => info.parameters(i, tmp)),
        resultDescription: info.resultDescription(),
        columns: readFields(info.columnsLength(), (i, tmp) => info.columns(i, tmp)),
        example: info.example(),
        facts: readFields(info.factsLength(), (i, tmp) => info.facts(i, tmp)),
    };
}

/// Create an element with a class
function createDetailsElement(tag: string, className: string, text: string | null = null): HTMLElement {
    const element = document.createElement(tag);
    element.classList.add(className);
    element.textContent = text;
    return element;
}

/// Render a table of the side pane
function renderDetailsFields(tableClass: string, fields: CandidateDetailsField[]): HTMLElement {
    const table = createDetailsElement('div', tableClass);
    // A table with prose has a third column, every row fills it so that the rows line up
    const described = fields.some(field => field.description != null);
    table.classList.toggle(styles.details_fields_described, described);
    for (const field of fields) {
        table.appendChild(createDetailsElement('div', styles.details_field_name, field.name));
        table.appendChild(createDetailsElement('div', styles.details_field_detail, field.detail));
        if (described) {
            const description = createDetailsElement('div', styles.details_field_description);
            renderDescription(description, field.description ?? '');
            table.appendChild(description);
        }
    }
    return table;
}

/// The pane next to the list, with what is known about the selected candidate
class CandidateDetailsRenderer {
    /// What is rendered
    renderedKey: string | null = null;
    /// Is the pane shown?
    visible: boolean = true;

    /// The pane
    public readonly rootElement: HTMLDivElement;

    constructor() {
        this.rootElement = document.createElement('div');
        this.rootElement.classList.add(styles.details_container);
        this.hide();
    }

    /// Is the pane shown?
    public get isVisible() { return this.visible; }
    /// Hide the pane (if shown)
    public hide() {
        if (this.visible) {
            this.rootElement.classList.add(styles.hidden);
            this.visible = false;
        }
    }
    /// Show the pane (if hidden)
    protected show() {
        if (!this.visible) {
            this.rootElement.classList.remove(styles.hidden);
            this.visible = true;
        }
    }
    /// Render the selected candidate.
    /// A candidate that nothing is known about has no pane.
    public render(selected: VirtualCandidate | null) {
        const details = selected?.details ?? null;
        if (details == null) {
            this.hide();
            return;
        }
        // A selection and a keystroke can both change the details, so compare what they say
        const key = JSON.stringify([details, selected!.candidateType]);
        if (key != this.renderedKey) {
            this.rootElement.replaceChildren(...this.renderContent(selected!.candidateType, details));
            this.renderedKey = key;
            this.rootElement.scrollTop = 0;
        }
        this.show();
    }
    /// Render the pane: a header that says what the candidate is, and a section for everything else
    protected renderContent(type: CompletionCandidateType, details: CandidateDetails): HTMLElement[] {
        const out: HTMLElement[] = [];
        if (details.detail != null || details.description != null) {
            const header = createDetailsElement('div', styles.details_header);
            if (details.detail != null) {
                // The table below has the same parameters, the description should stay in view
                const detail = createDetailsElement('div', styles.details_detail, details.detail);
                detail.classList.toggle(styles.details_detail_clamped, details.parameters.length > 0);
                header.appendChild(detail);
            }
            if (details.description != null) {
                const description = createDetailsElement('div', styles.details_description);
                renderDescription(description, details.description);
                header.appendChild(description);
            }
            out.push(header);
        }
        const addSection = (title: string, ...content: HTMLElement[]) => {
            const section = createDetailsElement('div', styles.details_section);
            section.appendChild(createDetailsElement('div', styles.details_title, title));
            section.append(...content);
            out.push(section);
        };
        if (details.parameters.length > 0) {
            addSection(type == CompletionCandidateType.OPTION ? 'Attributes' : 'Parameters', renderDetailsFields(styles.details_fields, details.parameters));
        }
        if (details.resultDescription != null || details.columns.length > 0) {
            const content: HTMLElement[] = [];
            if (details.resultDescription != null) {
                const description = createDetailsElement('div', styles.details_description);
                renderDescription(description, details.resultDescription);
                content.push(description);
            }
            if (details.columns.length > 0) {
                content.push(renderDetailsFields(styles.details_fields, details.columns));
            }
            addSection(type == CompletionCandidateType.FUNCTION ? 'Result' : 'Columns', ...content);
        }
        if (details.example != null) {
            addSection('Example', createDetailsElement('div', styles.details_example, details.example));
        }
        if (details.facts.length > 0) {
            addSection('Details', renderDetailsFields(styles.details_facts, details.facts));
        }
        return out;
    }
}

class CandidateRenderer {
    /// The currently rendered candidate
    rendered: VirtualCandidate | null;

    /// Info element visible?
    infoVisible: boolean;
    /// Selected object count visible?
    objectContainerVisible: boolean;
    /// Selected object index visible?
    objectSelectionVisible: boolean;
    navVisible: boolean;

    /// The entry element
    public readonly rootElement: HTMLDivElement;
    /// The icon element
    readonly iconElement: HTMLSpanElement;
    /// The name element
    readonly nameElement: HTMLSpanElement;
    /// The info element
    readonly infoElement: HTMLDivElement;

    /// The nav container element
    readonly navContainerElement: HTMLDivElement;
    /// The left arrow
    readonly navArrowLeftElement: SVGElement;
    /// The right arrow
    readonly navArrowRightElement: SVGElement;
    /// The container for the object count
    readonly objectContainerElement: HTMLDivElement;
    /// The span for the selected catalog object
    readonly objectSelectedSpan: HTMLSpanElement;
    /// The span for the catalog object count
    readonly objectTotalSpan: HTMLSpanElement;

    constructor(candidate: VirtualCandidate, selectPreviousVariant: () => void, selectNextVariant: () => void) {
        this.rendered = null;
        this.rootElement = document.createElement('div');
        this.iconElement = document.createElement('span');
        this.nameElement = document.createElement('span');
        this.infoElement = document.createElement('div');
        this.infoVisible = true;
        this.objectContainerVisible = true;
        this.objectSelectionVisible = true;
        this.navVisible = true;

        this.navContainerElement = document.createElement('div');
        this.navArrowLeftElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.navArrowRightElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

        const navArrowLeftUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        this.navArrowLeftElement.appendChild(navArrowLeftUse);
        this.navArrowLeftElement.setAttribute('width', '13px');
        this.navArrowLeftElement.setAttribute('height', '13px');
        navArrowLeftUse.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `${icons}#arrow_left_16`);

        const navArrowRightUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        this.navArrowRightElement.appendChild(navArrowRightUse);
        this.navArrowRightElement.setAttribute('width', '13px');
        this.navArrowRightElement.setAttribute('height', '13px');
        navArrowRightUse.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `${icons}#arrow_right_16`);
        this.navArrowLeftElement.setAttribute('role', 'button');
        this.navArrowLeftElement.setAttribute('aria-label', 'Previous catalog object');
        this.navArrowRightElement.setAttribute('role', 'button');
        this.navArrowRightElement.setAttribute('aria-label', 'Next catalog object');
        this.navArrowLeftElement.addEventListener('mousedown', event => {
            event.preventDefault();
            selectPreviousVariant();
        });
        this.navArrowRightElement.addEventListener('mousedown', event => {
            event.preventDefault();
            selectNextVariant();
        });

        this.objectContainerElement = document.createElement('div');
        this.objectSelectedSpan = document.createElement('span');
        this.objectSelectedSpan.classList.add(styles.info_selected_count);
        this.objectTotalSpan = document.createElement('span');

        const objectLogoSVG = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const objectLogoUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        objectLogoSVG.setAttribute('width', '12px');
        objectLogoSVG.setAttribute('height', '12px');
        objectLogoUse.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `${icons}#versions_16`);
        objectLogoSVG.appendChild(objectLogoUse);

        // Set up containers
        this.rootElement.classList.add(styles.candidate_container);
        this.iconElement.classList.add(styles.candidate_icon);
        this.nameElement.classList.add(styles.candidate_name);
        this.infoElement.classList.add(styles.info_container);
        this.navContainerElement.classList.add(styles.info_nav_container);
        this.navArrowLeftElement.classList.add(styles.info_nav_left);
        this.navArrowRightElement.classList.add(styles.info_nav_right);
        this.objectContainerElement.classList.add(styles.info_object_container);

        this.iconElement.textContent = getCandidateTypeSymbolText(candidate.candidateType);
        this.iconElement.style.backgroundColor = getCandidateTypeSymbolColor(candidate.candidateType);

        // Wire containers
        this.navContainerElement.appendChild(this.navArrowLeftElement);
        this.navContainerElement.appendChild(this.navArrowRightElement);
        this.objectContainerElement.appendChild(objectLogoSVG);
        this.objectContainerElement.appendChild(this.objectSelectedSpan);
        this.objectContainerElement.appendChild(this.objectTotalSpan);
        this.infoElement.appendChild(this.navContainerElement);
        this.infoElement.appendChild(this.objectContainerElement);
        this.rootElement.appendChild(this.iconElement);
        this.rootElement.appendChild(this.nameElement);
        this.rootElement.appendChild(this.infoElement);

        this.render(candidate);
    }

    // Destroy the node
    public destroy() {
        this.rootElement.remove();
    }

    /// Helper to hide the candidate info (if not already hidden)
    protected hideInfoContainer() {
        if (this.infoVisible) {
            this.infoElement.classList.add(styles.hidden);
            this.infoVisible = false;
        }
    }
    /// Helper to hide the object selection (if not already hidden)
    protected hideSelectedObject() {
        if (this.objectSelectionVisible) {
            this.objectSelectedSpan.classList.add(styles.hidden);
            this.objectSelectionVisible = false;
        }
    }
    /// Helper to hide the object container (if not already hidden)
    protected hideObjectContainer() {
        if (this.objectContainerVisible) {
            this.objectContainerElement.classList.add(styles.hidden);
            this.objectContainerVisible = false;
        }
    }
    /// Helper to show the candidate info (if not already hidden)
    protected showInfoContainer() {
        if (!this.infoVisible) {
            this.infoElement.classList.remove(styles.hidden);
            this.infoVisible = true;
        }
    }
    /// Helper to show the object selection (if not already hidden)
    protected showSelectedObject() {
        if (!this.objectSelectionVisible) {
            this.objectSelectedSpan.classList.remove(styles.hidden);
            this.objectSelectionVisible = true;
        }
    }
    /// Helper to show the object container (if not already hidden)
    protected showObjectContainer() {
        if (!this.objectContainerVisible) {
            this.objectContainerElement.classList.remove(styles.hidden);
            this.objectContainerVisible = true;
        }
    }
    protected hideNavigation() {
        if (!this.navVisible) return;
        this.navContainerElement.classList.add(styles.hidden);
        this.navVisible = false;
    }
    protected showNavigation() {
        if (this.navVisible) return;
        this.navContainerElement.classList.remove(styles.hidden);
        this.navVisible = true;
    }
    public render(candidate: VirtualCandidate) {
        // Is the element selected?
        if (candidate.isSelected != this.rendered?.isSelected) {
            if (candidate.isSelected) {
                this.rootElement.classList.add(styles.selected);
            } else {
                this.rootElement.classList.remove(styles.selected);
            }
        }
        // Does the label differ?
        if (candidate.candidateLabel != this.rendered?.candidateLabel) {
            this.nameElement.textContent = candidate.candidateLabel;
        }
        // Does the object type differ?
        if (candidate.candidateType != this.rendered?.candidateType) {
            this.iconElement.textContent = getCandidateTypeSymbolText(candidate.candidateType);
            this.iconElement.style.backgroundColor = getCandidateTypeSymbolColor(candidate.candidateType);
        }
        // Is selected and has selectable?
        const anySelectable = candidate.totalObjectCount > 0;
        if (candidate.isSelected && anySelectable) {
            this.showInfoContainer();
        } else {
            this.hideInfoContainer();
        }
        // Update selected object?
        if (candidate.selectedCatalogObject == null) {
            this.hideSelectedObject();
        } else if (candidate.selectedCatalogObject != this.rendered?.selectedCatalogObject) {
            this.showSelectedObject();
            this.objectSelectedSpan.textContent = (candidate.selectedCatalogObject + 1).toString();
        }
        // Update the total object count
        if (candidate.totalObjectCount != this.rendered?.totalObjectCount) {
            this.objectTotalSpan.textContent = candidate.totalObjectCount.toString();
        }
        // Check object totals
        if (candidate.totalObjectCount > 0) {
            this.showObjectContainer();
        } else {
            this.hideObjectContainer();
        }
        if (candidate.totalObjectCount > 1) {
            this.showNavigation();
        } else {
            this.hideNavigation();
        }
        this.rendered = candidate;
    }
}

export class CandidateListRenderer {
    /// Is the list shown?
    rootVisible: boolean;
    /// The list position
    rootPosition: Position;

    /// The overlay container
    public readonly rootElement: HTMLDivElement;
    /// The list container
    readonly listContainer: HTMLDivElement;
    /// The list entries
    readonly renderedCandidates: CandidateRenderer[];
    /// The pane next to the list
    readonly details: CandidateDetailsRenderer;
    readonly selectPreviousVariant: () => void;
    readonly selectNextVariant: () => void;

    constructor(selectPreviousVariant: () => void, selectNextVariant: () => void) {
        this.rootVisible = true;
        this.rootPosition = { top: null, bottom: null, left: -1 };
        this.selectPreviousVariant = selectPreviousVariant;
        this.selectNextVariant = selectNextVariant;

        this.rootElement = document.createElement('div');
        this.rootElement.className = styles.overlay_container;
        this.rootElement.dataset.dashqlCompletionList = 'true';
        this.listContainer = document.createElement('div');
        this.listContainer.className = styles.list_container;
        this.details = new CandidateDetailsRenderer();
        this.rootElement.appendChild(this.listContainer);
        this.rootElement.appendChild(this.details.rootElement);
        // A click must not take the focus from the input, that ends the completion. Scrolling still works.
        this.rootElement.addEventListener('mousedown', event => event.preventDefault());

        this.renderedCandidates = [];

        this.hide();
    }

    public destroy() {
        this.rootElement.remove();
    }

    /// Is hidden?
    public get isHidden() { return !this.rootVisible; }
    /// Hide the list (if shown)
    public hide() {
        if (this.rootVisible) {
            this.rootElement.classList.add(styles.hidden);
            this.rootVisible = false;
        }
    }
    /// Show the list (if hidden)
    public show() {
        if (!this.rootVisible) {
            this.rootElement.classList.remove(styles.hidden);
            this.rootVisible = true;
        }
    }
    /// Update the position
    public updatePosition(position: Position) {
        if (this.rootPosition.top !== position.top || this.rootPosition.bottom !== position.bottom || this.rootPosition.left !== position.left) {
            if (position.bottom !== null) {
                this.rootElement.style.top = '';
                this.rootElement.style.bottom = `${position.bottom}px`;
            } else {
                this.rootElement.style.bottom = '';
                this.rootElement.style.top = `${position.top ?? 0}px`;
            }
            this.rootElement.style.left = `${position.left}px`;
            this.rootPosition = position;
        }
    }
    /// Update the candidates
    public updateCandidates(candidates: VirtualCandidate[]) {
        // Reuse rendered candidates
        const n = Math.min(candidates.length, this.renderedCandidates.length);
        for (let i = 0; i < n; ++i) {
            const rendered = this.renderedCandidates[i];
            rendered.render(candidates[i]);
        }
        // Delete excess rendered
        const dead = this.renderedCandidates.splice(n, this.renderedCandidates.length - n);
        for (let i = 0; i < dead.length; ++i) {
            this.listContainer.removeChild(dead[i].rootElement);
            dead[i].destroy();
        }
        // Create new rendered
        for (let i = n; i < candidates.length; ++i) {
            const entry = new CandidateRenderer(candidates[i], this.selectPreviousVariant, this.selectNextVariant);
            this.listContainer.appendChild(entry.rootElement);
            this.renderedCandidates.push(entry);
        }
        // Render what is known about the selected candidate, and keep that candidate in view
        const selected = candidates.findIndex(c => c.isSelected);
        this.details.render(candidates[selected] ?? null);
        this.renderedCandidates[selected]?.rootElement.scrollIntoView({ block: 'nearest' });
    }
    /// Fit the rendered list into the window: the pane is the first to go, then the list moves away from the cursor
    public fitIntoWindow(position: Position): Position {
        const windowWidth = window.innerWidth;
        // The pane shrinks to its min-width first, the content then overflows the list
        if (this.details.isVisible && this.rootElement.scrollWidth > windowWidth) {
            this.details.hide();
        }
        const left = Math.max(0, Math.min(position.left, windowWidth - this.rootElement.offsetWidth));
        return { ...position, left };
    }
}

/// The position of the list for the box of the replaced text, in viewport coordinates.
/// Below the text, or above if there is less space below than the list needs. The width is only known after rendering,
/// see fitIntoWindow.
export function placeBelowOrAbove(anchor: { left: number, top: number, bottom: number }): Position {
    // The height for overflow checks
    const boxHeight = 240; // max-height from CSS

    // The anchor has viewport coordinates, which map 1:1 to position:fixed.
    const windowHeight = window.innerHeight;

    // Flip to above if there's insufficient space below.
    // Use CSS `bottom` positioning so the list anchors above the cursor line.
    const spaceBelow = windowHeight - (anchor.bottom + 5);
    const spaceAbove = anchor.top - 5;
    const renderAbove = spaceBelow < boxHeight && spaceAbove > spaceBelow;
    const left = anchor.left;

    if (renderAbove) {
        // position:fixed bottom = distance from viewport bottom to list's bottom edge.
        // We want the list's bottom edge 5px above the cursor's top.
        const bottom = windowHeight - anchor.top + 5;
        return { top: null, bottom: Math.max(0, bottom), left };
    } else {
        const top = anchor.bottom + 5;
        return { top, bottom: null, left };
    }
}

/// Collect the candidates
export function collectCandidates(completion: dashql.buffers.completion.Completion, selectedCandidate: number, selectedCatalogObject: number | null): VirtualCandidate[] {
    const out: VirtualCandidate[] = [];
    const tmpCandidate = new dashql.buffers.completion.CompletionCandidate();
    const tmpCatalogObject = new dashql.buffers.completion.CompletionCandidateObject();
    const tmpInfo = new dashql.buffers.completion.CompletionCandidateInfo();

    for (let i = 0; i < completion.candidatesLength(); ++i) {
        const ca = completion.candidates(i, tmpCandidate)!;
        const isSelected = i === selectedCandidate;
        const objectCount = ca.catalogObjectsLength();
        // The selected candidate shows its selected object, the others their first one
        const selectedObject = isSelected && objectCount > 0 && selectedCatalogObject != null && selectedCatalogObject < objectCount
            ? selectedCatalogObject
            : null;
        const object = objectCount > 0 ? ca.catalogObjects(selectedObject ?? 0, tmpCatalogObject)! : null;
        const info = object != null ? object.info(tmpInfo) : ca.info(tmpInfo);
        out.push({
            candidateLabel: ca.displayText()!,
            candidateType: getCandidateType(ca, object),
            // An info only exists if it says something, the core doesn't pack an empty one
            details: isSelected && info != null ? readCandidateDetails(info) : null,
            isSelected,
            totalObjectCount: objectCount,
            selectedCatalogObject: selectedObject,
        });
    }
    return out;
}
