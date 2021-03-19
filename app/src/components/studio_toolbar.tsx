import * as React from 'react';
import styles from './studio_toolbar.module.css';
import classNames from 'classnames';

import icon_analytics from '../../static/svg/icons/analytics.svg';
import icon_arc_chart from '../../static/svg/icons/arc_chart.svg';
import icon_bar_chart from '../../static/svg/icons/bar_chart.svg';
import icon_database_import from '../../static/svg/icons/database_import.svg';
import icon_database_search from '../../static/svg/icons/database_search.svg';
import icon_file_document_plus from '../../static/svg/icons/file_document_plus.svg';
import icon_line_chart from '../../static/svg/icons/line_chart.svg';
import icon_plan from '../../static/svg/icons/plan.svg';
import icon_table_chart from '../../static/svg/icons/table_chart.svg';
import icon_text_card from '../../static/svg/icons/text_card.svg';
import icon_scatter_chart from '../../static/svg/icons/scatter_chart.svg';
import icon_variable_box from '../../static/svg/icons/variable_box.svg';

interface ToolProps {}
function createTool(icon: string): React.FunctionComponent<ToolProps> {
    return (_props: ToolProps) => {
        return (
            <div className={styles.tool}>
                <svg width="20px" height="20px">
                    <use xlinkHref={`${icon}#sym`} />
                </svg>
            </div>
        );
    };
}
const CreateVariable = createTool(icon_variable_box);
const CreateLoad = createTool(icon_file_document_plus);
const CreateExtract = createTool(icon_database_import);
const CreateQuery = createTool(icon_database_search);

class VizTypeProps {}
function createVizType(icon: string): React.FunctionComponent<VizTypeProps> {
    return (_props: VizTypeProps) => {
        return (
            <div className={styles.viztype}>
                <svg width="20px" height="20px">
                    <use xlinkHref={`${icon}#sym`} />
                </svg>
            </div>
        );
    };
}
const QueryPlanViz = createVizType(icon_plan);
const TextCardViz = createVizType(icon_text_card);
const TableViz = createVizType(icon_table_chart);
const LineChartViz = createVizType(icon_line_chart);
const BarChartViz = createVizType(icon_bar_chart);
const ScatterChartViz = createVizType(icon_scatter_chart);
const PieChartViz = createVizType(icon_arc_chart);

type ToolBarState = {
    vizExpanded: boolean;
};
export class StudioToolBar extends React.Component<{}, ToolBarState> {
    constructor(props: {}) {
        super(props);
        this.state = {
            vizExpanded: false,
        };
    }
    protected toggleViz() {
        this.setState({ ...this.state, vizExpanded: !this.state.vizExpanded });
    }
    public render() {
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
