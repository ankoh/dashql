import * as React from 'react';
import { createPortal } from 'react-dom';
import {
    GridStack,
    GridStackElement,
    GridStackOptions,
    GridStackWidget,
} from 'gridstack';

const GridContext = React.createContext(undefined as GridStack | undefined);

export type WidgetProps = GridStackWidget;

/**
 * Widget component, managing a `gridstack` widget with React.
 *
 * Please refer to https://gridstackjs.com for a full set of examples and
 * documentation.
 */
export class Widget extends React.Component<WidgetProps> {
    render() {
        return (
            <GridContext.Consumer>
                {grid => <WidgetWithContext {...this.props} grid={grid} />}
            </GridContext.Consumer>
        );
    }
}

type WidgetWithContextState = {
    /** The grid into which the widget should be rendered. */
    grid: GridStack | null;
    /** The DOM element that is placed as widget on the grid. */
    widget: GridStackElement | null;
    /** The DOM element that should hold the inner widget content. */
    contentNode: Element | null;
};

type WidgetWithContextProps = WidgetProps & {
    /** The grid instance. */
    grid?: GridStack;
};

class WidgetWithContext extends React.Component<
    WidgetWithContextProps,
    WidgetWithContextState
> {
    state: WidgetWithContextState = {
        contentNode: null,
        widget: null,
        grid: null,
    };

    /**
     * Run all operations needed when the grid changes which holds our widget.
     */
    updateGrid = () => {
        const { grid } = this.props;

        // Grid is the same as previously, nothing to be done.
        if (grid === this.state.grid) {
            return;
        }

        const newState: WidgetWithContextState = {
            grid: null,
            widget: null,
            contentNode: null,
        };

        // We previously had a (different) grid, remove widget from it.
        if (this.state.grid && this.state.widget) {
            this.state.grid.removeWidget(this.state.widget);
        }

        if (grid) {
            const widgetProps = { ...this.props };
            delete widgetProps.children;
            delete widgetProps.grid;

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

            // Get the content node of the widget (which is a sibling among e.g.
            // the resize handle nodes).
            const contentNode = widget.querySelector(
                '.grid-stack-item-content',
            );

            newState.grid = grid;
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

        if (this.state.grid && this.state.widget && dimensionsChanged) {
            // Update widget dimensions on the grid.
            this.state.grid.update(
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
        if (this.state.grid && this.state.widget) {
            this.state.grid.removeWidget(this.state.widget);
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

export type GridProps = GridStackOptions;

type GridState = {
    /** The grid instance. */
    grid?: GridStack;
};

/**
 * Grid component, managing a `gridstack` grid with React.
 *
 * Please refer to https://gridstackjs.com for a full set of examples and
 * documentation.
 */
export class Grid extends React.Component<GridProps, GridState> {
    state: GridState = {
        grid: undefined,
    };

    componentDidMount() {
        // Initialize the grid.
        const grid = GridStack.init(this.props, this.refs.grid as HTMLElement);

        this.setState({
            grid,
        });
    }

    componentWillUnmount() {
        // Destroy the grid.
        this.state.grid?.destroy();
    }

    render() {
        return (
            <div ref="grid" className="grid-stack">
                <GridContext.Provider value={this.state.grid}>
                    {this.props.children}
                </GridContext.Provider>
            </div>
        );
    }
}
