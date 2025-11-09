import * as dashql from '@ankoh/dashql-core';

const SVG_NS = "http://www.w3.org/2000/svg";

export class PlanRenderingSymbols {
    /// The root center node
    rootContainer: SVGElement;
    /// The svg group
    symbolGroup: SVGGElement;
    /// The layout config
    layoutConfig: dashql.buffers.view.DerivedPlanLayoutConfigT;

    /// The indicator for `running`
    indicatorRunning: SVGSymbolElement | null;
    /// The indicator for `none`
    indicatorNone: SVGSymbolElement | null;
    /// The indicator for `failed`
    indicatorFailed: SVGSymbolElement | null;
    /// The indicator for `succeeded`
    indicatorSucceeded: SVGSymbolElement | null;
    /// The indicator for `skipped`
    indicatorSkip: SVGSymbolElement | null;

    constructor(root: SVGElement, layoutConfig: dashql.buffers.view.DerivedPlanLayoutConfigT) {
        this.rootContainer = root;
        this.symbolGroup = document.createElementNS(SVG_NS, 'g');
        this.layoutConfig = layoutConfig;
        this.rootContainer.appendChild(this.symbolGroup);
        this.indicatorRunning = null;
        this.indicatorNone = null;
        this.indicatorFailed = null;
        this.indicatorSucceeded = null;
        this.indicatorSkip = null;
    }

    public getStatusSucceeded(x: number, y: number, width: number, height: number): SVGElement {
        const symbolName = "status_succeeded";
        if (this.indicatorSucceeded == null) {
            this.indicatorSucceeded = document.createElementNS(SVG_NS, 'symbol');
            this.indicatorSucceeded.setAttribute("id", symbolName);
            this.indicatorSucceeded.setAttribute("viewBox", "0 0 16 16");
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute("fill", "black");
            path.setAttribute("fill-rule", "evenodd");
            path.setAttribute("d", "M8 16A8 8 0 108 0a8 8 0 000 16zm3.78-9.72a.75.75 0 00-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 00-1.06 1.06l2 2a.75.75 0 001.06 0l4.5-4.5z");
            this.indicatorSucceeded.appendChild(path);
            this.symbolGroup.appendChild(this.indicatorSucceeded);
        }
        const icon = document.createElementNS(SVG_NS, "use");
        icon.setAttribute("x", x.toString());
        icon.setAttribute("y", y.toString());
        icon.setAttribute("width", width.toString());
        icon.setAttribute("height", height.toString());
        icon.setAttribute("href", `#${symbolName}`);
        return icon;
    }

    public getStatusRunning(x: number, y: number, width: number, height: number): SVGElement {
        const symbolName = "status_running";
        if (this.indicatorRunning == null) {
            this.indicatorRunning = document.createElementNS(SVG_NS, 'symbol');
            this.indicatorRunning.setAttribute("id", symbolName);
            this.indicatorRunning.setAttribute("viewBox", "-8 -8 16 16");
            this.indicatorRunning.setAttribute("fill", "none");

            const c0 = document.createElementNS(SVG_NS, 'circle');
            const c1 = document.createElementNS(SVG_NS, 'circle');
            const c2 = document.createElementNS(SVG_NS, 'circle');
            c0.setAttribute("cx", "0");
            c0.setAttribute("cy", "0");
            c0.setAttribute("r", "7");
            c0.setAttribute("opacity", "0.5");
            c0.setAttribute("stroke-width", "2");
            c0.setAttribute("stroke", "black");
            c1.setAttribute("cx", "0");
            c1.setAttribute("cy", "0");
            c1.setAttribute("r", "4");
            c1.setAttribute("stroke-width", "0");
            c1.setAttribute("fill", "black");
            c2.setAttribute("cx", "0");
            c2.setAttribute("cy", "0");
            c2.setAttribute("r", "7");
            c2.setAttribute("stroke-width", "2");
            c2.setAttribute("stroke-dasharray", "12, 88");
            c2.setAttribute("stroke", "black");
            this.indicatorRunning.appendChild(c0);
            this.indicatorRunning.appendChild(c1);
            this.indicatorRunning.appendChild(c2);
            this.symbolGroup.appendChild(this.indicatorRunning);
        }

        const g = document.createElementNS(SVG_NS, "g");

        const icon = document.createElementNS(SVG_NS, "use");
        icon.setAttribute("x", x.toString());
        icon.setAttribute("y", y.toString());
        icon.setAttribute("width", width.toString());
        icon.setAttribute("height", height.toString());
        icon.setAttribute("href", `#${symbolName}`);

        const anim = document.createElementNS(SVG_NS, "animateTransform");
        anim.setAttribute("attributeName", "transform");
        anim.setAttribute("type", "rotate");
        anim.setAttribute("from", `0 ${x + width / 2} ${y + height / 2}`);
        anim.setAttribute("to", `360 ${x + width / 2} ${y + height / 2}`);
        anim.setAttribute("dur", "1s");
        anim.setAttribute("repeatCount", "indefinite");

        g.appendChild(icon);
        g.appendChild(anim);
        return g;
    }
}
