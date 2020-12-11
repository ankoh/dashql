import * as React from 'react';
import { Responsive as GridLayout, ResponsiveProps, ItemCallback, Layout } from 'react-grid-layout';

const GridContext = React.createContext(undefined as { listeners: WidgetListeners } | undefined);

export type WidgetProps = {
    /** The horizontal position of the widget on the grid. */
    x?: number;
    /** The vertical position of the widget on the grid. */
    y?: number;
    /** The width of the widget. */
    w?: number;
    /** The height of the widget. */
    h?: number;
    /** The minimum width of the widget. */
    minW?: number;
    /** The maximum width of the widget. */
    maxW?: number;
    /** The minimum height of the widget. */
    minH?: number;
    /** The maximum height of the widget. */
    maxH?: number;
    /** If true, equal to `isDraggable: false, isResizable: false`. */
    static?: boolean;
    /** If false, will not be draggable. Overrides `static`. */
    isDraggable?: boolean;
    /** If false, will not be resizable. Overrides `static`. */
    isResizable?: boolean;
    /** By default, a handle is only shown on the bottom-right (southeast) corner. */
    /** Note that resizing from the top or left is generally not intuitive. */
    resizeHandles?: ['s' | 'w' | 'e' | 'n' | 'sw' | 'nw' | 'se' | 'ne'][];
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
                {context => <WidgetWithContext {...this.props} context={context} />}
            </GridContext.Consumer>
        );
    }
}

type WidgetWithContextProps = WidgetProps & {
    /** The grid context, in which this widget should be rendered. */
    context?: GridContext;
};

class WidgetWithContext extends React.Component<WidgetWithContextProps> {
    declare context: React.ContextType<typeof GridContext>;

    componentDidUpdate(prevProps: WidgetWithContextProps) {
        this.context.listeners;
    }

    render() {
        return (
            <div
                data-grid={{
                    x: this.props.x,
                    y: this.props.y,
                    w: this.props.w,
                    h: this.props.h,
                    minW: this.props.minW,
                    maxW: this.props.maxW,
                    minH: this.props.minH,
                    maxH: this.props.maxH,
                    static: this.props.static,
                    isDraggable: this.props.isDraggable,
                    isResizable: this.props.isResizable,
                    resizeHandles: this.props.resizeHandles,
                    isBounded: this.props.isBounded,
                }}
            >
                {this.props.children}
            </div>
        );
    }
}

type WidgetListeners = {
    /** A `DragStart` event listener corresponding to an element on the grid. */
    onDragStart: WeakMap<HTMLElement, ItemCallback>;
    /** A `Drag` event listener corresponding to an element on the grid. */
    onDrag: WeakMap<HTMLElement, ItemCallback>;
    /** A `DragStop` event listener corresponding to an element on the grid. */
    onDragStop: WeakMap<HTMLElement, ItemCallback>;
    /** A `ResizeStart` event listener corresponding to an element on the grid. */
    onResizeStart: WeakMap<HTMLElement, ItemCallback>;
    /** A `Resize` event listener corresponding to an element on the grid. */
    onResize: WeakMap<HTMLElement, ItemCallback>;
    /** A `ResizeStart` event listener corresponding to an element on the grid. */
    onResizeStop: WeakMap<HTMLElement, ItemCallback>;
};

export type GridProps = ResponsiveProps;

type GridContext = {
    /** The event listeners attached to the grid. */
    listeners: WidgetListeners;
};

type GridState = {
    context?: GridContext;
};

/**
 * Grid component, managing a `gridstack` grid with React.
 *
 * Please refer to https://gridstackjs.com for a full set of documentation and examples.
 */
export class Grid extends React.Component<GridProps, GridState> {
    state: GridState = {
        context: undefined,
    };

    widgetListeners: WidgetListeners = {
        onDragStart: new WeakMap(),
        onDrag: new WeakMap(),
        onDragStop: new WeakMap(),
        onResizeStart: new WeakMap(),
        onResize: new WeakMap(),
        onResizeStop: new WeakMap(),
    };

    handleDragStart = (
        layout: Layout[],
        oldItem: Layout,
        newItem: Layout,
        placeholder: Layout,
        event: MouseEvent,
        element: HTMLElement,
    ) => {
        const listener = this.widgetListeners.onDragStart.get(element);
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
        const listener = this.widgetListeners.onDrag.get(element);
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
        const listener = this.widgetListeners.onDragStop.get(element);
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
        const listener = this.widgetListeners.onResizeStart.get(element);
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
        const listener = this.widgetListeners.onResize.get(element);
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
        const listener = this.widgetListeners.onResizeStop.get(element);
        listener?.(layout, oldItem, newItem, placeholder, event, element);

        this.props.onResizeStop?.(layout, oldItem, newItem, placeholder, event, element);
    };

    render() {
        return (
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
                breakpoints={this.props.breakpoints}
                cols={this.props.cols}
                margin={this.props.margin}
                containerPadding={this.props.containerPadding}
                layouts={this.props.layouts}
                onBreakpointChange={this.props.onBreakpointChange}
                onLayoutChange={this.props.onLayoutChange}
                onWidthChange={this.props.onWidthChange}
            >
                <GridContext.Provider value={this.state.context}>{this.props.children}</GridContext.Provider>
            </GridLayout>
        );
    }
}
