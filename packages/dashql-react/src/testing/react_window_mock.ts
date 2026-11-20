import type * as React from 'react';
import type { ListImperativeAPI } from 'react-window';

/// The props of the fake List. A row of an odd index carries the script id of the entry at half its index.
interface FakeListProps<RowProps extends object> {
    rowCount: number;
    rowHeight: number | ((rowIndex: number) => number);
    rowComponent: React.ComponentType<RowProps & { index: number; style: React.CSSProperties }>;
    rowProps: RowProps & { entries: readonly { scriptId?: unknown }[] };
    style?: React.CSSProperties;
}

/// A react-window module for tests: a List that renders every row with its row component, and list refs whose
/// scrollToRow is the given mock
export function fakeReactWindowModule(
    React: typeof import('react'),
    scrollToRowMock: ListImperativeAPI['scrollToRow'],
) {
    return {
        useListRef: () => React.useRef({ scrollToRow: scrollToRowMock }),
        useListCallbackRef: (_initialValue: unknown) => React.useState({
            element: null,
            scrollToRow: scrollToRowMock,
        }),
        List: <RowProps extends object>(props: FakeListProps<RowProps>) => {
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
