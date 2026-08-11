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

export function fakeScriptPreviewModule(React: typeof import('react'), state?: { previewReady: boolean; previewFormattable?: boolean }) {
    return {
        ScriptPreview: (props: { onReady?: (ready: boolean) => void; onFormattedText?: (text: string) => void; onFormattingStatus?: (formattable: boolean) => void }) => {
            React.useEffect(() => {
                props.onFormattedText?.('formatted preview');
                props.onFormattingStatus?.(state?.previewFormattable ?? true);
                if (state?.previewReady ?? true) props.onReady?.(true);
            }, [props.onFormattedText, props.onFormattingStatus, props.onReady]);
            return React.createElement(
                'div',
                { 'data-testid': 'script-preview' },
                'preview',
                React.createElement('button', { 'data-dashql-story-control': 'true' }, 'SQL'),
            );
        },
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
                    'data-row-script-id': index < props.rowProps.entries.length
                        ? props.rowProps.entries[index].scriptId
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
    static instances: ResizeObserverMock[] = [];
    private callback: ResizeObserverCallback;
    private elements = new Set<Element>();

    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        ResizeObserverMock.instances.push(this);
    }

    observe(element: Element) { this.elements.add(element); }
    disconnect() { }
    unobserve(element: Element) { this.elements.delete(element); }

    trigger() {
        this.callback(Array.from(this.elements, target => ({ target }) as ResizeObserverEntry), this as unknown as ResizeObserver);
    }

    static reset() { ResizeObserverMock.instances = []; }

    static triggerAll() { ResizeObserverMock.instances.forEach(instance => instance.trigger()); }
}
