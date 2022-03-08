import React from 'react';

import styles from './terminal.module.css';

type Props = Record<string, string>;

export const Terminal: React.FC<Props> = (props: Props) => {
    return (
        <div className={styles.root}>
            <div className={styles.term_container}></div>
        </div>
    );
};

export default Terminal;
