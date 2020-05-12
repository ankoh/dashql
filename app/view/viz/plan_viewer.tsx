import './plan_viewer.scss';
import * as proto from '@tigon/proto';
import * as React from 'react';
import * as d3 from 'd3';
import * as dagre from 'dagre';
import * as dagreD3 from 'dagre-d3';

interface IPlanViewerProps {
    plan: proto.engine.QueryPlan | null;
}

export class PlanViewer extends React.PureComponent<IPlanViewerProps> {
    protected container: React.RefObject<SVGSVGElement>;

    constructor(props: IPlanViewerProps) {
        super(props);
        this.container = React.createRef();
    }

    /// Get an operator name
    private getOperatorName(
        type: proto.engine.LogicalOperatorTypeMap[keyof proto.engine.LogicalOperatorTypeMap],
    ) {
        var operatorTypeNames = [
            'INVALID',
            'PROJECTION',
            'FILTER',
            'AGGREGATE_AND_GROUP_BY',
            'WINDOW',
            'LIMIT',
            'ORDER_BY',
            'COPY_FROM_FILE',
            'COPY_TO_FILE',
            'DISTINCT',
            'INDEX_SCAN',
            'GET',
            'CHUNK_GET',
            'DELIM_GET',
            'EXPRESSION_GET',
            'TABLE_FUNCTION',
            'SUBQUERY',
            'EMPTY_RESULT',
            'JOIN',
            'DELIM_JOIN',
            'COMPARISON_JOIN',
            'ANY_JOIN',
            'CROSS_PRODUCT',
            'UNION',
            'EXCEPT',
            'INTERSECT',
            'INSERT',
            'DELETE',
            'UPDATE',
            'CREATE_TABLE',
            'CREATE_INDEX',
            'EXPLAIN',
            'PRUNE_COLUMNS',
            'PREPARE',
            'EXECUTE',
        ];
        return operatorTypeNames[type];
    }

    public renderPlan() {
        let graph = new dagre.graphlib.Graph()
            .setGraph({
                ranksep: 20,
                nodesep: 8,
                edgesep: 8,
                rankdir: 'LR',
            })
            .setDefaultEdgeLabel(function () {
                return {};
            });

        let buffer = this.props.plan!;
        let opTypes = buffer.getOperatorTypesList();
        let childOffsets = buffer.getOperatorChildOffsetsList();
        let children = buffer.getOperatorChildrenList();
        let opCount = opTypes.length;

        // Create nodes
        for (let oid = 0; oid < opCount; oid += 1) {
            let name = this.getOperatorName(opTypes[oid] || 0);
            graph.setNode(String(oid), {
                label: name,
                width: 4 + name.length * 8,
                height: 12,
                rx: 3,
                ry: 3,
            });
        }

        // Create edges
        for (let oid = 0; oid < opCount; oid += 1) {
            let begin = childOffsets[oid];
            let end =
                oid + 1 < childOffsets.length
                    ? childOffsets[oid + 1]
                    : children.length;
            for (let cid = begin; cid < end; cid += 1) {
                graph.setEdge(String(oid), String(children[cid]), {
                    arrowhead: 'undirected',
                });
            }
        }

        // Compute the graph layout
        dagre.layout(graph);

        // Render the graph
        let render = new dagreD3.render() as any;
        let element = d3.select(this.container.current);
        render(element, graph);
    }

    /// Component did mount to the dom
    public componentDidMount() {
        if (this.container.current != null) {
            if (this.props.plan != null) {
                this.renderPlan();
            }
        }
    }

    /// Component received new props
    public componentDidUpdate() {
        if (this.container.current != null) {
            if (this.props.plan != null) {
                this.renderPlan();
            }
        }
    }

    public render() {
        return (
            <div className="plan_viewer">
                {this.props.plan && (
                    <svg
                        ref={this.container}
                        className="plan_viewer_graph"
                    ></svg>
                )}
            </div>
        );
    }
}

export default PlanViewer;
