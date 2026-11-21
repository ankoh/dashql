import * as React from 'react';
import * as styles from './json_view.module.css';

import { JsonViewerStateProvider, type JsonViewerState } from './json_view_state.js';
import { JsonValue } from './json_value.js';

export * from './json_arrow_symbol.js';

/// How the viewer renders values.
/// `json` shows the JSON syntax, `explorer` shows an object explorer without brackets, quotes or colons.
export type JsonViewVariant = 'json' | 'explorer';

export interface JsonViewProps {
    /// This property contains your input JSON
    value: object;
    /// Render the JSON syntax or an object explorer @default 'json'
    variant?: JsonViewVariant;
    /// Render arrays incrementally in pages of this size. Set to `0` to render all items. @default 0
    arrayPageSize?: number;
    /// When set to true, all nodes are collapsed initially. A number collapses the nodes below that depth. @default false
    collapsed?: boolean | number;
    /// Shorten long JSON strings, Set to `0` to disable this feature @default 30
    shortenTextAfterLength?: number;
    /// Transform the text before copying to clipboard
    beforeCopy?: (
        copyText: string,
        keyName?: string | number,
        value?: object,
        parentValue?: object,
        expandKey?: string,
        keyPath?: (number | string)[],
    ) => string;
    className?: string;
}

/// A viewer of a JSON value. Objects and arrays show their size, values show a copy button when hovered and long
/// strings are shortened with `...`.
export const JsonView = React.memo(function JsonView(props: JsonViewProps) {
    const { value, variant, arrayPageSize, collapsed, shortenTextAfterLength, beforeCopy, className } = props;
    // Memoize the state to not re-render the whole tree when the parent re-renders
    const state: JsonViewerState = React.useMemo(() => ({
        variant: variant ?? 'json',
        arrayPageSize: arrayPageSize ?? 0,
        collapsed: collapsed ?? false,
        shortenTextAfterLength: shortenTextAfterLength ?? 30,
        beforeCopy,
    }), [variant, arrayPageSize, collapsed, shortenTextAfterLength, beforeCopy]);
    return (
        <JsonViewerStateProvider state={state}>
            <div
                className={`${styles.viewer}${variant === 'explorer' ? ` ${styles.viewer_explorer}` : ''}${className ? ` ${className}` : ''}`}
                data-electron-drag-region="false"
            >
                <JsonValue
                    value={value}
                    initialValue={value}
                    level={0}
                    keyName={undefined}
                    keyPath={[]}
                />
            </div>
        </JsonViewerStateProvider>
    );
});

export default JsonView;
