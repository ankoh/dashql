import * as dashql from '@ankoh/dashql-core';
import { IndicatorStatus } from '../../view/foundations/status_indicator.js';

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

    public getStatusIcon(x: number, y: number, width: number, height: number, status: dashql.buffers.view.PlanExecutionStatus = dashql.buffers.view.PlanExecutionStatus.UNKNOWN): SVGElement {
        switch (status) {
            case dashql.buffers.view.PlanExecutionStatus.RUNNING:
                return this.getStatusIconRunning(x, y, width, height);
            case dashql.buffers.view.PlanExecutionStatus.FAILED:
                return this.getStatusIconFailed(x, y, width, height);
            case dashql.buffers.view.PlanExecutionStatus.SUCCEEDED:
                return this.getStatusIconSucceeded(x, y, width, height);
            case dashql.buffers.view.PlanExecutionStatus.SKIPPED:
                return this.getStatusIconSkip(x, y, width, height);
            case dashql.buffers.view.PlanExecutionStatus.UNKNOWN:
                return this.getStatusIconNone(x, y, width, height);
            default:
                return this.getStatusIconNone(x, y, width, height);
        }

    }

    protected getStatusIconSucceeded(x: number, y: number, width: number, height: number): SVGElement {
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

    protected getStatusIconFailed(x: number, y: number, width: number, height: number): SVGElement {
        const symbolName = "status_failed";
        if (this.indicatorSucceeded == null) {
            this.indicatorSucceeded = document.createElementNS(SVG_NS, 'symbol');
            this.indicatorSucceeded.setAttribute("id", symbolName);
            this.indicatorSucceeded.setAttribute("viewBox", "0 0 16 16");
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute("fill", "black");
            path.setAttribute("fill-rule", "evenodd");
            path.setAttribute("d", "M2.343 13.657A8 8 0 1113.657 2.343 8 8 0 012.343 13.657zM6.03 4.97a.75.75 0 00-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 101.06 1.06L8 9.06l1.97 1.97a.75.75 0 101.06-1.06L9.06 8l1.97-1.97a.75.75 0 10-1.06-1.06L8 6.94 6.03 4.97z");
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

    protected getStatusIconSkip(x: number, y: number, width: number, height: number): SVGElement {
        const symbolName = "status_skip";
        if (this.indicatorSucceeded == null) {
            this.indicatorSucceeded = document.createElementNS(SVG_NS, 'symbol');
            this.indicatorSucceeded.setAttribute("id", symbolName);
            this.indicatorSucceeded.setAttribute("viewBox", "0 0 16 16");
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute("fill", "black");
            path.setAttribute("fill-rule", "evenodd");
            path.setAttribute("d", "M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm11.333-2.167a.825.825 0 0 0-1.166-1.166l-5.5 5.5a.825.825 0 0 0 1.166 1.166Z");
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

    protected getStatusIconNone(x: number, y: number, width: number, height: number): SVGElement {
        const symbolName = "status_none";
        if (this.indicatorNone == null) {
            this.indicatorNone = document.createElementNS(SVG_NS, 'symbol');
            this.indicatorNone.setAttribute("id", symbolName);
            this.indicatorNone.setAttribute("viewBox", "-8 -8 16 16");
            this.indicatorNone.setAttribute("fill", "none");

            const c0 = document.createElementNS(SVG_NS, 'circle');
            c0.setAttribute("cx", "0");
            c0.setAttribute("cy", "0");
            c0.setAttribute("r", "4");
            c0.setAttribute("opacity", "0.5");
            c0.setAttribute("stroke-width", "0");
            c0.setAttribute("fill", "black");
            this.indicatorNone.appendChild(c0);
            this.symbolGroup.appendChild(this.indicatorNone);
        }

        const icon = document.createElementNS(SVG_NS, "use");
        icon.setAttribute("x", x.toString());
        icon.setAttribute("y", y.toString());
        icon.setAttribute("width", width.toString());
        icon.setAttribute("height", height.toString());
        icon.setAttribute("href", `#${symbolName}`);

        return icon;
    }

    protected getStatusIconRunning(x: number, y: number, width: number, height: number): SVGElement {
        const symbolName = "status_running";
        if (this.indicatorRunning == null) {
            this.indicatorRunning = document.createElementNS(SVG_NS, 'symbol');
            this.indicatorRunning.setAttribute("id", symbolName);
            this.indicatorRunning.setAttribute("viewBox", "-8 -8 16 16");
            this.indicatorRunning.setAttribute("fill", "none");

            const ring = document.createElementNS(SVG_NS, 'circle');
            const inner = document.createElementNS(SVG_NS, 'circle');
            const spinner = document.createElementNS(SVG_NS, 'circle');
            inner.setAttribute("cx", "0");
            inner.setAttribute("cy", "0");
            inner.setAttribute("r", "4");
            inner.setAttribute("stroke-width", "0");
            inner.setAttribute("fill", "black");
            ring.setAttribute("cx", "0");
            ring.setAttribute("cy", "0");
            ring.setAttribute("r", "7");
            ring.setAttribute("opacity", "0.5");
            ring.setAttribute("stroke-width", "2");
            ring.setAttribute("stroke", "black");
            spinner.setAttribute("cx", "0");
            spinner.setAttribute("cy", "0");
            spinner.setAttribute("r", "7");
            spinner.setAttribute("stroke-width", "2");
            spinner.setAttribute("stroke-dasharray", "12, 88");
            spinner.setAttribute("stroke", "black");
            this.indicatorRunning.appendChild(inner);
            this.indicatorRunning.appendChild(ring);
            this.indicatorRunning.appendChild(spinner);
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
