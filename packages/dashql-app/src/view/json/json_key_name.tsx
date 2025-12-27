import * as React from 'react';
import * as styles from './json_view.module.css';

export interface KeyNameCompProps {
    keyName?: (string | number);
    keyPath: (string | number)[];
}

export function JsonKeyName(props: React.PropsWithChildren<KeyNameCompProps>) {
    const isNumber = typeof props.keyName === 'number';
    return (
        <React.Fragment>
            <span>
                <Quote isNumber={isNumber} data-placement="left" />
                <span className={isNumber ? styles.object_key_name_number : styles.object_key_name_string}>
                    {props.keyName}
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
