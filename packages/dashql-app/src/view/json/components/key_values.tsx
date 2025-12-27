import * as React from 'react';
import { useJsonViewerState } from '../state/json_viewer_state.js';
import { useNodeExpansionState } from '../state/node_expansion_state.js';
import { useShowToolsDispatch } from '../state/tool_visibility_state.js';
import { Value } from './value.js';
import { KeyNameComp } from './key_name.js';
import { RowComp } from './row.js';
import { Container } from '../container.js';
import { Quote, Colon, type SymbolsElementResult } from '../symbols.js';
import { Copied } from './copied.js';
import { useUniqueKey } from './unique_key.js';

interface KeyValuesProps<T extends object> extends SymbolsElementResult<T> {
    expandKey?: string;
    level: number;
}

export function KeyValues<T extends object>(props: KeyValuesProps<T>) {
    const value = props.value ?? {};
    const { keyName, expandKey = '', level, keys = [], parentValue } = props;
    const expands = useNodeExpansionState();
    const { objectSortKeys, indentWidth, collapsed, shouldExpandNodeInitially } = useJsonViewerState();
    const defaultExpanded =
        typeof collapsed === 'boolean' ? collapsed : typeof collapsed === 'number' ? level > collapsed : false;
    const isExpanded = expands[expandKey] ?? (shouldExpandNodeInitially ? false : defaultExpanded);
    const shouldExpand =
        shouldExpandNodeInitially && shouldExpandNodeInitially(!isExpanded, { value, keys, level, keyName, parentValue });

    if (expands[expandKey] === undefined && !shouldExpand) {
        return null;
    }
    if (isExpanded) {
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

interface KeyNameProps<T extends object> extends SymbolsElementResult<T> { }
export function KeyName<T extends object>(props: KeyNameProps<T>) {
    const { keyName, parentValue, keys, value } = props;
    const isNumber = typeof keyName === 'number';
    const compProps = { keyName, value, keys, parentValue };
    return (
        <React.Fragment>
            <span>
                <Quote isNumber={isNumber} data-placement="left" {...compProps} />
                <KeyNameComp {...compProps}>{keyName}</KeyNameComp>
                <Quote isNumber={isNumber} data-placement="right" {...compProps} />
            </span>
            <Colon {...compProps} />
        </React.Fragment>
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
            <Container
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
        <RowComp className="w-rjv-line" value={value} keyName={keyName} keys={keys} parentValue={parentValue} {...reset}>
            <KeyName keyName={keyName} value={value} keys={keys} parentValue={parentValue} />
            <Value keyName={keyName!} value={value} keys={keys} />
            <Copied keyName={keyName} value={value as object} keys={keys} parentValue={parentValue} expandKey={subkeyid} />
        </RowComp>
    );
};
