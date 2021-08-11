import * as core from '@dashql/core';
import * as React from 'react';
import ReactGrid from 'react-grid-layout';
import { CardRenderer } from './card';

import './board.module.css';

type Props = {
    className?: string;
    width: number;
    editable?: boolean;
    columnCount: number;
    rowHeight: number;
    containerPadding: [number, number];
    elementMargin: [number, number];
};

interface LayoutElement {
    card: core.model.CardSpecification;
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

export const Board: React.FC<Props> = (props: Props) => {
    const analyzer = core.analyzer.useAnalyzer();
    const programContextDispatch = core.model.useProgramContextDispatch();
    const planContext = core.model.usePlanContext();

    const layout = React.useMemo(() => {
        const els: LayoutElement[] = [];
        planContext.cards.forEach(card => {
            els.push({
                card: card,
                i: card.objectId.toString(),
                x: card.position.column,
                y: card.position.row,
                w: card.position.width || 12,
                h: card.position.height || 4,
            });
        });
        return els;
    }, [planContext.cards]);

    const userExpectation = React.useRef<boolean>();
    const onLayoutChanged = () => {
        if (!userExpectation.current) return;
        userExpectation.current = false;
        const updates: core.edit.EditOperationVariant[] = layout.map(l => ({
            statementID: (l as LayoutElement).card.statementID,
            type: core.edit.EditOperationType.UPDATE_CARD_POSITION,
            data: {
                position: {
                    row: l.y,
                    column: l.x,
                    width: l.w,
                    height: l.h,
                },
            },
        }));
        const next = analyzer.editProgram(updates);
        if (next) {
            programContextDispatch({
                type: core.model.REWRITE_PROGRAM,
                data: next,
            });
        }
    };

    const els: React.ReactElement[] = [];
    for (const l of layout) {
        if (!l.card.visible) continue;
        els.push(
            <div key={l.card.objectId}>
                <CardRenderer card={l.card} editable={props.editable} />
            </div>,
        );
    }
    return (
        <ReactGrid
            className={props.className}
            resizeHandles={['se']}
            width={props.width}
            cols={props.columnCount}
            rowHeight={props.rowHeight}
            compactType={null}
            isDraggable={!!props.editable}
            isResizable={!!props.editable}
            onLayoutChange={onLayoutChanged}
            onDragStart={() => (userExpectation.current = true)}
            onResizeStart={() => (userExpectation.current = true)}
            layout={layout}
            containerPadding={props.containerPadding}
            margin={props.elementMargin}
        >
            {els}
        </ReactGrid>
    );
};
