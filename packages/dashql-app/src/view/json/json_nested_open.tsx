import * as React from 'react';
import * as styles from './json_view.module.css';

import { useNestedExpansionDispatch, useNestedExpansionState } from './json_nested_state.js';
import { useJsonViewerState } from './json_view_state.js';
import { JsonCopyButton } from './json_copy_button.js';
import { JsonItemCount } from './json_item_count.js';
import { JsonArrowSymbol } from './json_arrow_symbol.js';
import { JsonEllipsisSymbol } from './json_ellipsis_symbol.js';
import { JsonKeyName, SymbolsElementResult } from './json_key_name.js';

export interface NestedOpenProps<T extends object> extends SymbolsElementResult<T> {
    initialValue?: T;
    expandKey: string;
    level: number;
}

export function JsonNestedOpen<T extends object>(props: NestedOpenProps<T>) {
    const { keyName, expandKey, keyPath = [], initialValue, value, parentValue, level } = props;

    // Is the node expanded?
    const nodeExpansions = useNestedExpansionState();
    const dispatchExpands = useNestedExpansionDispatch();
    const { onExpand, collapsed, shouldExpandNodeInitially } = useJsonViewerState();
    const defaultExpanded =
        typeof collapsed === 'boolean' ? !collapsed : typeof collapsed === 'number' ? level <= collapsed : true;
    let isExpanded = nodeExpansions[expandKey] ?? (shouldExpandNodeInitially ? true : defaultExpanded);
    const shouldExpand =
        shouldExpandNodeInitially && shouldExpandNodeInitially(isExpanded, { value, keyPath, level, keyName, parentValue });
    if (nodeExpansions[expandKey] === undefined && shouldExpandNodeInitially) {
        isExpanded = shouldExpand === true;
    }

    // Click handler
    const click = () => {
        const opt = { expand: !isExpanded, value, keyid: expandKey, keyName };
        onExpand && onExpand(opt);
        dispatchExpands({ [expandKey]: opt.expand });
    };

    const style: React.CSSProperties = { display: 'inline-flex', alignItems: 'center' };
    const len = Object.keys(value ?? {}).length;
    const isObject = typeof value === 'object';
    const isArray = Array.isArray(value);
    const isMySet = value instanceof Set;
    const showArrow = len !== 0 && (isArray || isMySet || isObject);
    const reset: React.HTMLAttributes<HTMLDivElement> = { style };

    if (showArrow) {
        reset.onClick = click;
    }

    const childProps = { keyName, value, keyPath, parentValue };
    return (
        <span {...reset}>
            {showArrow && (
                <JsonArrowSymbol isExpanded={isExpanded} />
            )}
            {(keyName || typeof keyName === 'number') && (
                <JsonKeyName {...childProps} />
            )}
            <SetHeader value={initialValue} />
            <MapHeader value={initialValue} />
            <JsonBracketsOpen isBrackets={isArray || isMySet} />
            <JsonEllipsisSymbol
                keyName={keyName!}
                value={value}
                isExpanded={isExpanded}
            />
            <JsonBracketsClose isVisible={!isExpanded || !showArrow} isBrackets={isArray || isMySet} />
            <JsonItemCount value={value} />
            <JsonCopyButton
                keyName={keyName!}
                value={value}
                expandKey={expandKey}
                parentValue={parentValue}
                keyPath={keyPath}
            />
        </span>
    );
};

function SetHeader(props: { value: unknown; }) {
    const isSet = props.value instanceof Set;
    if (!isSet) return null;
    return <span className={styles.object_header_set} data-type="set">Set</span>;
};

function MapHeader(props: { value: unknown; }) {
    const isMap = props.value instanceof Map;
    if (!isMap) return null;
    return <span className={styles.object_header_set} data-type="map">Map</span>;
};

export function JsonBracketsOpen(props: { isBrackets: boolean }) {
    return props.isBrackets
        ? (
            <span className={styles.object_square_brackets_open}>
                [
            </span>
        )
        : (
            <span className={styles.object_curly_brackets_open}>
                {'{'}
            </span>
        );
};

export function JsonBracketsClose(props: { isBrackets: boolean, isVisible: boolean }) {
    if (!props.isVisible) return null;
    return props.isBrackets
        ? (
            <span className={styles.object_curly_brackets_open}>
                ]
            </span>
        )
        : (
            <span className={styles.object_curly_brackets_close}>
                {'}'}
            </span>
        );
};
