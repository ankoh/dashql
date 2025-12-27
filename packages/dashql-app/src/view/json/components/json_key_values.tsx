import * as React from 'react';
import { useJsonViewerState } from '../state/json_viewer_state.js';
import { useNodeExpansionState } from '../state/json_node_expansion_state.js';
import { useShowToolsDispatch } from '../state/tool_visibility_state.js';
import { JsonLiteral } from './json_literal.js';
import { JsonKeyName } from './json_key_name.js';
import { JsonValue } from '../json_value.js';
import { type SymbolsElementResult } from '../symbols.js';
import { JsonCopyButton } from './json_copy_button.js';
import { useUniqueKey } from './unique_key.js';

interface KeyValuesProps<T extends object> extends SymbolsElementResult<T> {
    expandKey?: string;
    level: number;
}

export function JsonKeyValues<T extends object>(props: KeyValuesProps<T>) {
    const value = props.value ?? {};
    const { keyName, expandKey = '', level, keys = [], parentValue } = props;

    // Is expanded?
    const expands = useNodeExpansionState();
    const { objectSortKeys, indentWidth, collapsed, shouldExpandNodeInitially } = useJsonViewerState();
    const defaultExpanded =
        typeof collapsed === 'boolean' ? !collapsed : typeof collapsed === 'number' ? level <= collapsed : true;
    const isExpanded = expands[expandKey] ?? (shouldExpandNodeInitially ? true : defaultExpanded);
    const shouldExpand =
        shouldExpandNodeInitially && shouldExpandNodeInitially(isExpanded, { value, keys, level, keyName, parentValue });

    if (expands[expandKey] === undefined && !shouldExpand) {
        return null;
    }
    if (!isExpanded) {
        return null;
    }
    const isMyArray = Array.isArray(value);
    // object
    let entries: [key: string | number, value: T][] = isMyArray
        ? Object.entries(value).map((m) => [Number(m[0]), m[1]])
        : Object.entries(value as T);
    if (objectSortKeys) {
        entries =
            objectSortKeys === true
                ? entries.sort(([a], [b]) => (typeof a === 'string' && typeof b === 'string' ? a.localeCompare(b) : 0))
                : entries.sort(([a, valA], [b, valB]) =>
                    typeof a === 'string' && typeof b === 'string' ? objectSortKeys(a, b, valA, valB) : 0,
                );
    }

    const style = {
        borderLeft: 'var(--w-rjv-border-left-width, 1px) var(--w-rjv-line-style, solid) var(--w-rjv-line-color, #ebebeb)',
        paddingLeft: indentWidth,
        marginLeft: 6,
    };
    return (
        <div className="w-rjv-wrap" style={style}>
            {entries.map(([key, val], idx) => {
                return (
                    <KeyValuesItem parentValue={value} keyName={key} keys={[...keys, key]} value={val} key={idx} level={level} />
                );
            })}
        </div>
    );
};

export function KeyValuesItem<T extends object>(props: KeyValuesProps<T>) {
    const { keyName, value, parentValue, level = 0, keys = [] } = props;
    const dispatch = useShowToolsDispatch();
    const subkeyid = useUniqueKey();
    const isMyArray = Array.isArray(value);
    const isMySet = value instanceof Set;
    const isMyMap = value instanceof Map;
    const isDate = value instanceof Date;
    const isUrl = value instanceof URL;
    const isMyObject = value && typeof value === 'object' && !isMyArray && !isMySet && !isMyMap && !isDate && !isUrl;
    const isNested = isMyObject || isMyArray || isMySet || isMyMap;
    if (isNested) {
        const myValue = isMySet ? Array.from(value as Set<any>) : isMyMap ? Object.fromEntries(value) : value;
        return (
            <JsonValue
                keyName={keyName}
                value={myValue}
                parentValue={parentValue}
                initialValue={value}
                keys={keys}
                level={level + 1}
            />
        );
    }
    const reset: React.HTMLAttributes<HTMLDivElement> = {
        onMouseEnter: () => dispatch({ [subkeyid]: true }),
        onMouseLeave: () => dispatch({ [subkeyid]: false }),
    };
    return (
        <JsonRow className="w-rjv-line" value={value} keyName={keyName} keys={keys} parentValue={parentValue} {...reset}>
            <JsonKeyName keyName={keyName} value={value} keys={keys} parentValue={parentValue} />
            <JsonLiteral keyName={keyName!} value={value} keys={keys} />
            <JsonCopyButton keyName={keyName} value={value as object} keys={keys} parentValue={parentValue} expandKey={subkeyid} />
        </JsonRow>
    );
};

export interface SectionElementResult<T extends object, K = string | number> {
    value?: T;
    parentValue?: T;
    keyName?: K;
    /** Index of the parent `keyName` */
    keys?: K[];
}

export interface JsonRowProps<T extends object> extends React.HTMLAttributes<HTMLDivElement>, SectionElementResult<T> { }

function JsonRow<T extends object>(props: React.PropsWithChildren<JsonRowProps<T>>) {
    const { children, value, parentValue, keyName, keys, ...other } = props;

    return (
        <div className="w-rjv-line" {...other}>
            {children}
        </div>
    );
};
