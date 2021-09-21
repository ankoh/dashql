import * as React from 'react';
import { ActivityPieChart } from './activity_piechart';
import { ActivityLengthDistribution } from './activity_length_distribution';
import { MiniBarChart } from './minibar_chart';
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

interface UAProps {
    name: string;
    variant?: string;
    value: number;
}

export const UARow: React.FC<UAProps> = (props: UAProps) => (
    <>
        <div className={styles.ua_table_name_variant}>
            <div className={styles.ua_table_name}>{props.name}</div>
            <div className={styles.ua_table_variant}>{props.variant}</div>
        </div>
        <div className={styles.ua_table_value}>{Math.floor(props.value * 100) + '%'}</div>
        <MiniBarChart className={styles.ua_table_bar} value={props.value} />
    </>
);

interface SummaryProps {
    className?: string;
}

export const ActivitySummary: React.FC<SummaryProps> = (props: SummaryProps) => {
    return (
        <div className={props.className}>
            <div className={styles.row_3col}>
                <ActivityMetric name="Total Views" value="42k" trend={1.0} />
                <ActivityMetric name="Daily Views" value="Ø 42k" />
                <ActivityMetric name="Loaded Data" value="42GB" />
            </div>
            <div className={styles.row_3col}>
                <ActivityMetric name="Total Queries" value="42k" />
                <ActivityMetric name="Query Results" value="42GB" />
                <ActivityMetric name="Visualizations" value="42k" />
            </div>
            <div className={styles.row_3col}>
                <div className={cn(styles.chart_container, styles.chart_container_dist)}>
                    <ActivityLengthDistribution className={styles.chart} />
                </div>
                <div className={styles.flex_column}>
                    <ActivityMetric className={styles.metric_padding_noborder} name="View Time" value="Ø 8s" />
                    <ActivityMetric className={styles.metric_padding_noborder} name="Evaluation Time" value="Ø 4s" />
                    <ActivityMetric className={styles.metric_padding_noborder} name="Interaction Rate" value="1.2" />
                </div>
                <div className={cn(styles.chart_container, styles.chart_container_pie)}>
                    <ActivityPieChart className={styles.chart} />
                </div>
            </div>
            <div className={styles.row_2col}>
                <div className={styles.ua_container}>
                    <div className={styles.ua_header}>Top Devices</div>
                    <div className={styles.ua_table}>
                        <UARow name="Mobile" value={0.5} />
                        <UARow name="Tablet" value={0.2} />
                        <UARow name="Desktop" value={0.1} />
                    </div>
                </div>
                <div className={styles.ua_container}>
                    <div className={styles.ua_header}>Top Operating Systems</div>
                    <div className={styles.ua_table}>
                        <UARow name="Android" variant="11" value={0.3} />
                        <UARow name="iOS" variant="15" value={0.2} />
                        <UARow name="Windows" variant="10" value={0.1} />
                    </div>
                </div>
            </div>
            <div className={styles.row_2col}>
                <div className={styles.ua_container}>
                    <div className={styles.ua_header}>Top Browsers</div>
                    <div className={styles.ua_table}>
                        <UARow name="Chrome" variant="93" value={0.4} />
                        <UARow name="Chrome" variant="92" value={0.3} />
                        <UARow name="Safari" variant="42" value={0.1} />
                    </div>
                </div>
                <div className={styles.ua_container}>
                    <div className={styles.ua_header}>Top Engines</div>
                    <div className={styles.ua_table}>
                        <UARow name="Blink" variant="42" value={0.4} />
                        <UARow name="Blink" variant="42" value={0.3} />
                        <UARow name="WebKit" variant="42" value={0.1} />
                    </div>
                </div>
            </div>
        </div>
    );
};
