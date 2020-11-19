declare module "dagre-d3" {
    import * as d3 from "d3";
    import * as dagre from "dagre";
    export const render: { new (): Render };
    export const intersect: {
        [shapeName: string]: (
        node: dagre.Node,
        points: Array<{}>,
        point: any
        ) => void;
    };

    export interface Render {
        arrows(): {
            [arrowStyleName: string]: (
                parent: d3.Selection<d3.BaseType, any, d3.BaseType, any>,
                id: string,
                edge: dagre.Edge,
                type: string
            ) => void;
        };
        (
            selection: d3.Selection<d3.BaseType, any, d3.BaseType, any>,
            g: dagre.graphlib.Graph
        ): void;
        shapes(): {
            [shapeStyleName: string]: (
                parent: d3.Selection<d3.BaseType, any, d3.BaseType, any>,
                bbox: any,
                node: dagre.Node
            ) => void;
        };
    }
}
