import * as core from '@dashql/core';
import * as React from 'react';
import * as model from '../model';
import ReactGrid from 'react-grid-layout';
import { useSelector, useDispatch } from 'react-redux';
import { IAppContext, withAppContext } from '../app_context';
import { CardRenderer } from './card';

import './board.module.css';

type Props = {
    appContext: IAppContext;
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

const InnerBoard: React.FC<Props> = (props: Props) => {
    const analyzer = props.appContext.platform!.analyzer;
    const dispatch = useDispatch();
    const planState = useSelector((state: model.AppState) => state.core.planState);

    const layout = React.useMemo(() => {
        const els: LayoutElement[] = [];
        core.model.forEachCard(planState, (card, i) => {
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
    }, [planState.objects]);

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
            model.mutate(dispatch, {
                type: core.model.StateMutationType.REWRITE_PROGRAM,
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

export const Board = withAppContext(InnerBoard);
