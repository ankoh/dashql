import * as React from 'react';

import type { EditorView } from '@codemirror/view';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { useWorkbookDerived } from '@akohn/dashql-react/hooks';
import type { ModifyWorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { WorkbookInputCard } from './workbook_input_card.js';
import { useApplyWorkbookInput } from './use_apply_workbook_input.js';

import * as styles from './workbook_inputs.module.css';

/// A scalar parameter in an editor whose input the overlay edits
export interface WorkbookInputOverlayTarget {
    /// The name of the input
    name: string;
    /// The editor that shows the parameter and the span of the parameter in its document
    view: EditorView;
    from: number;
    to: number;
}

interface Props {
    workbookId: string;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    /// The parameter, null while the overlay is closed
    target: WorkbookInputOverlayTarget | null;
    /// The positioned element that holds the anchor of the overlay
    containerRef: React.RefObject<HTMLElement | null>;
    /// The element that scrolls the editor, the overlay follows the parameter and closes once it leaves the element
    getScrollElement: () => HTMLElement | null;
    onClose: () => void;
}

interface AnchorBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

/// The input of a scalar parameter of a script in an overlay below the parameter, the same card as in the strip of the
/// inputs. The overlay follows the parameter while the feed scrolls and closes once the parameter is out of view.
export function WorkbookInputOverlay(props: Props): React.ReactElement | null {
    const { target, containerRef, getScrollElement, onClose } = props;
    const derived = useWorkbookDerived(props.workbookId);
    const input = target == null ? null : derived?.inputs.find(i => i.name === target.name) ?? null;
    const { apply, literalOf, busyInputs } = useApplyWorkbookInput(props.workbookId, props.modifyWorkbookScripts);

    const anchorRef = React.useRef<HTMLSpanElement>(null);
    const returnFocusRef = React.useRef<HTMLElement | null>(null);
    returnFocusRef.current = target?.view.contentDOM ?? null;
    const [anchor, setAnchor] = React.useState<AnchorBox | null>(null);
    const [revision, setRevision] = React.useState(0);

    // The box of the parameter in the container, null if it is out of view
    const measure = React.useCallback((): AnchorBox | null => {
        const container = containerRef.current;
        const scroll = getScrollElement();
        if (target == null || container == null || !target.view.dom.isConnected) return null;
        const start = target.view.coordsAtPos(target.from, 1);
        const end = target.view.coordsAtPos(target.to, -1);
        if (start == null || end == null) return null;
        const bounds = (scroll ?? container).getBoundingClientRect();
        if (start.bottom < bounds.top || start.top > bounds.bottom) return null;
        const origin = container.getBoundingClientRect();
        const right = end.top === start.top ? end.right : start.left;
        return {
            left: start.left - origin.left,
            top: start.top - origin.top,
            width: Math.max(1, right - start.left),
            height: start.bottom - start.top,
        };
    }, [target, containerRef, getScrollElement]);

    const follow = React.useCallback(() => {
        const box = measure();
        if (box == null) {
            onClose();
            return;
        }
        setAnchor(box);
        setRevision(r => r + 1);
    }, [measure, onClose]);

    React.useLayoutEffect(() => {
        if (target == null) {
            setAnchor(null);
            return;
        }
        follow();
        const scroll = getScrollElement();
        if (scroll == null) return;
        scroll.addEventListener('scroll', follow, { passive: true });
        return () => scroll.removeEventListener('scroll', follow);
    }, [target, follow, getScrollElement]);

    // A parameter that is no input, e.g. while the analysis lags behind the text, opens nothing
    React.useEffect(() => {
        if (target != null && derived != null && input == null) onClose();
    }, [target, derived, input, onClose]);

    if (target == null || input == null || anchor == null) return null;
    return (
        <>
            <span
                ref={anchorRef}
                className={styles.overlay_anchor}
                style={{ left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height }}
                aria-hidden="true"
            />
            <AnchoredOverlay
                open
                renderAnchor={null}
                anchorRef={anchorRef}
                returnFocusRef={returnFocusRef}
                onClose={onClose}
                side={AnchorSide.OutsideBottom}
                align={AnchorAlignment.Start}
                anchorOffset={6}
                positionRevision={revision}
            >
                <div className={styles.overlay} role="dialog" aria-label={`Input :${input.name}`} data-testid="workbook-input-overlay">
                    <WorkbookInputCard
                        input={input}
                        busy={busyInputs.has(input.name)}
                        literalOf={literalOf}
                        onCommit={apply}
                    />
                </div>
            </AnchoredOverlay>
        </>
    );
}
