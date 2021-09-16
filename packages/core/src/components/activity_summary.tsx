import * as React from 'react';
import { ActivityPieChart } from './activity_piechart';
import { ActivityLengthDistribution } from './activity_length_distribution';
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
    className?: string;
    name: string;
    value: string;
    trend?: number;
}

const ActivityMetric: React.FC<MetricProps> = (props: MetricProps) => (
    <div className={cn(styles.metric_container, props.className)}>
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
                <ActivityMetric name="Total Views" value="42k" trend={1.0} />
                <ActivityMetric name="Daily Views" value="Ø 42k" />
                <ActivityMetric name="Loaded Data" value="42GB" />
            </div>
            <div className={styles.metric_row}>
                <ActivityMetric name="Total Queries" value="42k" />
                <ActivityMetric name="Query Results" value="42GB" />
                <ActivityMetric name="Visualizations" value="42k" />
            </div>
            <div className={cn(styles.metric_row, styles.metric_row_charts)}>
                <div className={cn(styles.chart_container, styles.chart_container_pie)}>
                    <ActivityPieChart className={styles.chart} />
                </div>
                <div className={cn(styles.chart_container, styles.chart_container_dist)}>
                    <ActivityLengthDistribution className={styles.chart} />
                </div>
                <div className={styles.metric_column}>
                    <ActivityMetric className={styles.metric_container_dist} name="View Time" value="Ø 8s" />
                    <ActivityMetric className={styles.metric_container_dist} name="Evaluation Time" value="Ø 4s" />
                    <ActivityMetric className={styles.metric_container_dist} name="Interaction Rate" value="1.2" />
                </div>
            </div>
        </div>
    );
};
