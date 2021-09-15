import * as React from 'react';
import { ActivityTimeseries, ActivitySummary } from '../components';
import logo from '../../static/svg/logo/logo.svg';
import styles from './account.module.css';

interface Props {
    className?: string;
}

export const Account: React.FC<Props> = () => {
    //<AccountScriptHitsChart width={80} height={14} data={state.table} />
    return (
        <div className={styles.root}>
            <div className={styles.account_panel}>
                <div className={styles.account_panel_header}>Account</div>
                <div className={styles.github_profile}>
                    <div className={styles.github_profile_avatar}>
                        <div className={styles.github_profile_avatar_img}>
                            <svg width="40px" height="40px">
                                <use xlinkHref={`${logo}#sym`} />
                            </svg>
                        </div>
                    </div>
                    <div className={styles.github_profile_login}></div>
                    <div className={styles.github_profile_name}></div>
                    <div className={styles.github_profile_stats}></div>
                </div>
                <div className={styles.account_analytics}>
                    <ActivityTimeseries className={styles.account_analytics_timeseries} />
                    <ActivitySummary />
                </div>
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
