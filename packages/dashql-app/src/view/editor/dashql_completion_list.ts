import * as dashql from '@ankoh/dashql-core';

import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { EditorState } from '@codemirror/state';

import { DashQLCompletionState, DashQLCompletionStatus, DashQLProcessorPlugin } from './dashql_processor.js';
import { CompletionCandidateType, getCandidateTypeSymbolColor, getCandidateTypeSymbolText } from './dashql_completion_candidate_type.js';

import * as styles from './dashql_completion_list.module.css';
import icons from '../../../static/svg/symbols.generated.svg';


// This file contains a CodeMirror plugin for rendering a completion list.
// The rendering itself is virtualized but deliberately does NOT use React.
// We're implementing the view consolidation manually here.
//
// This makes the extension independent and allows separating it as library later.


interface Position {
    /// The top offset
    top: number;
    /// The left offset
    left: number;
}

interface VirtualCandidate {
    /// The candidate type.
    /// Either the object type of the selected object or the first one.
    candidateType: CompletionCandidateType | null;
    /// The candidate text
    candidateLabel: string;
    /// Is selected?
    isSelected: boolean;
    /// The total catalog objects
    totalObjectCount: number;
    /// The selected catalog object
    selectedCatalogObject: number | null;
    /// The total templates
    totalTemplateCount: number;
    /// The selected templates
    selectedTemplate: number | null;
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
    /// Selected template count visible?
    templateContainerVisible: boolean;
    /// Selected template index visible?
    templateSelectionVisible: boolean;

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
    /// The container for the template count
    readonly templateContainerElement: HTMLDivElement;
    /// The span for the selected template
    readonly templateSelectedSpan: HTMLSpanElement;
    /// The span for the template count 
    readonly templateTotalSpan: HTMLSpanElement;

    constructor(candidate: VirtualCandidate) {
        this.rendered = null;
        this.rootElement = document.createElement('div');
        this.iconElement = document.createElement('span');
        this.nameElement = document.createElement('span');
        this.infoElement = document.createElement('div');
        this.infoVisible = true;
        this.objectContainerVisible = true;
        this.objectSelectionVisible = true;
        this.templateContainerVisible = true;
        this.templateSelectionVisible = true;

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

        this.objectContainerElement = document.createElement('div');
        this.objectSelectedSpan = document.createElement('span');
        this.objectSelectedSpan.classList.add(styles.info_selected_count);
        this.objectTotalSpan = document.createElement('span');

        this.templateContainerElement = document.createElement('div');
        this.templateSelectedSpan = document.createElement('span');
        this.templateSelectedSpan.classList.add(styles.info_selected_count);
        this.templateTotalSpan = document.createElement('div');

        const objectLogoSVG = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const objectLogoUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        objectLogoSVG.setAttribute('width', '12px');
        objectLogoSVG.setAttribute('height', '12px');
        objectLogoUse.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `${icons}#versions_16`);
        objectLogoSVG.appendChild(objectLogoUse);

        const templateLogoSVG = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const templateLogoUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        templateLogoSVG.setAttribute('width', '12px');
        templateLogoSVG.setAttribute('height', '12px');
        templateLogoUse.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `${icons}#sparkle_16`);
        templateLogoSVG.appendChild(templateLogoUse);

        // Set up containers
        this.rootElement.classList.add(styles.candidate_container);
        this.iconElement.classList.add(styles.candidate_icon);
        this.nameElement.classList.add(styles.candidate_name);
        this.infoElement.classList.add(styles.info_container);
        this.navContainerElement.classList.add(styles.info_nav_container);
        this.navArrowLeftElement.classList.add(styles.info_nav_left);
        this.navArrowRightElement.classList.add(styles.info_nav_right);
        this.objectContainerElement.classList.add(styles.info_object_container);
        this.templateContainerElement.classList.add(styles.info_template_container);

        this.iconElement.textContent = getCandidateTypeSymbolText(candidate.candidateType ?? 0);
        this.iconElement.style.backgroundColor = getCandidateTypeSymbolColor(candidate.candidateType ?? 0);

        // Wire containers
        this.navContainerElement.appendChild(this.navArrowLeftElement);
        this.navContainerElement.appendChild(this.navArrowRightElement);
        this.objectContainerElement.appendChild(objectLogoSVG);
        this.objectContainerElement.appendChild(this.objectSelectedSpan);
        this.objectContainerElement.appendChild(this.objectTotalSpan);
        this.templateContainerElement.appendChild(templateLogoSVG);
        this.templateContainerElement.appendChild(this.templateSelectedSpan);
        this.templateContainerElement.appendChild(this.templateTotalSpan);
        this.infoElement.appendChild(this.navContainerElement);
        this.infoElement.appendChild(this.objectContainerElement);
        this.infoElement.appendChild(this.templateContainerElement);
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
    /// Helper to hide the template selection (if not already hidden)
    protected hideSelectedTemplate() {
        if (this.templateSelectionVisible) {
            this.templateSelectedSpan.classList.add(styles.hidden);
            this.templateSelectionVisible = false;
        }
    }
    /// Helper to hide the template container (if not already hidden)
    protected hideTemplateContainer() {
        if (this.templateContainerVisible) {
            this.templateContainerElement.classList.add(styles.hidden);
            this.templateContainerVisible = false;
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
    /// Helper to hide the template selection (if not already hidden)
    protected showSelectedTemplate() {
        if (!this.templateSelectionVisible) {
            this.templateSelectedSpan.classList.remove(styles.hidden);
            this.templateSelectionVisible = true;
        }
    }
    /// Helper to show the template container (if not already hidden)
    protected showTemplateContainer() {
        if (!this.templateContainerVisible) {
            this.templateContainerElement.classList.remove(styles.hidden);
            this.templateContainerVisible = true;
        }
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
            this.iconElement.textContent = getCandidateTypeSymbolText(candidate.candidateType ?? 0);
            this.iconElement.style.backgroundColor = getCandidateTypeSymbolColor(candidate.candidateType ?? 0);
        }
        // Is selected and has selectable?
        const anySelectable = candidate.totalObjectCount > 0 || candidate.totalTemplateCount > 0;
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
        // Update selected template?
        if (candidate.selectedTemplate == null) {
            this.hideSelectedTemplate();
        } else if (candidate.selectedTemplate != this.rendered?.selectedTemplate) {
            this.showSelectedTemplate();
            this.templateSelectedSpan.textContent = (candidate.selectedTemplate + 1).toString();
        }
        // Update the total template count
        if (candidate.totalTemplateCount != this.rendered?.totalTemplateCount) {
            this.templateTotalSpan.textContent = candidate.totalTemplateCount.toString();
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
        // Show template totals
        if (candidate.totalTemplateCount > 0) {
            this.showTemplateContainer();
        } else {
            this.hideTemplateContainer();
        }
        this.rendered = candidate;
    }
}

class CandidateListRenderer {
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

    constructor() {
        this.rootVisible = true;
        this.rootPosition = { top: -1, left: -1 };

        this.rootElement = document.createElement('div');
        this.rootElement.className = styles.overlay_container;
        this.listContainer = document.createElement('div');
        this.listContainer.className = styles.list_container;
        this.rootElement.appendChild(this.listContainer);

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
        if (this.rootPosition.top != position.top || this.rootPosition.left != position.left) {
            this.rootElement.style.top = `${position.top}px`;
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
            const entry = new CandidateRenderer(candidates[i]);
            this.listContainer.appendChild(entry.rootElement);
            this.renderedCandidates.push(entry);
        }
    }
}

class CompletionList {
    /// The list renderer
    list: CandidateListRenderer;
    /// The dom that this container is mounted to (if any)
    dom: HTMLElement | null = null;
    /// The rendered completion
    renderedCompletion: DashQLCompletionState | null = null;

    constructor() {
        this.list = new CandidateListRenderer();
    }
    /// Destroy the container
    destroy() {
        this.unmount();
        this.list.destroy();
    }
    /// Unmount a completion list container
    unmount() {
        if (this.dom) {
            this.dom.removeChild(this.list.rootElement);
            this.dom = null;
        }
    }
    /// Mount a completion list container
    mount(dom: HTMLElement) {
        if (this.dom == dom) {
            return;
        }
        this.unmount();
        dom.appendChild(this.list.rootElement);
        this.dom = dom;
    }
    /// Helper to compute a position
    static computePosition(view: EditorView, offset: number): (Position | null) {
        const candidateCoords = view.coordsAtPos(offset);
        if (candidateCoords == null) return null;

        // Get the editor's DOM rect for proper positioning
        const editorRect = view.dom.getBoundingClientRect();

        // Calculate position relative to the editor container
        let left = candidateCoords.left - editorRect.left;
        let top = candidateCoords.bottom - editorRect.top + 5; // 5px below cursor

        // Estimate box dimensions for overflow checks
        const boxWidth = 50;
        const boxHeight = 240; // max-height from CSS

        // Use window viewport for overflow checks, not the scrollDOM
        // (scrollDOM may have overflow:visible and minimal height, e.g. in prompt editors)
        const windowHeight = window.innerHeight;
        const windowWidth = window.innerWidth;

        // Check if the box would overflow the window viewport (using screen coordinates)
        const boxScreenTop = candidateCoords.bottom + 5;
        const boxScreenLeft = candidateCoords.left;

        // Adjust vertical position if it would overflow the window
        // Only flip to above if there's actually more room above than below
        const spaceBelow = windowHeight - boxScreenTop;
        const spaceAbove = candidateCoords.top;
        if (spaceBelow < boxHeight && spaceAbove > spaceBelow) {
            // Position above the cursor
            top = candidateCoords.top - editorRect.top - boxHeight - 5;
        }

        // Adjust horizontal position if it would overflow the window
        if (boxScreenLeft + boxWidth > windowWidth) {
            left = candidateCoords.left - editorRect.left - boxWidth;
        }

        // Ensure we don't go negative
        left = Math.max(0, left);
        top = Math.max(0, top);

        return { left, top };
    }

    /// Collect the candidates
    collectCandidates(completion: dashql.buffers.completion.Completion, selectedCandidate: number, selectedCatalogObject: number | null, selectedTemplate: number | null): VirtualCandidate[] {
        const out: VirtualCandidate[] = [];
        const tmpCandidate = new dashql.buffers.completion.CompletionCandidate();
        const tmpCatalogObject = new dashql.buffers.completion.CompletionCandidateObject();

        // Collect the candidates
        for (let i = 0; i < completion.candidatesLength(); ++i) {
            const ca = completion.candidates(i, tmpCandidate)!;
            let totalObjects = ca.catalogObjectsLength();
            let totalTemplates = 0;
            for (let j = 0; j < ca.catalogObjectsLength(); ++j) {
                const co = ca.catalogObjects(j, tmpCatalogObject)!;
                totalTemplates += co.scriptTemplatesLength();
            }
            let objectType: dashql.buffers.completion.CompletionCandidateObjectType | null = null;
            if (ca.catalogObjectsLength() > 0) {
                const co = ca.catalogObjects(0, tmpCatalogObject)!;
                objectType = co.objectType();
            }
            out.push({
                candidateLabel: ca.displayText()!,
                candidateType: (objectType as number) as CompletionCandidateType,
                isSelected: false,
                totalObjectCount: totalObjects,
                selectedCatalogObject: null,
                totalTemplateCount: totalTemplates,
                selectedTemplate: null,
            });
        }

        // Mark selected
        if (selectedCandidate >= out.length) {
            out[selectedCandidate].isSelected = true;
        }

        // Update the selected candidate
        const ca = completion.candidates(selectedCandidate, tmpCandidate)!;
        if (selectedCatalogObject != null) {
            const co = ca.catalogObjects(selectedCatalogObject, tmpCatalogObject)!;
            const o = out[selectedCandidate];
            o.selectedCatalogObject = selectedCatalogObject;
            const ot = co.objectType();
            o.candidateType = (ot == dashql.buffers.completion.CompletionCandidateObjectType.NONE)
                ? null
                : (ot as number) as CompletionCandidateType;
            o.isSelected = true;
            o.selectedTemplate = selectedTemplate;
            o.totalObjectCount = ca.catalogObjectsLength();
            o.totalTemplateCount = co.scriptTemplatesLength();
        }
        return out;
    }

    /// Update the completion list
    update(view: EditorView, state: EditorState) {
        const processor = state.field(DashQLProcessorPlugin);

        // Short-circuit noops
        if (this.renderedCompletion === processor.scriptCompletion) {
            return;
        }
        this.renderedCompletion = processor.scriptCompletion;

        // Hide completion?
        if (processor.scriptCompletion?.status !== DashQLCompletionStatus.AVAILABLE) {
            if (!this.list.isHidden) {
                view.requestMeasure<(Position | null)>({
                    read: (_view) => null,
                    write: (_null, _view) => {
                        this.list.hide();
                    }
                });
            }
            return;
        }
        const selectedCandidate = processor.scriptCompletion.candidateId;
        const selectedCatalogObject = processor.scriptCompletion.catalogObjectId ?? null;
        const selectedTemplate = processor.scriptCompletion.templateId ?? null;

        // Invalid candidate?
        const completion = processor.scriptCompletion;
        const completionBuffer = completion.buffer.read();
        if (completion.candidateId >= completionBuffer.candidatesLength()) {
            return;
        }
        // Current candidate
        const candidate = completionBuffer.candidates(completion.candidateId);
        if (candidate == null) {
            return;
        }
        const candidateLoc = candidate.targetLocation()!;
        const candidateLocOffset = candidateLoc.offset();

        // Collect all candidates
        const pending = this.collectCandidates(completionBuffer, selectedCandidate, selectedCatalogObject, selectedTemplate);

        // Update the container position
        view.requestMeasure<(Position | null)>({
            read: (view) => {
                return CompletionList.computePosition(view, candidateLocOffset);
            },
            write: (pos: Position, _view) => {
                this.list.show();
                this.list.updatePosition(pos);
                this.list.updateCandidates(pending);
            }
        });
    }
}

export const DashQLCompletionListPlugin = ViewPlugin.fromClass(
    class {
        container: CompletionList;

        constructor(_view: EditorView) {
            this.container = new CompletionList();
        }
        update(update: ViewUpdate) {
            this.container.mount(update.view.dom);
            this.container.update(update.view, update.state);
        }
        destroy() {
            this.container.destroy();
        }
    }
);
