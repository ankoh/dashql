import * as React from 'react';
import { useJsonViewerState } from './json_viewer_state.js';
import { useNodeExpansionState } from './json_node_expansion_state.js';
import { JsonBracketsClose, type SymbolsElementResult } from './symbols.js';

interface NestedCloseProps<T extends object> extends SymbolsElementResult<T> {
    expandKey: string;
    level: number;
}

export function JsonNestedClose<T extends object>(props: NestedCloseProps<T>) {
    const value = props.value ?? {};
    const { keyName, expandKey, parentValue, level, keyPath = [] } = props;

    // Is the node expanded?
    const expands = useNodeExpansionState();
    const { collapsed, shouldExpandNodeInitially } = useJsonViewerState();
    const defaultExpanded =
        typeof collapsed === 'boolean' ? !collapsed : typeof collapsed === 'number' ? level <= collapsed : true;
    const isExpanded = expands[expandKey] ?? (shouldExpandNodeInitially ? true : defaultExpanded);
    const shouldExpand =
        shouldExpandNodeInitially && shouldExpandNodeInitially(!isExpanded, { value, keyPath, level, keyName, parentValue });
    if (expands[expandKey] === undefined && !shouldExpand) {
        return null;
    }

    // Is the node empty?
    const len = Object.keys(value!).length;
    if (!isExpanded || len === 0) {
        return null;
    }

    const style: React.CSSProperties = {
        paddingLeft: 4,
    };
    const compProps = { keyName, value, keyPath, parentValue };
    const isArray = Array.isArray(value);
    const isMySet = value instanceof Set;
    return (
        <div style={style}>
            <JsonBracketsClose isBrackets={isArray || isMySet} {...compProps} isVisible={true} />
        </div>
    );
};
