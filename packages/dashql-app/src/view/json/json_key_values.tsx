import * as React from 'react';
import * as styles from './json_view.module.css';

import { useJsonViewerState } from './json_view_state.js';
import { useNestedExpansionState } from './json_nested_state.js';
import { useToolVisibilityDispatch } from './json_tool_state.js';
import { JsonLiteral } from './json_literal.js';
import { JsonKeyName } from './json_key_name.js';
import { JsonValue } from './json_value.js';
import { JsonCopyButton } from './json_copy_button.js';
import { useUniqueKey } from './unique_key.js';

interface KeyValuesProps<T extends object> {
    expandKey?: string;
    level: number;
    value: T;
    parentValue?: T;
    keyName?: (string | number);
    keyPath: (string | number)[];
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
    const dispatch = useToolVisibilityDispatch();
    const subkeyid = useUniqueKey();
    const isMyArray = Array.isArray(props.value);
    const isMySet = props.value instanceof Set;
    const isMyMap = props.value instanceof Map;
    const isDate = props.value instanceof Date;
    const isUrl = props.value instanceof URL;
    const isMyObject = props.value && typeof props.value === 'object' && !isMyArray && !isMySet && !isMyMap && !isDate && !isUrl;
    const isNested = isMyObject || isMyArray || isMySet || isMyMap;
    if (isNested) {
        const mappedValue = isMySet
            ? Array.from(props.value as Set<any>)
            : (isMyMap ? Object.fromEntries(props.value as Iterable<[any, any]>) : props.value);
        return (
            <JsonValue
                keyName={props.keyName}
                keyPath={props.keyPath}
                value={mappedValue}
                parentValue={props.parentValue}
                initialValue={props.value}
                level={props.level + 1}
            />
        );
    }
    return (
        <div
            className={styles.object_entries_line}
            onMouseEnter={() => dispatch({ [subkeyid]: true })}
            onMouseLeave={() => dispatch({ [subkeyid]: false })}
        >
            <JsonKeyName
                keyName={props.keyName}
                keyPath={props.keyPath}
            />
            <JsonLiteral value={props.value} />
            <JsonCopyButton
                keyName={props.keyName}
                keyPath={props.keyPath}
                value={props.value as object}
                parentValue={props.parentValue}
                expandKey={subkeyid} />
        </div>
    );
};
