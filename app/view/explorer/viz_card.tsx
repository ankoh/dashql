import * as React from 'react';
import * as proto from '@dashql/proto';
import { IAppContext, withAppContext } from '../../app_context';
import GridElement from './grid_element';
import Table from '../viz/table';
import ChartViewer from '../viz/chart_viewer';

import styles from './viz_card.module.scss';
import { DeleteIcon, EditIcon, RefreshIcon } from '../../svg/icons';

type Props = {
    appContext: IAppContext;
} & {
    statement: proto.tql.VizStatement;
    data: proto.engine.QueryResult | null;
    position: GridElement;
};

const ACTION_ICON_WIDTH = '16px';
const ACTION_ICON_HEIGHT = '16px';

/// A viz card
class VizCard extends React.Component<Props> {
    handleClick = () => {
        const location = this.props.statement.getLocation();

        if (!location) {
            return;
        }

        this.props.appContext.controller.editor.replace(location, null);
    };

    render() {
        let viz: React.ReactElement | null = null;

        if (this.props.data) {
            const type = this.props.statement.getVizType()?.getType();

            switch (type) {
                case proto.tql.VizTypeType.VIZ_AREA:
                case proto.tql.VizTypeType.VIZ_BAR:
                case proto.tql.VizTypeType.VIZ_BOX:
                case proto.tql.VizTypeType.VIZ_BUBBLE:
                case proto.tql.VizTypeType.VIZ_GRID:
                case proto.tql.VizTypeType.VIZ_HISTOGRAM:
                case proto.tql.VizTypeType.VIZ_LINE:
                case proto.tql.VizTypeType.VIZ_NUMBER:
                case proto.tql.VizTypeType.VIZ_PIE:
                case proto.tql.VizTypeType.VIZ_SCATTER:
                case proto.tql.VizTypeType.VIZ_POINT:
                    viz = <ChartViewer data={this.props.data} type={type} />;
                    break;
                case proto.tql.VizTypeType.VIZ_TABLE:
                    viz = <Table data={this.props.data} />;
                    break;
                case proto.tql.VizTypeType.VIZ_TEXT:
                    break;
            }
        }

        const name = this.props.statement.getName()?.getString();

        return (
            <div
                className={styles.viz_card}
                style={{
                    gridArea: this.props.position.cssArea,
                }}
            >
                <div className={styles.viz_card_header}>
                    <div className={styles.viz_card_title}>{name}</div>
                    <div className={styles.viz_card_action_refresh}>
                        <RefreshIcon
                            className={styles.viz_card_action_icon}
                            width={ACTION_ICON_WIDTH}
                            height={ACTION_ICON_HEIGHT}
                        />
                    </div>
                    <div className={styles.viz_card_action_edit}>
                        <EditIcon
                            className={styles.viz_card_action_icon}
                            width={ACTION_ICON_WIDTH}
                            height={ACTION_ICON_HEIGHT}
                        />
                    </div>
                    <div
                        className={styles.viz_card_action_delete}
                        onClick={this.handleClick}
                    >
                        <DeleteIcon
                            className={styles.viz_card_action_icon}
                            width={ACTION_ICON_WIDTH}
                            height={ACTION_ICON_HEIGHT}
                        />
                    </div>
                </div>
                <div className={styles.viz_card_body}>{viz}</div>
            </div>
        );
    }
}

export default withAppContext(VizCard);
