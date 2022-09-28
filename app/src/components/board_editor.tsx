import * as React from 'react';
import classNames from 'classnames';
import { observeSize } from '../utils/size_observer';
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

    const containerElement = React.useRef(null);
    const containerSize = observeSize(containerElement);
    const leftRulerElement = React.useRef(null);
    const leftRulerSize = observeSize(containerElement);

    return (
        <div ref={containerElement} className={classNames(styles.container, props.className)}>
            {containerSize && (
                <div className={styles.content_with_rulers}>
                    <div className={styles.ruler_corner} />
                    <Ruler
                        className={styles.ruler_top}
                        width={containerSize.width - rulerThickness}
                        height={rulerThickness}
                        orientation={RulerOrientation.Horizontal}
                        scaleFactor={props.scaleFactor}
                        stepCount={columnCount}
                        containerPadding={containerPadding[0]}
                        tickMargin={elementMargin[0]}
                    />
                    <div className={styles.content_scroller} style={{ height: containerSize.height }}>
                        <div
                            className={styles.content_container}
                            style={{
                                gridTemplateRows: `minmax(${containerSize.height - rulerThickness}px, max-content)`,
                            }}
                        >
                            <Board
                                className={styles.content}
                                width={containerSize.width - rulerThickness}
                                editable={true}
                                columnCount={columnCount}
                                rowHeight={rowHeight}
                                containerPadding={containerPadding}
                                elementMargin={elementMargin}
                            />
                            <div ref={leftRulerElement} className={styles.ruler_left}>
                                {leftRulerSize && (
                                    <Ruler
                                        width={rulerThickness}
                                        height={
                                            containerSize.height -
                                            rulerThickness -
                                            2 /* increasing this remove a the weird scrolling */
                                        }
                                        orientation={RulerOrientation.Vertical}
                                        scaleFactor={props.scaleFactor}
                                        stepLength={rowHeight}
                                        containerPadding={containerPadding[1]}
                                        tickMargin={elementMargin[1]}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
