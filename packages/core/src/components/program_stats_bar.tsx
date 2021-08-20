import * as React from 'react';
import * as arrow from 'apache-arrow';
import { ProgramStatsBarHitChart } from './program_stats_bar_hits';

import styles from './program_stats_bar.module.css';

import icon_arrow_right from '../../static/svg/icons/arrow_right.svg';

interface Props {
    scriptID: string;
}

interface State {
    table: arrow.Table;
    trendSessions: number;
}

export const ProgramStatsBar: React.FC<Props> = (props: Props) => {
    const [state, setState] = React.useState<State | null>(null);

    // Maintain mount flag
    const isMountedRef = React.useRef<boolean>(true);
    React.useEffect(() => {
        return () => void (isMountedRef.current = false);
    }, []);

    // Fetch summary statistics
    React.useEffect(() => {
        (async () => {
            const response = await fetch(
                `${process.env.DASHQL_API_URL}/activity/script/${props.scriptID}/report/short`,
                {
                    method: 'GET',
                },
            );
            if (!response.ok) {
                console.error('failed to fetch program stats');
            }
            const dataBuffer = await response.arrayBuffer();
            const dataTable = arrow.Table.from(dataBuffer);
            if (!isMountedRef.current) return;

            const dataArray = dataTable.toArray();
            if (dataArray.length == 0) return;

            // Trend: Divide linear regression slope by max successive difference
            const regrSlope = (col: arrow.Column) => {
                const n = BigInt(col.length);
                let sumXY = BigInt(0);
                let sumX = BigInt(0);
                let sumY = BigInt(0);
                let sumX2 = BigInt(0);
                let row = BigInt(0);
                for (const value of col) {
                    const y = BigInt(value);
                    sumXY += row * y;
                    sumX += row;
                    sumY += y;
                    sumX2 += row * row;
                    row += BigInt(1);
                }
                const slope = Number(n * sumXY - sumX * sumY) / Number(n * sumX2 - sumX * sumX);
                return slope;
            };

            setState({
                table: dataTable,
                trendSessions: regrSlope(dataTable.getColumn('sessions')),
            });
        })();
    }, [props.scriptID]);

    const renderArrow = (trend: number) => {
        console.log(trend);
        return (
            <svg width="16px" height="16px">
                <use xlinkHref={`${icon_arrow_right}#sym`} transform={`rotate(${trend > 0 ? -45 : 45},8,8)`} />
            </svg>
        );
    };

    if (!state) {
        return <div />;
    }
    return (
        <div className={styles.container}>
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
                <div className={styles.details_name}>Analytics</div>
                <div className={styles.views_chart}>
                    <ProgramStatsBarHitChart width={80} height={14} data={state.table} />
                </div>
            </div>
        </div>
    );
};
