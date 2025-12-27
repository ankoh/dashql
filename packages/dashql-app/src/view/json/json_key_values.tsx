import * as React from 'react';
import * as styles from './json_view.module.css';

import { useJsonViewerState } from './json_view_state.js';
import { useNestedExpansionState } from './json_nested_state.js';
import { useShowToolsDispatch } from './tool_visibility_state.js';
import { JsonLiteral } from './json_literal.js';
import { JsonKeyName } from './json_key_name.js';
import { JsonValue } from './json_value.js';
import { type SymbolsElementResult } from './symbols.js';
import { JsonCopyButton } from './json_copy_button.js';
import { useUniqueKey } from './unique_key.js';

interface KeyValuesProps<T extends object> extends SymbolsElementResult<T> {
    expandKey?: string;
    level: number;
}

export function JsonKeyValues<T extends object>(props: KeyValuesProps<T>) {
    const value = props.value ?? {};
    const { keyName, expandKey = '', level, keyPath: keyPath = [], parentValue } = props;

    // Is expanded?
    const expands = useNestedExpansionState();
    const { objectSortKeys, indentWidth, collapsed, shouldExpandNodeInitially } = useJsonViewerState();
    const defaultExpanded =
        typeof collapsed === 'boolean' ? !collapsed : typeof collapsed === 'number' ? level <= collapsed : true;
    const isExpanded = expands[expandKey] ?? (shouldExpandNodeInitially ? true : defaultExpanded);
    const shouldExpand =
        shouldExpandNodeInitially && shouldExpandNodeInitially(isExpanded, { value, keyPath, level, keyName, parentValue });

    if (expands[expandKey] === undefined && !shouldExpand) {
        return null;
    }
    if (!isExpanded) {
        return null;
    }
    const isMyArray = Array.isArray(value);
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
                    <KeyValuesItem parentValue={value} keyName={key} keyPath={[...keyPath, key]} value={val} key={idx} level={level} />
                );
            })}
        </div>
    );
};

export function KeyValuesItem<T extends object>(props: KeyValuesProps<T>) {
    const { keyName, value, parentValue, level = 0, keyPath: keyPath = [] } = props;
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
                keyPath={keyPath}
                level={level + 1}
            />
        );
    }
    const reset: React.HTMLAttributes<HTMLDivElement> = {
        onMouseEnter: () => dispatch({ [subkeyid]: true }),
        onMouseLeave: () => dispatch({ [subkeyid]: false }),
    };
    return (
        <div className={styles.object_entries_line}>
            <JsonKeyName keyName={keyName} value={value} keyPath={keyPath} parentValue={parentValue} />
            <JsonLiteral value={value} />
            <JsonCopyButton keyName={keyName} value={value as object} keyPath={keyPath} parentValue={parentValue} expandKey={subkeyid} />
        </div>
    );
};
