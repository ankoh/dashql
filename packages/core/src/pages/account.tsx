import * as React from 'react';
import styles from './account.module.css';

interface Props {
    className?: string;
}

export const Account: React.FC<Props> = () => {
    return (
        <div className={styles.root}>
            <div className={styles.account_info}>
                <div className={styles.account_info_title}>Account</div>
            </div>
            <div className={styles.scripts}>
                <div className={styles.script_collection}>
                    <div className={styles.script_collection_name}>Local Scripts</div>
                    <div className={styles.script_collection_grid_placeholder}>
                        You haven&apos;t saved any local scripts yet
                    </div>
                </div>
                <div className={styles.script_collection}>
                    <div className={styles.script_collection_name}>Own Gists</div>
                    <div className={styles.script_collection_grid_placeholder}>
                        Please log into your GitHub account first.
                    </div>
                </div>
                <div className={styles.script_collection}>
                    <div className={styles.script_collection_name}>Starred Gists</div>
                    <div className={styles.script_collection_grid_placeholder}>
                        Please log into your GitHub account first.
                    </div>
                </div>
            </div>
        </div>
    );
};
