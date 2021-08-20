import * as React from 'react';
import * as arrow from 'apache-arrow';
import { ProgramStatsBarHitChart } from './program_stats_bar_hits';

import styles from './program_stats_bar.module.css';

interface Props {
    scriptID: string;
}

export const ProgramStatsBar: React.FC<Props> = (props: Props) => {
    const [table, setTable] = React.useState<arrow.Table | null>(null);

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
            //const sessions = dataTable.getColumn('sessions');

            setTable(dataTable);
        })();
    }, [props.scriptID]);

    if (!table) {
        return <div />;
    }
    return (
        <div className={styles.container}>
            <div className={styles.trend}>
                <div className={styles.trend_name}>Views</div>
                <div className={styles.trend_value}>1.19k</div>
                <div className={styles.trend_arrow}></div>
            </div>
            <div className={styles.trend}>
                <div className={styles.trend_name}>Fetched</div>
                <div className={styles.trend_value}>102MB</div>
                <div className={styles.trend_arrow}></div>
            </div>
            <div className={styles.trend}>
                <div className={styles.trend_name}>Queries</div>
                <div className={styles.trend_value}>3.57k</div>
                <div className={styles.trend_arrow}></div>
            </div>
            <div className={styles.details}>
                <div className={styles.details_name}>Details</div>
                <div className={styles.views_chart}>
                    <ProgramStatsBarHitChart width={80} height={14} data={table} />
                </div>
            </div>
        </div>
    );
};
