import * as React from 'react';

import { JsonNestedClose } from './components/json_nested_close.js';
import { JsonNestedOpen } from './components/json_nested_open.js';
import { JsonKeyValues } from './components/json_key_values.js';
import { useUniqueKey } from './components/unique_key.js';
import { useShowToolsDispatch } from './state/tool_visibility_state.js';

export interface JsonValueProps<T extends object> extends React.HTMLAttributes<HTMLDivElement> {
    keyName?: string | number;
    keyid?: string;
    parentValue?: T;
    level?: number;
    value?: T;
    initialValue?: T;
    /// Index of the parent `keyName`
    keys?: (string | number)[];
}
export const JsonValue = React.forwardRef(<T extends object>(props: JsonValueProps<T>, ref: React.Ref<HTMLDivElement>) => {
    const {
        className = '',
        children,
        parentValue,
        keyid,
        level = 1,
        value,
        initialValue,
        keys,
        keyName,
        ...elmProps
    } = props;
    const dispatch = useShowToolsDispatch();
    const subkeyid = useUniqueKey();
    const defaultClassNames = [className, 'w-rjv-inner'].filter(Boolean).join(' ');
    const reset: React.HTMLAttributes<HTMLDivElement> = {
        onMouseEnter: () => dispatch({ [subkeyid]: true }),
        onMouseLeave: () => dispatch({ [subkeyid]: false }),
    };
    return (
        <div className={defaultClassNames} ref={ref} {...elmProps} {...reset}>
            <JsonNestedOpen
                expandKey={subkeyid}
                value={value}
                level={level}
                keys={keys}
                parentValue={parentValue}
                keyName={keyName}
                initialValue={initialValue}
            />
            <JsonKeyValues
                expandKey={subkeyid}
                value={value}
                level={level}
                keys={keys}
                parentValue={parentValue}
                keyName={keyName}
            />
            <JsonNestedClose
                expandKey={subkeyid}
                value={value}
                level={level}
                keys={keys}
                parentValue={parentValue}
                keyName={keyName}
            />
        </div>
    );
});
