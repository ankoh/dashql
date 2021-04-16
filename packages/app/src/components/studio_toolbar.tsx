import * as React from 'react';
import styles from './studio_toolbar.module.css';
import classNames from 'classnames';

import icon_analytics from '../../static/svg/icons/analytics.svg';
import icon_arc_chart from '../../static/svg/icons/arc_chart.svg';
import icon_bar_chart from '../../static/svg/icons/bar_chart.svg';
import icon_database_import from '../../static/svg/icons/database_import.svg';
import icon_database_search from '../../static/svg/icons/database_search.svg';
import icon_package_down from '../../static/svg/icons/package_down.svg';
import icon_line_chart from '../../static/svg/icons/line_chart.svg';
import icon_plan from '../../static/svg/icons/plan.svg';
import icon_table_chart from '../../static/svg/icons/table_chart.svg';
import icon_text_card from '../../static/svg/icons/text_card.svg';
import icon_scatter_chart from '../../static/svg/icons/scatter_chart.svg';
import icon_variable_box from '../../static/svg/icons/variable_box.svg';

function Tool(props: { icon: string }): React.ReactElement {
    return (
        <div className={styles.tool}>
            <svg width="20px" height="20px">
                <use xlinkHref={`${props.icon}#sym`} />
            </svg>
        </div>
    );
}
const CreateVariable = () => <Tool icon={icon_variable_box} />;
const CreateLoad = () => <Tool icon={icon_package_down} />;
const CreateExtract = () => <Tool icon={icon_database_import} />;
const CreateQuery = () => <Tool icon={icon_database_search} />;

function VizType(props: { icon: string }): React.ReactElement {
    return (
        <div className={styles.viztype}>
            <svg width="20px" height="20px">
                <use xlinkHref={`${props.icon}#sym`} />
            </svg>
        </div>
    );
}
const QueryPlanViz = () => <VizType icon={icon_plan} />;
const TextCardViz = () => <VizType icon={icon_text_card} />;
const TableViz = () => <VizType icon={icon_table_chart} />;
const LineChartViz = () => <VizType icon={icon_line_chart} />;
const BarChartViz = () => <VizType icon={icon_bar_chart} />;
const ScatterChartViz = () => <VizType icon={icon_scatter_chart} />;
const PieChartViz = () => <VizType icon={icon_arc_chart} />;

type ToolBarState = {
    vizExpanded: boolean;
};
export class StudioToolBar extends React.Component<Record<string, unknown>, ToolBarState> {
    constructor() {
        super({});
        this.state = {
            vizExpanded: false,
        };
    }
    protected toggleViz(): void {
        this.setState({ ...this.state, vizExpanded: !this.state.vizExpanded });
    }
    public render(): React.ReactElement {
        return (
            <div className={styles.toolbar}>
                <CreateVariable />
                <CreateLoad />
                <CreateExtract />
                <CreateQuery />
                <div
                    className={classNames(styles.tool, {
                        [styles.active]: this.state.vizExpanded,
                    })}
                    onClick={this.toggleViz.bind(this)}
                >
                    <svg width="20px" height="20px">
                        <use xlinkHref={`${icon_analytics}#sym`} />
                    </svg>
                </div>
                {this.state.vizExpanded && (
                    <div className={styles.tool_sublist}>
                        <QueryPlanViz />
                        <TextCardViz />
                        <TableViz />
                        <LineChartViz />
                        <BarChartViz />
                        <ScatterChartViz />
                        <PieChartViz />
                    </div>
                )}
            </div>
        );
    }
}
