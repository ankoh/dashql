import * as React from 'react';
import * as styles from './json_view.module.css';

export interface SymbolsElementResult<T extends object, K = string | number> {
    value?: T;
    parentValue?: T;
    keyName?: K;
    keyPath?: K[];
}

export interface SectionElementResult<T extends object, K = string | number> {
    value?: T;
    parentValue?: T;
    keyName?: K;
    keyPath?: K[];
}

export interface KeyNameCompProps<T extends object>
    extends React.HTMLAttributes<HTMLSpanElement>,
    SectionElementResult<T> { }

export function JsonKeyName<T extends object>(props: React.PropsWithChildren<KeyNameCompProps<T>>) {
    const { children, value, parentValue, keyName, keyPath, ...other } = props;
    const isNumber = typeof keyName === 'number';
    return (
        <React.Fragment>
            <span>
                <Quote isNumber={isNumber} data-placement="left" />
                <span className={isNumber ? styles.object_key_name_number : styles.object_key_name_string}>
                    {keyName}
                </span>
                <Quote isNumber={isNumber} data-placement="right" />
            </span>
            <Colon />
        </React.Fragment>
    );
};


function Quote(props: { isNumber: boolean }) {
    if (props.isNumber) return null;
    return (
        <span className={styles.object_key_quotes}>
            "
        </span>
    );
};


function Colon() {
    return (
        <span className={styles.object_key_colon}>
            :
        </span>
    );
};
