import * as React from 'react';

import styles from './activity_variant_list.module.css';

interface NameVariantValue {
    name: string;
    variant: string;
    value: number;
}

interface Props {
    className?: string;
    values: NameVariantValue[];
}

export const ActivityVariantList: React.FC<Props> = (props: Props) => (
    <div className={styles.container}>
        {props.values.map((v, i) => (
            <div key={i} className={styles.entry}>
                <div className={styles.entry_name}>{v.name}</div>
                <div className={styles.entry_variant}>{v.variant}</div>
                <div className={styles.entry_value}>{v.value}</div>
                <div className={styles.entry_bar}>
                    <div
                        className={styles.entry_bar_fill}
                        style={{
                            width: v.value * 100 + '%',
                        }}
                    />
                </div>
            </div>
        ))}
    </div>
);
