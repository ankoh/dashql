import * as React from 'react';
import { AutoSizer } from '../utils/autosizer';
import classNames from 'classnames';
import { Board } from './board';
import { Ruler, RulerOrientation } from './board_ruler';

import styles from './board_editor.module.css';

interface IBoardEditorProps {
    className?: string;
    scaleFactor: number;
    immutable: boolean;
}

export const BoardEditor: React.FC<IBoardEditorProps> = (props: IBoardEditorProps) => {
    const rowHeight = 40;
    const columnCount = 12;
    const containerPadding: [number, number] = [32, 32];
    const elementMargin: [number, number] = [10, 10];
    const rulerThickness = 20;
    return (
        <div className={classNames(styles.container, props.className)}>
            <AutoSizer>
                {({ height, width }) => (
                    <div style={{ width, height }}>
                        <div className={styles.content_with_rulers}>
                            <div className={styles.ruler_corner} />
                            <Ruler
                                className={styles.ruler_top}
                                width={width - rulerThickness}
                                height={rulerThickness}
                                orientation={RulerOrientation.Horizontal}
                                scaleFactor={props.scaleFactor}
                                stepCount={columnCount}
                                containerPadding={containerPadding[0]}
                                tickMargin={elementMargin[0]}
                            />
                            <div className={styles.content_scroller} style={{ height }}>
                                <div
                                    className={styles.content_container}
                                    style={{
                                        gridTemplateRows: `minmax(${height - rulerThickness}px, max-content)`,
                                    }}
                                >
                                    <Board
                                        className={styles.content}
                                        width={width - rulerThickness}
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
                                                    width={rulerThickness}
                                                    height={s.height}
                                                    orientation={RulerOrientation.Vertical}
                                                    scaleFactor={props.scaleFactor}
                                                    stepLength={rowHeight}
                                                    containerPadding={containerPadding[1]}
                                                    tickMargin={elementMargin[1]}
                                                />
                                            )}
                                        </AutoSizer>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </AutoSizer>
        </div>
    );
};
