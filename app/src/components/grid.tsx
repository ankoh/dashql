import * as React from 'react';
import GridLayout from 'react-grid-layout';
import { ReactGridLayoutProps, ItemCallback, Layout } from 'react-grid-layout';

const GridContext = React.createContext((id: React.Key, props: WidgetProps | null) => {});

export type WidgetProps = {
    id: React.Key;
    /** The horizontal position of the widget on the grid. */
    x: number;
    /** The vertical position of the widget on the grid. */
    y: number;
    /** The width of the widget. */
    width: number;
    /** The height of the widget. */
    height: number;
    /** The minimum width of the widget. */
    minWidth?: number;
    /** The maximum width of the widget. */
    maxWidth?: number;
    /** The minimum height of the widget. */
    minHeight?: number;
    /** The maximum height of the widget. */
    maxHeight?: number;
    /** If true, equal to `isDraggable: false, isResizable: false`. */
    static?: boolean;
    /** If false, will not be draggable. Overrides `static`. */
    isDraggable?: boolean;
    /** If false, will not be resizable. Overrides `static`. */
    isResizable?: boolean;
    /** By default, a handle is only shown on the bottom-right (southeast) corner. */
    /** Note that resizing from the top or left is generally not intuitive. */
    resizeHandles?: ('s' | 'w' | 'e' | 'n' | 'sw' | 'nw' | 'se' | 'ne')[];
    /** If true and draggable, item will be moved only within grid. */
    isBounded?: boolean;
    /** Event firing when starting to drag the widget. */
    onDragStart?: ItemCallback;
    /** Event firing when draging the widget. */
    onDrag?: ItemCallback;
    /** Event firing when stopping to drag the widget. */
    onDragStop?: ItemCallback;
    /** Event firing when starting to resize the widget. */
    onResizeStart?: ItemCallback;
    /** Event firing when resizing the widget. */
    onResize?: ItemCallback;
    /** Event firing when stopping to resize the widget. */
    onResizeStop?: ItemCallback;
};

/**
 * Widget component, managing a `gridstack` widget with React.
 *
 * Please refer to https://gridstackjs.com for a full set of documentation and examples.
 */
export class Widget extends React.Component<WidgetProps> {
    render() {
        return (
            <GridContext.Consumer>
                {update => <WidgetWithContext {...this.props} update={update} />}
            </GridContext.Consumer>
        );
    }
}

type WidgetWithContextProps = WidgetProps & {
    update: (id: React.Key, props: WidgetProps | null) => void;
};

class WidgetWithContext extends React.Component<WidgetWithContextProps> {
    componentDidUpdate(prevProps: WidgetWithContextProps) {
        const { id } = this.props;

        if (this.props.update !== prevProps.update) {
            prevProps.update(id, null);
        }

        this.props.update(id, this.props);
    }

    render() {
        return this.props.children;
    }
}

type WidgetListeners = {
    /** A `DragStart` event listener corresponding to an element on the grid. */
    onDragStart: { [key in React.Key]?: ItemCallback };
    /** A `Drag` event listener corresponding to an element on the grid. */
    onDrag: { [key in React.Key]?: ItemCallback };
    /** A `DragStop` event listener corresponding to an element on the grid. */
    onDragStop: { [key in React.Key]?: ItemCallback };
    /** A `ResizeStart` event listener corresponding to an element on the grid. */
    onResizeStart: { [key in React.Key]?: ItemCallback };
    /** A `Resize` event listener corresponding to an element on the grid. */
    onResize: { [key in React.Key]?: ItemCallback };
    /** A `ResizeStart` event listener corresponding to an element on the grid. */
    onResizeStop: { [key in React.Key]?: ItemCallback };
};

export type GridProps = Omit<ReactGridLayoutProps, '' /* 'layouts' */>;

type GridContext = {
    /** The event listeners attached to the grid. */
    listeners: WidgetListeners;
};

type GridState = {
    layout: { [key in React.Key]: Layout };
};

/**
 * Grid component, managing a `gridstack` grid with React.
 *
 * Please refer to https://gridstackjs.com for a full set of documentation and examples.
 */
export class Grid extends React.Component<GridProps, GridState> {
    state: GridState = {
        layout: {},
    };

    widgetListeners: WidgetListeners = {
        onDragStart: {},
        onDrag: {},
        onDragStop: {},
        onResizeStart: {},
        onResize: {},
        onResizeStop: {},
    };

    update = (id: React.Key, props: WidgetProps | null) => {
        console.log('update', id, props);

        const layout = {
            ...this.state.layout,
        };

        if (props === null) {
            delete layout[id];

            delete this.widgetListeners.onDragStart[id];
            delete this.widgetListeners.onDrag[id];
            delete this.widgetListeners.onDragStop[id];
            delete this.widgetListeners.onResizeStart[id];
            delete this.widgetListeners.onResize[id];
            delete this.widgetListeners.onResizeStop[id];
        } else {
            layout[id] = {
                i: String(id),
                x: props.x,
                y: props.y,
                w: props.width,
                h: props.height,
                minW: props.minWidth,
                maxW: props.maxWidth,
                minH: props.minHeight,
                maxH: props.maxHeight,
                static: props.static,
                isDraggable: props.isDraggable,
                isResizable: props.isResizable,
                resizeHandles: props.resizeHandles,
                isBounded: props.isBounded,
            };

            this.widgetListeners.onDragStart[id] = props.onDragStart;
            this.widgetListeners.onDrag[id] = props.onDrag;
            this.widgetListeners.onDragStop[id] = props.onDragStop;
            this.widgetListeners.onResizeStart[id] = props.onResizeStart;
            this.widgetListeners.onResize[id] = props.onResize;
            this.widgetListeners.onResizeStop[id] = props.onResizeStop;
        }

        this.setState({
            layout,
        });
    };

    handleDragStart = (
        layout: Layout[],
        oldItem: Layout,
        newItem: Layout,
        placeholder: Layout,
        event: MouseEvent,
        element: HTMLElement,
    ) => {
        const listener = this.widgetListeners.onDragStart[oldItem.i];
        listener?.(layout, oldItem, newItem, placeholder, event, element);

        this.props.onDragStart?.(layout, oldItem, newItem, placeholder, event, element);
    };

    handleDrag = (
        layout: Layout[],
        oldItem: Layout,
        newItem: Layout,
        placeholder: Layout,
        event: MouseEvent,
        element: HTMLElement,
    ) => {
        console.log('handleDrag', layout, oldItem, newItem, placeholder, event, element);
        const listener = this.widgetListeners.onDrag[oldItem.i];
        listener?.(layout, oldItem, newItem, placeholder, event, element);

        this.props.onDrag?.(layout, oldItem, newItem, placeholder, event, element);
    };

    handleDragStop = (
        layout: Layout[],
        oldItem: Layout,
        newItem: Layout,
        placeholder: Layout,
        event: MouseEvent,
        element: HTMLElement,
    ) => {
        const listener = this.widgetListeners.onDragStop[oldItem.i];
        listener?.(layout, oldItem, newItem, placeholder, event, element);

        this.props.onDragStop?.(layout, oldItem, newItem, placeholder, event, element);
    };

    handleResizeStart = (
        layout: Layout[],
        oldItem: Layout,
        newItem: Layout,
        placeholder: Layout,
        event: MouseEvent,
        element: HTMLElement,
    ) => {
        const listener = this.widgetListeners.onResizeStart[oldItem.i];
        listener?.(layout, oldItem, newItem, placeholder, event, element);

        this.props.onResizeStart?.(layout, oldItem, newItem, placeholder, event, element);
    };

    handleResize = (
        layout: Layout[],
        oldItem: Layout,
        newItem: Layout,
        placeholder: Layout,
        event: MouseEvent,
        element: HTMLElement,
    ) => {
        console.log('handleResize', layout, oldItem, newItem, placeholder, event, element);
        const listener = this.widgetListeners.onResize[oldItem.i];
        listener?.(layout, oldItem, newItem, placeholder, event, element);

        this.props.onResize?.(layout, oldItem, newItem, placeholder, event, element);
    };

    handleResizeStop = (
        layout: Layout[],
        oldItem: Layout,
        newItem: Layout,
        placeholder: Layout,
        event: MouseEvent,
        element: HTMLElement,
    ) => {
        const listener = this.widgetListeners.onResizeStop[oldItem.i];
        listener?.(layout, oldItem, newItem, placeholder, event, element);

        this.props.onResizeStop?.(layout, oldItem, newItem, placeholder, event, element);
    };

    render() {
        return (
            <GridContext.Provider value={this.update}>
                <GridLayout
                    className={this.props.className}
                    style={this.props.style}
                    autoSize={this.props.autoSize}
                    draggableCancel={this.props.draggableCancel}
                    draggableHandle={this.props.draggableHandle}
                    verticalCompact={this.props.verticalCompact}
                    compactType={this.props.compactType}
                    width={this.props.width}
                    rowHeight={this.props.rowHeight}
                    droppingItem={this.props.droppingItem}
                    isDraggable={this.props.isDraggable}
                    isResizable={this.props.isResizable}
                    resizeHandles={this.props.resizeHandles}
                    resizeHandle={this.props.resizeHandle}
                    isDroppable={this.props.isDroppable}
                    isBounded={this.props.isBounded}
                    preventCollision={this.props.preventCollision}
                    useCSSTransforms={this.props.useCSSTransforms}
                    maxRows={this.props.maxRows}
                    transformScale={this.props.transformScale}
                    onDragStart={this.handleDragStart}
                    onDrag={this.handleDrag}
                    onDragStop={this.handleDragStop}
                    onResizeStart={this.handleResizeStart}
                    onResize={this.handleResize}
                    onResizeStop={this.handleResizeStop}
                    onDrop={this.props.onDrop}
                    cols={this.props.cols}
                    margin={this.props.margin}
                    containerPadding={this.props.containerPadding}
                    layout={Object.values(this.state.layout)}
                    onLayoutChange={this.props.onLayoutChange}
                >
                    {React.Children.map(this.props.children, child => {
                        const key = (child as any).props.id;
                        return <div key={key}>{key}</div>;
                    })}
                    {(foo => (
                        <div key={foo}>{foo}</div>
                    ))('test')}
                    <div key="wat">wat</div>
                </GridLayout>
            </GridContext.Provider>
        );
    }
}
