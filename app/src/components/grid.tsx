import * as React from 'react';
import { createPortal } from 'react-dom';
import { GridItemHTMLElement, GridStack, GridStackNode, GridStackOptions, GridStackWidget } from 'gridstack';

const GridContext = React.createContext(undefined as { grid: GridStack; listeners: WidgetListeners } | undefined);

export type WidgetProps = GridStackWidget & {
    /** Event firing when the widget is placed on the grid. */
    onAdded?: WidgetAddedListener;
    /** Event firing when the widget has been moved or resized on the grid. */
    onChange?: WidgetChangeListener;
    /** Event firing when starting to drag the widget. */
    onDragStart?: WidgetDragStartListener;
    /** Event firing when stopping to drag the widget. */
    onDragStop?: WidgetDragStopListener;
    /** Event firing when the widget has been removed from the grid. */
    onRemoved?: WidgetRemovedListener;
    /** Event firing when starting to resize the widget. */
    onResizeStart?: WidgetResizeStartListener;
    /** Event firing when stopping to resize the widget. */
    onResizeStop?: WidgetResizeStopListener;
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

type WidgetWithContextState = {
    /** The current grid context, in which this widget is rendered. */
    context: GridContext | null;
    /** The DOM element that is placed as widget on the grid. */
    widget: GridItemHTMLElement | null;
    /** The DOM element that should hold the inner widget content. */
    contentNode: Element | null;
};

class WidgetWithContext extends React.Component<WidgetWithContextProps, WidgetWithContextState> {
    state: WidgetWithContextState = {
        context: null,
        widget: null,
        contentNode: null,
    };

    /** Run all operations needed when the grid changes which holds our widget. */
    updateGrid = () => {
        const { context } = this.props;

        // Context is the same as previously, nothing to be done.
        if (context === this.state.context) {
            return;
        }

        const newState: WidgetWithContextState = {
            context: null,
            widget: null,
            contentNode: null,
        };

        const {
            onAdded,
            onChange,
            onDragStart,
            onDragStop,
            onRemoved,
            onResizeStart,
            onResizeStop,
            ...widgetProps
        } = this.props;

        // Delete properties that do not belong to `GridStackWidget` options.
        delete widgetProps.context;
        delete widgetProps.children;

        const listeners = {
            onAdded,
            onChange,
            onDragStart,
            onDragStop,
            onRemoved,
            onResizeStart,
            onResizeStop,
        };

        // We previously had a (different) grid, remove widget from it.
        if (this.state.context && this.state.widget) {
            this.state.context.grid.removeWidget(this.state.widget);

            // Remove all listeners we registered on the grid context.
            for (const [event, listener] of Object.entries(listeners)) {
                const eventListeners = this.state.context.listeners[event as keyof WidgetListeners];

                if (listener) {
                    eventListeners.delete(this.state.widget);
                }
            }
        }

        if (context) {
            const { grid } = context;

            // Determine which arguments need to be passed to `addWidget`.
            const widgetArguments = (() => {
                if (Object.keys(widgetProps).length == 0) {
                    // Create a new widget without options.
                    return [];
                } else {
                    // Create a new widget from the provided properties.
                    return [widgetProps];
                }
            })();

            // Request a new widget DOM node that is managed by the new grid.
            const widget = grid.addWidget(...widgetArguments);

            // Get the content node of the widget (which is a sibling among e.g. he resize handle nodes).
            const contentNode = widget.querySelector('.grid-stack-item-content');

            // Register our event listeners on the grid context.
            for (const [event, listener] of Object.entries(listeners)) {
                const eventListeners = context.listeners[event as keyof WidgetListeners];

                if (listener) {
                    eventListeners.set(
                        widget,
                        listener as WidgetAddedListener &
                            WidgetChangeListener &
                            WidgetDragStartListener &
                            WidgetDragStopListener &
                            WidgetRemovedListener &
                            WidgetResizeStartListener &
                            WidgetResizeStopListener,
                    );
                }
            }

            newState.context = context;
            newState.widget = widget;
            newState.contentNode = contentNode;
        }

        this.setState(newState);
    };

    /** Update the widget's dimensions in the grid (if changed). */
    updateDimensions(prevProps: WidgetWithContextProps) {
        const dimensionsChanged =
            this.props.x !== prevProps.x ||
            this.props.y !== prevProps.y ||
            this.props.width !== prevProps.width ||
            this.props.height !== prevProps.height;

        if (this.state.context && this.state.widget && dimensionsChanged) {
            // Update widget dimensions on the grid.
            this.state.context.grid.update(
                this.state.widget,
                this.props.x,
                this.props.y,
                this.props.width,
                this.props.height,
            );
        }
    }

    componentDidMount() {
        this.updateGrid();
    }

    componentDidUpdate(prevProps: WidgetWithContextProps) {
        this.updateGrid();
        this.updateDimensions(prevProps);
    }

    componentWillUnmount() {
        if (this.state.context && this.state.widget) {
            this.state.context.grid.removeWidget(this.state.widget);
        }
    }

    render() {
        const { contentNode } = this.state;

        // We don't have any DOM node yet into which we can render our content.
        if (!contentNode) {
            return null;
        }

        // Render widget contents into the correct DOM node managed by the grid.
        return createPortal(this.props.children, contentNode);
    }
}

/** A generic event callback as accepted by the `grid.on` method. */
type GridEventCallback = (event: Event, arg2?: GridStackNode[] | GridItemHTMLElement | undefined) => void;

/** Listener handling event when the widget is placed on the grid. */
type WidgetAddedListener = (event: Event, item: GridStackNode) => void;

/** Listener handling event when the widget has been moved or resized on the grid. */
type WidgetChangeListener = (event: Event, items: GridStackNode) => void;

/** Listener handling event when starting to drag the widget. */
type WidgetDragStartListener = (event: Event, element: GridItemHTMLElement) => void;

/** Listener handling event when stopping to drag the widget. */
type WidgetDragStopListener = (event: Event, element: GridItemHTMLElement) => void;

/** Listener handling event when the widget has been removed from the grid. */
type WidgetRemovedListener = (event: Event, items: GridStackNode) => void;

/** Listener handling event when starting to resize the widget. */
type WidgetResizeStartListener = (event: Event, element: GridItemHTMLElement) => void;

/** Listener handling event when stopping to resize the widget. */
type WidgetResizeStopListener = (event: Event, element: GridItemHTMLElement) => void;

type WidgetListeners = {
    /** An `Added` event listener corresponding to an element on the grid. */
    onAdded: WeakMap<GridItemHTMLElement, WidgetAddedListener>;
    /** A `Change` event listener corresponding to an element on the grid. */
    onChange: WeakMap<GridItemHTMLElement, WidgetChangeListener>;
    /** A `DragStart` event listener corresponding to an element on the grid. */
    onDragStart: WeakMap<GridItemHTMLElement, WidgetDragStartListener>;
    /** A `DragStop` event listener corresponding to an element on the grid. */
    onDragStop: WeakMap<GridItemHTMLElement, WidgetDragStopListener>;
    /** A `Removed` event listener corresponding to an element on the grid. */
    onRemoved: WeakMap<GridItemHTMLElement, WidgetRemovedListener>;
    /** A `ResizeStart` event listener corresponding to an element on the grid. */
    onResizeStart: WeakMap<GridItemHTMLElement, WidgetResizeStartListener>;
    /** A `ResizeStart` event listener corresponding to an element on the grid. */
    onResizeStop: WeakMap<GridItemHTMLElement, WidgetResizeStartListener>;
};

/** Listener handling event when items are added to the grid. */
type GridAddedListener = (event: Event, items: GridStackNode[]) => void;
/** Listener handling event when items change on the grid. */
type GridChangeListener = (event: Event, items: GridStackNode[]) => void;
/** Listener handling event when the grid is disabled. */
type GridDisableListener = (event: Event) => void;
/** Listener handling event when starting to drag a widget on the grid. */
type GridDragStartListener = (event: Event, element: GridItemHTMLElement) => void;
/** Listener handling event when stopping to drag a widget on the grid. */
type GridDragStopListener = (event: Event, element: GridItemHTMLElement) => void;
/** Listener handling event when a widget is dropped onto the grid. */
type GridDroppedListener = (event: Event, previousWidget: GridStackNode, newWidget: GridStackNode) => void;
/** Listener handling event when the grid is enabled. */
type GridEnableListener = (event: Event) => void;
/** Listener handling event when items are removed from the grid. */
type GridRemovedListener = (event: Event, items: GridStackNode[]) => void;
/** Listener handling event when starting to resize a widget on the grid. */
type GridResizeStartListener = (event: Event, element: GridItemHTMLElement) => void;
/** Listener handling event when stopping to resize a widget on the grid. */
type GridResizeStopListener = (event: Event, element: GridItemHTMLElement) => void;

type GridListeners = {
    /** Event firing when widgets are placed on the grid. */
    onAdded: GridAddedListener | null;
    /** Event firing when widgets have been moved or resized on the grid. */
    onChange: GridChangeListener | null;
    /** Event firing when the grid is disabled. */
    onDisable: GridDisableListener | null;
    /** Event firing when starting to drag a widget on the grid. */
    onDragStart: GridDragStartListener | null;
    /** Event firing when stopping to drag a widget on the grid. */
    onDragStop: GridDragStopListener | null;
    /** Event firing when a widget has been dropped onto the grid. */
    onDropped: GridDroppedListener | null;
    /** Event firing when the grid is enabled. */
    onEnable: GridEnableListener | null;
    /** Event firing when a widget has been removed from the grid. */
    onRemoved: GridRemovedListener | null;
    /** Event firing when starting to resize a widget on the grid. */
    onResizeStart: GridResizeStartListener | null;
    /** Event firing when stopping to resize a widget on the grid. */
    onResizeStop: GridResizeStopListener | null;
};

export type GridProps = GridStackOptions & GridListeners;

type GridContext = {
    /** The grid instance. */
    grid: GridStack;
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
        onAdded: new WeakMap(),
        onChange: new WeakMap(),
        onDragStart: new WeakMap(),
        onDragStop: new WeakMap(),
        onRemoved: new WeakMap(),
        onResizeStart: new WeakMap(),
        onResizeStop: new WeakMap(),
    };

    componentDidMount() {
        // Initialize the grid.
        const grid = GridStack.init(this.props, this.refs.grid as HTMLElement);

        const handleAdded: GridAddedListener = (event: Event, items: GridStackNode[]) => {
            for (const item of items) {
                const element = item.el;

                if (element) {
                    const listener = this.widgetListeners.onAdded.get(element);
                    listener?.(event, item);
                }
            }

            this.props.onAdded?.(event, items);
        };

        const handleChange: GridChangeListener = (event: Event, items: GridStackNode[]) => {
            for (const item of items) {
                const element = item.el;

                if (element) {
                    const listener = this.widgetListeners.onChange.get(element);
                    listener?.(event, item);
                }
            }

            this.props.onChange?.(event, items);
        };

        const handleDisable: GridDisableListener = (event: Event) => {
            this.props.onDisable?.(event);

            this.props.onDisable?.(event);
        };

        const handleDragStart: GridDragStartListener = (event: Event, element: GridItemHTMLElement) => {
            const listener = this.widgetListeners.onDragStart.get(element);
            listener?.(event, element);

            this.props.onDragStart?.(event, element);
        };

        const handleDragStop: GridDragStopListener = (event: Event, element: GridItemHTMLElement) => {
            const listener = this.widgetListeners.onDragStop.get(element);
            listener?.(event, element);

            this.props.onDragStop?.(event, element);
        };

        const handleDropped: GridDroppedListener = (
            event: Event,
            previousWidget: GridStackNode,
            newWidget: GridStackNode,
        ) => {
            this.props.onDropped?.(event, previousWidget, newWidget);
        };

        const handleEnable: GridEnableListener = (event: Event) => {
            this.props.onEnable?.(event);

            this.props.onEnable?.(event);
        };

        const handleRemoved: GridRemovedListener = (event: Event, items: GridStackNode[]) => {
            for (const item of items) {
                const element = item.el;

                if (element) {
                    const listener = this.widgetListeners.onRemoved.get(element);
                    listener?.(event, item);
                }
            }

            this.props.onRemoved?.(event, items);
        };

        const handleResizeStart: GridResizeStartListener = (event: Event, element: GridItemHTMLElement) => {
            const listener = this.widgetListeners.onResizeStart.get(element);
            listener?.(event, element);

            this.props.onResizeStart?.(event, element);
        };

        const handleResizeStop: GridResizeStopListener = (event: Event, element: GridItemHTMLElement) => {
            const listener = this.widgetListeners.onResizeStop.get(element);
            listener?.(event, element);

            this.props.onResizeStop?.(event, element);
        };

        grid.on('added', handleAdded as GridEventCallback);
        grid.on('change', handleChange as GridEventCallback);
        grid.on('disable', handleDisable as GridEventCallback);
        grid.on('dragstart', handleDragStart as GridEventCallback);
        grid.on('dragstop', handleDragStop as GridEventCallback);
        grid.on('dropped', (handleDropped as unknown) as GridEventCallback);
        grid.on('enable', handleEnable as GridEventCallback);
        grid.on('removed', handleRemoved as GridEventCallback);
        grid.on('resizestart', handleResizeStart as GridEventCallback);
        grid.on('resizestop', handleResizeStop as GridEventCallback);

        this.setState({
            context: {
                grid,
                listeners: this.widgetListeners,
            },
        });
    }

    componentWillUnmount() {
        // Destroy the grid.
        this.state.context?.grid.destroy();
    }

    render() {
        return (
            <div ref="grid" className="grid-stack">
                <GridContext.Provider value={this.state.context}>{this.props.children}</GridContext.Provider>
            </div>
        );
    }
}
