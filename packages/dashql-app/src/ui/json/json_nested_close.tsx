import * as React from 'react';
import * as styles from './json_view.module.css';

import { useJsonViewerState } from './json_view_state.js';
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
    const { collapsed, shouldExpandNodeInitially } = useJsonViewerState();
    const defaultExpanded =
        typeof collapsed === 'boolean' ? !collapsed : typeof collapsed === 'number' ? props.level <= collapsed : true;
    const isExpanded = expands[props.expandKey] ?? (shouldExpandNodeInitially ? true : defaultExpanded);
    const shouldExpand =
        shouldExpandNodeInitially && shouldExpandNodeInitially(isExpanded, {
            level: props.level,
            keyPath: props.keyPath,
            keyName: props.keyName,
            value: props.value,
            parentValue: props.parentValue,
        });

    if (expands[props.expandKey] === undefined && !shouldExpand) {
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
