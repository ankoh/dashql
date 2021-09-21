import * as React from 'react';
import {
    ActivityTimeseries,
    ActivityMapChart,
    ActivitySummary,
    LocalScriptCollection,
    GistScriptCollection,
    OwnGistScriptCollection,
} from '../components';
import { useScriptRegistry } from '../model';

import logo from '../../static/svg/logo/logo.svg';
import styles from './account.module.css';

interface Props {
    className?: string;
}

export const Account: React.FC<Props> = () => {
    const registry = useScriptRegistry();

    //<AccountScriptHitsChart width={80} height={14} data={state.table} />
    return (
        <div className={styles.root}>
            <div className={styles.account_panel}>
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
                <div className={styles.height100_overflowy}>
                    <div className={styles.account_analytics}>
                        <div className={styles.account_analytics_header}>Account Analytics</div>
                        <ActivityMapChart className={styles.account_analytics_map} />
                        <ActivityTimeseries className={styles.account_analytics_timeseries} />
                        <ActivitySummary className={styles.account_analytics_summary} />
                    </div>
                </div>
            </div>
            <div className={styles.scripts}>
                <LocalScriptCollection
                    name="Local Scripts"
                    scripts={registry.local}
                    fallback="You haven't saved any local scripts yet"
                />
                <OwnGistScriptCollection
                    name="Own Gists"
                    scripts={registry.gistsOwned}
                    fallback="Please log into your GitHub account first."
                />
                <GistScriptCollection
                    name="Starred Gists"
                    scripts={registry.gistsStarred}
                    fallback="Please log into your GitHub account first."
                />
            </div>
        </div>
    );
};
