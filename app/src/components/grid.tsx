import * as React from 'react';
import { createPortal } from 'react-dom';
import { GridStack, GridStackOptions, GridStackWidget } from 'gridstack';

/**
 * This class coordinates the interaction between a grid and grid widgets.
 *
 * It solves the problem of widgets potentially being rendered before the grid
 * itself is available. It will collect all widgets that want to register on
 * a grid and notify the widgets once the grid has been activated.
 *
 * To render a widget into a grid, both must use the same connection instance.
 */
export class GridConnection {
    private grid: GridStack | null = null;
    private subscribers: ((grid: GridStack) => void)[] = [];

    /**
     * Register a subscriber on the grid connection. The subscriber may be
     * called immediately (when the grid has been activated) or at a later point
     * (once the grid activates).
     */
    register(subscriber: (grid: GridStack) => void) {
        if (this.grid) {
            // Grid is available, immediately notify subscriber.
            subscriber(this.grid);
        } else {
            // Queue subscriber, so that it can be notified once the grid has
            // registered.
            this.subscribers.push(subscriber);
        }
    }

    /**
     * Register a grid, which will be notified to all currently queued and
     * future widget subscribers.
     */
    activate(grid: GridStack) {
        this.grid = grid;

        // Notify all subscribers of the registered grid.
        for (const subscriber of this.subscribers) {
            subscriber(this.grid);
        }

        this.subscribers = [];
    }
}

/** The default grid connection singleton. */
const defaultGridConnection = new GridConnection();

export type WidgetProps = GridStackWidget & {
    /**
     * The connection between the Grid and Widget components. If no connection
     * is provided, one shared default connection will be reused.
     *
     * If you want to render multiple independent grids, a new connection should
     * be created for each grid, which must shared between the grid and its
     * corresponding widgets.
     * */
    connection: GridConnection;
};

type WidgetState = {
    /** The DOM element that should hold the inner widget content. */
    contentNode: Element | null;
};

/** Widget component, managing a `gridstack` widget with React. */
export class Widget extends React.Component<WidgetProps, WidgetState> {
    static defaultProps = {
        connection: defaultGridConnection,
    };

    state: WidgetState = {
        contentNode: null,
    };

    /** The callback that is executed once the grid is available. */
    onGridAvailable = (grid: GridStack) => {
        // Request a new widget DOM node that is managed by the grid.
        const widget = grid.addWidget(this.props);

        // Get the content node of the widget (which is a sibling among e.g. the
        // resize handle nodes).
        const contentNode = widget.querySelector('.grid-stack-item-content');

        this.setState({
            contentNode,
        });
    };

    componentDidMount() {
        // Register on the connection to the grid.
        this.props.connection.register(this.onGridAvailable);
    }

    render() {
        const { contentNode } = this.state;

        if (!contentNode) {
            return null;
        }

        // Render widget contents into the correct DOM node managed by the grid.
        return createPortal(this.props.children, contentNode);
    }
}

export type GridProps = GridStackOptions & {
    /**
     * The connection between the Grid and Widget components. If no connection
     * is provided, one shared default connection will be reused.
     *
     * If you want to render multiple independent grids, a new connection should
     * be created for each grid, which must shared between the grid and its
     * corresponding widgets.
     * */
    connection: GridConnection;
};

type GridState = {
    grid: GridStack | null;
};

/** Grid component, managing a `gridstack` grid with React. */
export class Grid extends React.Component<GridProps, GridState> {
    static defaultProps = {
        connection: defaultGridConnection,
    };

    /** The grid instance. */
    grid: GridStack | null = null;

    componentDidMount() {
        // Initialize the grid.
        const grid = GridStack.init(this.props, this.refs.grid as HTMLElement);

        // Consume all widgets on the connection.
        this.props.connection.activate(grid);

        this.grid = grid;
    }

    componentWillUnmount() {
        // Destroy the grid.
        this.grid?.destroy();
    }

    render() {
        return (
            <div ref="grid" className="grid-stack">
                {this.props.children}
            </div>
        );
    }
}
