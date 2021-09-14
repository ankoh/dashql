import * as React from 'react';
import * as arrow from 'apache-arrow';
import * as utils from '../utils';
import { ProgramStatsSessionCountChart } from './program_stats_chart';

import styles from './program_stats.module.css';

import icon_arrow_right from '../../static/svg/icons/arrow_right.svg';
import icon_open from '../../static/svg/icons/chevron_right_circle.svg';
import { CenteredRectangleWaveSpinner } from './spinners';

interface Props {
    scriptID: string;
}

interface State {
    table: arrow.Table;
    trendSessions: number;
}

export const ProgramStats: React.FC<Props> = (props: Props) => {
    const [state, setState] = React.useState<State | null>(null);

    // Maintain mount flag
    const isMountedRef = React.useRef<boolean>(true);
    React.useEffect(() => {
        return () => void (isMountedRef.current = false);
    }, []);

    // Fetch summary statistics
    React.useEffect(() => {
        (async () => {
            const url = new URL(`${process.env.DASHQL_API_URL}/activity/script`);
            url.searchParams.append('gh-gist', props.scriptID);
            url.searchParams.append('short', 'true');
            const response = await fetch(url.href, {
                method: 'GET',
            });
            if (!response.ok) {
                console.error('failed to fetch program stats');
            }
            const dataBuffer = await response.arrayBuffer();
            const dataTable = arrow.Table.from(dataBuffer);
            if (!isMountedRef.current) return;

            const dataArray = dataTable.toArray();
            if (dataArray.length == 0) return;
            setState({
                table: dataTable,
                trendSessions: utils.regrSlopeF64(dataTable.getColumn('sessions')),
            });
        })();
    }, [props.scriptID]);

    const renderArrow = (trend: number) => {
        return (
            <svg width="16px" height="16px">
                <use xlinkHref={`${icon_arrow_right}#sym`} transform={`rotate(${trend > 0 ? -45 : 45},8,8)`} />
            </svg>
        );
    };

    if (!state) {
        return (
            <div className={styles.spinner_container}>
                <CenteredRectangleWaveSpinner className={styles.spinner} active={true} />;
            </div>
        );
    }
    return (
        <div className={styles.container}>
            <div className={styles.prefix}>{state.table.length}d</div>
            <div className={styles.trend}>
                <div className={styles.trend_name}>Views</div>
                <div className={styles.trend_value}>1.19k</div>
                <div className={styles.trend_regrslope}>{renderArrow(state.trendSessions)}</div>
            </div>
            <div className={styles.metric}>
                <div className={styles.metric_name}>Fetched</div>
                <div className={styles.metric_value}>102MB</div>
            </div>
            <div className={styles.metric}>
                <div className={styles.metric_name}>Queries</div>
                <div className={styles.metric_value}>3.57k</div>
            </div>
            <div className={styles.details}>
                <div className={styles.views_chart}>
                    <ProgramStatsSessionCountChart width={80} height={14} data={state.table} />
                    <div className={styles.open_analytics}>
                        <svg width="16px" height="16px">
                            <use xlinkHref={`${icon_open}#sym`} />
                        </svg>
                    </div>
                </div>
            </div>
        </div>
    );
};
