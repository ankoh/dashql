import * as React from 'react';
import * as styles from './json_view.module.css';

import { JsonNestedClose } from './json_nested_close.js';
import { JsonNestedOpen } from './json_nested_open.js';
import { JsonKeyValues } from './json_key_values.js';
import { useUniqueKey } from './unique_key.js';
import { useToolVisibilityDispatch } from './json_tool_state.js';

export interface JsonValueProps {
    level: number;
    keyName?: (string | number);
    keyPath: (string | number)[];
    value: object;
    initialValue: object;
    parentValue?: object;
}
export const JsonValue = React.forwardRef((props: JsonValueProps, ref: React.Ref<HTMLDivElement>) => {
    const dispatch = useToolVisibilityDispatch();
    const subkeyid = useUniqueKey();
    const reset: React.HTMLAttributes<HTMLDivElement> = {
        onMouseEnter: () => dispatch({ [subkeyid]: true }),
        onMouseLeave: () => dispatch({ [subkeyid]: false }),
    };
    return (
        <div className={styles.value_container} ref={ref} {...reset}>
            <JsonNestedOpen
                expandKey={subkeyid}
                level={props.level}
                keyPath={props.keyPath}
                keyName={props.keyName}
                value={props.value}
                initialValue={props.initialValue}
                parentValue={props.parentValue}
            />
            <JsonKeyValues
                expandKey={subkeyid}
                level={props.level}
                keyPath={props.keyPath}
                keyName={props.keyName}
                value={props.value}
                parentValue={props.parentValue}
            />
            <JsonNestedClose
                expandKey={subkeyid}
                level={props.level}
                keyPath={props.keyPath}
                keyName={props.keyName}
                value={props.value}
                parentValue={props.parentValue}
            />
        </div>
    );
});
