import * as React from 'react';
import { AppReduxStore } from '../model';
import { connect } from 'react-redux';
import { AutoSizer } from '../util/autosizer';
import { Scrollbars } from 'react-custom-scrollbars';
import Board from './board';
import { Ruler, RulerOrientation } from './board_ruler';

import styles from './board_editor.module.css';

interface IBoardEditorProps {
    scaleFactor: number;
    immutable: boolean;
}

export class BoardEditor extends React.Component<IBoardEditorProps, {}> {
    constructor(props: IBoardEditorProps) {
        super(props);
    }

    public render() {
        const rowHeight = 50;
        const columnCount = 12;
        const containerPadding: [number, number] = [32, 32];
        const elementMargin: [number, number] = [10, 10];
        const rulerThickness = 20;
        return (
            <div className={styles.container}>
                <AutoSizer>
                    {({ height, width }) => (
                        <div className={styles.content_with_rulers}>
                            <div className={styles.ruler_corner} />
                            <Ruler
                                className={styles.ruler_top}
                                width={width - rulerThickness}
                                height={rulerThickness}
                                orientation={RulerOrientation.Horizontal}
                                scaleFactor={this.props.scaleFactor}
                                stepCount={columnCount}
                                containerPadding={containerPadding[0]}
                                tickMargin={elementMargin[0]}
                            />
                            <Scrollbars
                                className={styles.content_scroller}
                                width={width}
                                height={height - rulerThickness}
                                renderTrackHorizontal={props => (
                                    <div {...props} style={{ display: 'none' }} className="track-horizontal" />
                                )}
                            >
                                <div className={styles.content_container}>
                                    <Board
                                        className={styles.content}
                                        width={width - 32}
                                        editable={true}
                                        columnCount={columnCount}
                                        rowHeight={rowHeight}
                                        containerPadding={containerPadding}
                                        elementMargin={elementMargin}
                                    />
                                    <div className={styles.ruler_left}>
                                        <AutoSizer disableWidth>
                                            {s => (
                                                <Ruler
                                                    width={32}
                                                    height={s.height}
                                                    orientation={RulerOrientation.Vertical}
                                                    scaleFactor={this.props.scaleFactor}
                                                    stepLength={rowHeight}
                                                    containerPadding={containerPadding[1]}
                                                    tickMargin={elementMargin[1]}
                                                />
                                            )}
                                        </AutoSizer>
                                    </div>
                                </div>
                            </Scrollbars>
                        </div>
                    )}
                </AutoSizer>
            </div>
        );
    }
}

function mapStateToProps(_state: AppReduxStore) {
    return {};
}

function mapDispatchToProps(_dispatch: AppReduxStore) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(BoardEditor);
