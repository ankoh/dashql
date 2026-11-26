import * as React from 'react';

/// The presses inside a card: its root element spreads `onPointerDownCapture`, which marks them. The target keeps its
/// identity, a memoized part of the card takes it.
export interface EagerDismissTarget {
    onPointerDownCapture: () => void;
    /// Did the press that reaches the document start inside the card?
    pressedInside: React.RefObject<boolean>;
}

/// The target of the presses inside a card, see `useEagerDismiss`
export function useEagerDismissTarget(): EagerDismissTarget {
    const pressedInside = React.useRef(false);
    return React.useMemo(() => ({
        onPointerDownCapture: () => { pressedInside.current = true; },
        pressedInside,
    }), []);
}

/// Dismiss what a card shows for a moment, e.g. the more rows of its table, as soon as the user turns to something
/// else: a pointer press outside of the card, or Escape that nothing else handled (an overlay or an editor prevents
/// its default). A popup of the card, e.g. the detail of a cell or the search of the table, belongs to the card: React
/// bubbles the events of a portal through the card although the portal lies outside of it, so the card marks the
/// presses that reach it (`useEagerDismissTarget`) and the document dismisses the others.
export function useEagerDismiss(target: EagerDismissTarget, active: boolean, onDismiss: () => void): void {
    const { pressedInside } = target;
    const dismiss = React.useEffectEvent(onDismiss);
    React.useEffect(() => {
        if (!active) return;
        // Every press starts outside, the card marks it before it reaches the document. A press that something inside
        // stops never reaches the document, the next press starts over.
        const reset = () => { pressedInside.current = false; };
        const onPointerDown = () => {
            if (!pressedInside.current) dismiss();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !event.defaultPrevented) dismiss();
        };
        document.addEventListener('pointerdown', reset, { capture: true });
        document.addEventListener('pointerdown', onPointerDown);
        // On the window, after the listeners of the overlays on the document
        window.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', reset, { capture: true });
            document.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [active, pressedInside]);
}
