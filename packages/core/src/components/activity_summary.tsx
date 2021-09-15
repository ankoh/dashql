import * as React from 'react';
import cn from 'classnames';

import styles from './activity_summary.module.css';

import icon_arrow_right from '../../static/svg/icons/arrow_right.svg';

const renderArrow = (trend: number) => {
    return (
        <svg width="16px" height="16px">
            <use xlinkHref={`${icon_arrow_right}#sym`} transform={`rotate(${trend > 0 ? -45 : 45},8,8)`} />
        </svg>
    );
};

interface MetricProps {
    key: number;
    name: string;
    value: string;
    trend?: number;
}

const ActivityMetric: React.FC<MetricProps> = (props: MetricProps) => (
    <div key={props.key} className={styles.metric_container}>
        <div className={styles.metric_name}>{props.name}</div>
        <div className={styles.metric_value}>{props.value}</div>
        {props.trend && <div className={styles.metric_trend}>{renderArrow(props.trend)}</div>}
    </div>
);

interface SummaryProps {
    className?: string;
}

export const ActivitySummary: React.FC<SummaryProps> = (props: SummaryProps) => {
    return (
        <div className={cn(styles.container, props.className)}>
            <div className={styles.metric_row}>
                <ActivityMetric key={0} name="Sessions" value="42k" trend={1.0} />
                <ActivityMetric key={2} name="Session Time" value="Ø 2min" />
                <ActivityMetric key={1} name="Instantiation" value="Ø 4s" />
            </div>
            <div className={styles.metric_row}>
                <ActivityMetric key={0} name="Queries" value="42m" />
                <ActivityMetric key={1} name="Fetched Data" value="42MB" />
                <ActivityMetric key={2} name="Downstream" value="Ø 42kb/s" />
            </div>
        </div>
    );
};
