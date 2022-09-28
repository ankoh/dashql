import React from 'react';

import icon_not_found from '../../static/svg/icons/file_question.svg';
import styles from './script_not_found.module.css';

export const ScriptNotFound: React.FC<Record<string, string>> = (_props: Record<string, string>) => {
    return (
        <div className={styles.root}>
            <svg width="56px" height="56px">
                <use xlinkHref={`${icon_not_found}#sym`} />
            </svg>
        </div>
    );
};
