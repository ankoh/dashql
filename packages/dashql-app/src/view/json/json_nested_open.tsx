import * as React from 'react';
import * as styles from './json_view.module.css';

import { useNestedExpansionDispatch, useNestedExpansionState } from './json_nested_state.js';
import { useJsonViewerState } from './json_view_state.js';
import { JsonCopyButton } from './json_copy_button.js';
import { JsonItemCount } from './json_item_count.js';
import { JsonArrowSymbol } from './json_arrow_symbol.js';
import { JsonEllipsisSymbol } from './json_ellipsis_symbol.js';
import { JsonKeyName } from './json_key_name.js';

export interface NestedOpenProps {
    expandKey: string;
    keyName?: (string | number);
    keyPath: (string | number)[];
    level: number;
    value: object;
    initialValue: object;
    parentValue?: object;
}

export function JsonNestedOpen(props: NestedOpenProps) {
    // Is the node expanded?
    const nodeExpansions = useNestedExpansionState();
    const dispatchExpands = useNestedExpansionDispatch();
    const { onExpand, collapsed, shouldExpandNodeInitially } = useJsonViewerState();
    const defaultExpanded =
        typeof collapsed === 'boolean' ? !collapsed : typeof collapsed === 'number' ? props.level <= collapsed : true;
    let isExpanded = nodeExpansions[props.expandKey] ?? (shouldExpandNodeInitially ? true : defaultExpanded);
    const shouldExpand =
        shouldExpandNodeInitially && shouldExpandNodeInitially(isExpanded, {
            level: props.level,
            keyName: props.keyName,
            keyPath: props.keyPath,
            value: props.value,
            parentValue: props.parentValue
        });
    if (nodeExpansions[props.expandKey] === undefined && shouldExpandNodeInitially) {
        isExpanded = shouldExpand === true;
    }

    // Click handler
    const click = () => {
        const opt = { expand: !isExpanded, value: props.value, keyName: props.keyName };
        onExpand && onExpand(opt);
        dispatchExpands({ [props.expandKey]: opt.expand });
    };

    const style: React.CSSProperties = { display: 'inline-flex', alignItems: 'center' };
    const len = Object.keys(props.value ?? {}).length;
    const isObject = typeof props.value === 'object';
    const isArray = Array.isArray(props.value);
    const isMySet = props.value instanceof Set;
    const showArrow = len !== 0 && (isArray || isMySet || isObject);
    const reset: React.HTMLAttributes<HTMLDivElement> = { style };

    if (showArrow) {
        reset.onClick = click;
    }

    const childProps = {
        keyName: props.keyName,
        keyPath: props.keyPath,
        value: props.value,
        parentValue: props.parentValue
    };
    return (
        <span {...reset}>
            {showArrow && (
                <JsonArrowSymbol isExpanded={isExpanded} />
            )}
            {(props.keyName || typeof props.keyName === 'number') && (
                <JsonKeyName {...childProps} />
            )}
            <SetHeader value={props.initialValue} />
            <MapHeader value={props.initialValue} />
            <JsonBracketsOpen isBrackets={isArray || isMySet} />
            <JsonEllipsisSymbol
                keyName={props.keyName!}
                value={props.value}
                isExpanded={isExpanded}
            />
            <JsonBracketsClose isVisible={!isExpanded || !showArrow} isBrackets={isArray || isMySet} />
            <JsonItemCount value={props.value} />
            <JsonCopyButton
                keyName={props.keyName!}
                value={props.value}
                expandKey={props.expandKey}
                parentValue={props.parentValue}
                keyPath={props.keyPath}
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
