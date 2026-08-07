export function fakeScriptEditorModule(React: typeof import('react'), state: { composeEditorFocused: boolean }) {
    return {
        ScriptEditor: (props: { setView?: (view: { hasFocus: boolean }) => void }) => {
            React.useEffect(() => {
                props.setView?.({ hasFocus: state.composeEditorFocused });
            }, [props.setView]);
            return React.createElement('div', { 'data-testid': 'script-editor' }, 'editor');
        },
    };
}

export function fakeScriptPreviewModule(React: typeof import('react')) {
    return {
        ScriptPreview: () => React.createElement(
            'div',
            { 'data-testid': 'script-preview' },
            'preview',
            React.createElement('button', { 'data-dashql-story-control': 'true' }, 'SQL'),
        ),
    };
}

export function fakeButtonModule(React: typeof import('react')) {
    return {
        ButtonSize: { Small: 0, Medium: 1, Large: 2 },
        ButtonVariant: { Default: 0, Primary: 1, Danger: 2, Invisible: 3, Outline: 4 },
        Button: React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>((props, ref) => React.createElement('button', { ...props, ref }, props.children)),
        IconButton: React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>((props, ref) => React.createElement('button', { ...props, ref }, props.children)),
    };
}

export function fakeStatusIndicatorModule(React: typeof import('react')) {
    return {
        IndicatorStatus: { Succeeded: 'succeeded' },
        StatusIndicator: () => React.createElement('span', { 'data-testid': 'status-indicator' }),
    };
}

export function fakeSymbolIconModule(React: typeof import('react')) {
    return {
        SymbolIcon: () => () => React.createElement('span', { 'data-testid': 'symbol-icon' }),
    };
}

export function fakeSizeObserverModule() {
    return {
        observeSize: () => ({ width: 640, height: 480 }),
    };
}

export function fakeScrollbarModule() {
    return {
        useScrollbarWidth: () => 17,
        useScrollbarHeight: () => 0,
    };
}

export function fakeReactWindowModule(
    React: typeof import('react'),
    scrollToRowMock: (...args: any[]) => any,
) {
    return {
        useListRef: () => React.useRef({ scrollToRow: scrollToRowMock }),
        List: (props: {
            rowCount: number;
            rowHeight: (rowIndex: number) => number;
            rowComponent: React.ComponentType<any>;
            rowProps: any;
            style?: React.CSSProperties;
        }) => {
            const children = Array.from({ length: props.rowCount }, (_, index) => React.createElement(
                'div',
                {
                    key: index,
                    'data-row-height': props.rowHeight(index),
                    'data-row-script-id': index > 0 && index <= props.rowProps.entries.length
                        ? props.rowProps.entries[index - 1].scriptId
                        : undefined,
                },
                React.createElement(props.rowComponent, {
                    index,
                    style: { height: props.rowHeight(index) },
                    ...props.rowProps,
                }),
            ));
            return React.createElement('div', { 'data-testid': 'mock-list', style: props.style }, children);
        },
    };
}

export class ResizeObserverMock {
    observe() { }
    disconnect() { }
    unobserve() { }
}

/// Inert IntersectionObserver stand-in for jsdom (which provides none). It records the callback but
/// never fires it, so a component's "on visible" effect stays dormant in tests that don't opt in. A
/// test that wants to simulate a card scrolling into view can capture the instance and invoke its
/// callback directly with a synthetic `[{ isIntersecting: true }]` entry.
export class IntersectionObserverMock {
    callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
    }
    observe() { }
    disconnect() { }
    unobserve() { }
    takeRecords(): IntersectionObserverEntry[] { return []; }
}
