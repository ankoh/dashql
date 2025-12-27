import * as React from 'react';
import type * as CSS from 'csstype';

import { useNodeExpansionDispatch, useNodeExpansionState } from '../state/json_node_expansion_state.js';
import { useJsonViewerState } from '../state/json_viewer_state.js';
import { JsonCopyButton } from './json_copy_button.js';
import { JsonItemCount } from './json_item_count.js';
import { Arrow, JsonBracketsOpen, JsonBracketsClose, type SymbolsElementResult } from '../symbols.js';
import { JsonEllipsis } from './json_ellipsis.js';
import { SetHeader, MapHeader } from '../types.js';
import { JsonKeyName } from './json_key_name.js';

export interface NestedOpenProps<T extends object> extends SymbolsElementResult<T> {
    initialValue?: T;
    expandKey: string;
    level: number;
}

export function JsonNestedOpen<T extends object>(props: NestedOpenProps<T>) {
    const { keyName, expandKey, keys = [], initialValue, value, parentValue, level } = props;

    // Is the node expanded?
    const nodeExpansions = useNodeExpansionState();
    const dispatchExpands = useNodeExpansionDispatch();
    const { onExpand, collapsed, shouldExpandNodeInitially } = useJsonViewerState();
    const defaultExpanded =
        typeof collapsed === 'boolean' ? !collapsed : typeof collapsed === 'number' ? level <= collapsed : true;
    let isExpanded = nodeExpansions[expandKey] ?? (shouldExpandNodeInitially ? true : defaultExpanded);
    const shouldExpand =
        shouldExpandNodeInitially && shouldExpandNodeInitially(isExpanded, { value, keys, level, keyName, parentValue });
    if (nodeExpansions[expandKey] === undefined && shouldExpandNodeInitially) {
        isExpanded = shouldExpand === true;
    }

    // Click handler
    const click = () => {
        const opt = { expand: !isExpanded, value, keyid: expandKey, keyName };
        onExpand && onExpand(opt);
        dispatchExpands({ [expandKey]: opt.expand });
    };

    // Arrow animation
    const style: CSS.Properties<string | number> = { display: 'inline-flex', alignItems: 'center' };
    const arrowStyle: CSS.Properties<string | number> = {
        transform: `rotate(${isExpanded ? '0' : '-90'}deg)`,
        transition: 'all 0.3s',
    };

    const len = Object.keys(value ?? {}).length;
    const isObject = typeof value === 'object';
    const isArray = Array.isArray(value);
    const isMySet = value instanceof Set;
    const showArrow = len !== 0 && (isArray || isMySet || isObject);
    const reset: React.HTMLAttributes<HTMLDivElement> = { style };

    if (showArrow) {
        reset.onClick = click;
    }

    const childProps = { keyName, value, keys, parentValue };
    return (
        <span {...reset}>
            {showArrow && (
                <Arrow style={arrowStyle} expandKey={expandKey} {...childProps} />
            )}
            {(keyName || typeof keyName === 'number') && (
                <JsonKeyName {...childProps} />
            )}
            <SetHeader value={initialValue} keyName={keyName!} />
            <MapHeader value={initialValue} keyName={keyName!} />
            <JsonBracketsOpen isBrackets={isArray || isMySet} {...childProps} />
            <JsonEllipsis
                keyName={keyName!}
                value={value}
                isExpanded={isExpanded}
            />
            <JsonBracketsClose
                isVisible={!isExpanded || !showArrow}
                isBrackets={isArray || isMySet}
                {...childProps}
            />
            <JsonItemCount value={value} keyName={keyName!} />
            <JsonCopyButton
                keyName={keyName!}
                value={value}
                expandKey={expandKey}
                parentValue={parentValue}
                keys={keys}
            />
        </span>
    );
};
