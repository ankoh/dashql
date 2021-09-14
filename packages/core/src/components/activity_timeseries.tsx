import * as React from 'react';
import * as arrow from 'apache-arrow';
import * as utils from '../utils';
import cn from 'classnames';
import { ActivityTimeseriesChart } from './activity_timeseries_chart';

import styles from './activity_timeseries.module.css';

import { CenteredRectangleWaveSpinner } from './spinners';

interface Props {
    className?: string;
    title: string;
}

interface State {
    table: arrow.Table;
    trendSessions: number;
}

export const ActivityTimeseries: React.FC<Props> = (props: Props) => {
    const [state, setState] = React.useState<State | null>(null);

    // Maintain mount flag
    const isMountedRef = React.useRef<boolean>(true);
    React.useEffect(() => {
        return () => void (isMountedRef.current = false);
    }, []);

    // Fetch summary statistics
    React.useEffect(() => {
        (async () => {
            const url = new URL(`${process.env.DASHQL_API_URL}/activity`);
            url.searchParams.append('short', 'false');
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
                trendSessions: utils.regrSlopeBigInt(dataTable.getColumn('sessions')),
            });
        })();
    }, []);

    if (!state) {
        return (
            <div className={cn(styles.spinner_container, props.className)}>
                <CenteredRectangleWaveSpinner className={styles.spinner} active={true} />;
            </div>
        );
    }
    return (
        <div className={cn(styles.container, props.className)}>
            <div className={styles.views_chart_label}>{props.title}</div>
            <div className={styles.views_chart}>
                <ActivityTimeseriesChart data={state.table} />
            </div>
        </div>
    );
};
