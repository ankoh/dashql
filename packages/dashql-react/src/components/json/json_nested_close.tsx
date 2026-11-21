import * as React from 'react';
import * as styles from './json_view.module.css';

import { expandedInitially, useJsonViewerState } from './json_view_state.js';
import { useNestedExpansionState } from './json_nested_state.js';
import { JsonBracketsClose } from './json_nested_open.js';

interface JsonNestedCloseProps {
    expandKey: string;
    level: number;
    parentValue?: object;
    value: object;
    keyName?: (string | number);
    keyPath: (string | number)[];
}

export function JsonNestedClose(props: JsonNestedCloseProps) {
    // Is the node expanded?
    const expands = useNestedExpansionState();
    const { variant, collapsed } = useJsonViewerState();
    const isExpanded = expands[props.expandKey] ?? expandedInitially(collapsed, props.level);
    // The explorer has no closing brackets
    if (variant === 'explorer') {
        return null;
    }

    // Is the node empty?
    const len = Object.keys(props.value!).length;
    if (!isExpanded || len === 0) {
        return null;
    }

    const compProps = {
        keyName: props.keyName,
        keyPath: props.keyPath,
        value: props.value,
        parentValue: props.parentValue,
    };
    const isArray = Array.isArray(props.value);
    const isMySet = props.value instanceof Set;
    return (
        <div className={styles.object_close}>
            <JsonBracketsClose isBrackets={isArray || isMySet} {...compProps} isVisible={true} />
        </div>
    );
};
