import { EditorView, keymap, KeyBinding, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { DASHQL_COMPLETION_APPLIED_CANDIDATE, DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE, DASHQL_COMPLETION_APPLIED_TEMPLATE, DASHQL_COMPLETION_AVAILABLE, DashQLProcessorPlugin } from './dashql_processor.js';
import { Prec } from '@codemirror/state';

type ScrollListener = (event: Event) => void;

interface ListenerTarget {
    /// The tom
    dom: HTMLElement;
    /// The target for scroll events
    scrollDOM: HTMLElement;
    /// The listener for scroll events
    scrollListener: ScrollListener;
};

class DashQLCompletionEventListener {
    /// Listener target
    listenerTarget: ListenerTarget | null = null;

    // Start listening
    private startListening(view: EditorView) {
        if (this.listenerTarget != null) {
            return;
        }
        const onScroll = this.handleScrollEvent.bind(this);
        this.listenerTarget = {
            dom: view.dom,
            scrollDOM: view.scrollDOM,
            scrollListener: onScroll
        };
        view.scrollDOM.addEventListener('scroll', onScroll);

        console.log('Started listening to key and scroll events');
    }

    private stopListening() {
        if (this.listenerTarget == null) {
            return;
        }
        this.listenerTarget.scrollDOM.removeEventListener('scroll', this.listenerTarget.scrollListener);
        this.listenerTarget = null;

        console.log('Stopped listening to key and scroll events');
    }


    private handleScrollEvent(_event: Event) {
        if (this.listenerTarget == null) {
            return;
        }
        console.log('Scroll event detected:', {
            scrollTop: this.listenerTarget.scrollDOM.scrollTop,
            scrollLeft: this.listenerTarget.scrollDOM.scrollLeft
        });

        // TODO: Add scroll-related completion logic here
        // This could be used to hide/show completion popups, update positions, etc.
    }

    update(update: ViewUpdate) {
        const processor = update.state.field(DashQLProcessorPlugin);
        switch (processor.scriptCompletion?.type) {
            case DASHQL_COMPLETION_AVAILABLE:
            case DASHQL_COMPLETION_APPLIED_CANDIDATE:
            case DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE:
            case DASHQL_COMPLETION_APPLIED_TEMPLATE:
                this.startListening(update.view);
                break;
            default:
                this.stopListening();
                break;
        }
    }

    destroy() {
        this.stopListening();
    }
};

function hasActiveCompletion(view: EditorView): boolean {
    const processor = view.state.field(DashQLProcessorPlugin);
    switch (processor.scriptCompletion?.type) {
        case DASHQL_COMPLETION_AVAILABLE:
        case DASHQL_COMPLETION_APPLIED_CANDIDATE:
        case DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE:
        case DASHQL_COMPLETION_APPLIED_TEMPLATE:
            return true;
        default:
            return false;
    }
}

function onEnter(view: EditorView) {
    console.log('Enter key pressed - this is where completion logic will go');
    if (hasActiveCompletion(view)) {

        return true;
    }
    return false;
}

function onTab(view: EditorView) {
    console.log('Tab key pressed - this is where completion logic will go');
    if (hasActiveCompletion(view)) {

        return true;
    }
    return false;
}

const KEYBINDINGS: KeyBinding[] = [{ key: "Enter", run: onEnter }, { key: "Tab", run: onTab }];
const KEYMAP = Prec.highest(keymap.of(KEYBINDINGS));

export const DashQLCompletionListenerPlugin = [
    Prec.highest(ViewPlugin.fromClass(DashQLCompletionEventListener)),
    Prec.highest(KEYMAP),
];
