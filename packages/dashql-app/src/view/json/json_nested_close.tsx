import * as React from 'react';
import * as styles from './json_view.module.css';

import { useJsonViewerState } from './json_view_state.js';
import { useNestedExpansionState } from './json_nested_state.js';
import { JsonBracketsClose } from './json_nested_open.js';
import { SymbolsElementResult } from './json_key_name.js';

interface NestedCloseProps<T extends object> extends SymbolsElementResult<T> {
    expandKey: string;
    level: number;
}

export function JsonNestedClose<T extends object>(props: NestedCloseProps<T>) {
    const value = props.value ?? {};
    const { keyName, expandKey, parentValue, level, keyPath = [] } = props;

    // Is the node expanded?
    const expands = useNestedExpansionState();
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

    const compProps = { keyName, value, keyPath, parentValue };
    const isArray = Array.isArray(value);
    const isMySet = value instanceof Set;
    return (
        <div className={styles.object_close}>
            <JsonBracketsClose isBrackets={isArray || isMySet} {...compProps} isVisible={true} />
        </div>
    );
};
