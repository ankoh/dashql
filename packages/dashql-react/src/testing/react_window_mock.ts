/// A react-window module for tests: a List that renders every row with its row component, and list refs whose
/// scrollToRow is the given mock
export function fakeReactWindowModule(
    React: typeof import('react'),
    scrollToRowMock: (...args: any[]) => any,
) {
    return {
        useListRef: () => React.useRef({ scrollToRow: scrollToRowMock }),
        useListCallbackRef: (_initialValue: unknown) => React.useState({
            element: null,
            scrollToRow: scrollToRowMock,
        }),
        List: (props: {
            rowCount: number;
            rowHeight: number | ((rowIndex: number) => number);
            rowComponent: React.ComponentType<any>;
            rowProps: any;
            style?: React.CSSProperties;
        }) => {
            const children = Array.from({ length: props.rowCount }, (_, index) => React.createElement(
                'div',
                {
                    key: index,
                    'data-row-height': typeof props.rowHeight === 'number' ? props.rowHeight : props.rowHeight(index),
                    'data-row-script-id': index % 2 === 1 && Math.floor(index / 2) < props.rowProps.entries.length
                        ? props.rowProps.entries[Math.floor(index / 2)].scriptId
                        : undefined,
                },
                React.createElement(props.rowComponent, {
                    index,
                    style: { height: typeof props.rowHeight === 'number' ? props.rowHeight : props.rowHeight(index) },
                    ...props.rowProps,
                }),
            ));
            return React.createElement('div', { 'data-testid': 'mock-list', style: props.style }, children);
        },
    };
}
