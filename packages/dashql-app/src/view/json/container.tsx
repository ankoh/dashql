import * as React from 'react';
import { NestedClose } from './comps/nested_close.js';
import { NestedOpen } from './comps/nested_open.js';
import { KeyValues } from './comps/key_values.js';
import { useIdCompat } from './comps/use_id_compat.js';
import { useShowToolsDispatch } from './store/show_tools.js';

export interface ContainerProps<T extends object> extends React.HTMLAttributes<HTMLDivElement> {
    keyName?: string | number;
    keyid?: string;
    parentValue?: T;
    level?: number;
    value?: T;
    initialValue?: T;
    /** Index of the parent `keyName` */
    keys?: (string | number)[];
}
export const Container = React.forwardRef(<T extends object>(props: ContainerProps<T>, ref: React.Ref<HTMLDivElement>) => {
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
    const subkeyid = useIdCompat();
    const defaultClassNames = [className, 'w-rjv-inner'].filter(Boolean).join(' ');
    const reset: React.HTMLAttributes<HTMLDivElement> = {
        onMouseEnter: () => dispatch({ [subkeyid]: true }),
        onMouseLeave: () => dispatch({ [subkeyid]: false }),
    };
    return (
        <div className={defaultClassNames} ref={ref} {...elmProps} {...reset}>
            <NestedOpen
                expandKey={subkeyid}
                value={value}
                level={level}
                keys={keys}
                parentValue={parentValue}
                keyName={keyName}
                initialValue={initialValue}
            />
            <KeyValues
                expandKey={subkeyid}
                value={value}
                level={level}
                keys={keys}
                parentValue={parentValue}
                keyName={keyName}
            />
            <NestedClose
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

Container.displayName = 'JVR.Container';
