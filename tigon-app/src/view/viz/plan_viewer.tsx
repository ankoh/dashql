import './plan_viewer.scss';
import * as proto from 'tigon-proto';
import * as React from 'react';
import * as Model from '../../model';
import * as d3 from 'd3';
import * as dagre from 'dagre';
import * as dagreD3 from 'dagre-d3';

interface IPlanViewerProps {
    plan: Model.CoreBuffer<proto.duckdb.QueryPlan> | null;
}

export class PlanViewer extends React.PureComponent<IPlanViewerProps> {
    protected container: React.RefObject<SVGSVGElement>;

    constructor(props: IPlanViewerProps) {
        super(props);
        this.container = React.createRef();
    }

    /// Get an operator name
    private getOperatorName(type: proto.duckdb.LogicalOperatorType) {
        var operatorTypeNames = [
            "INVALID",
            "PROJECTION",
            "FILTER",
            "AGGREGATE_AND_GROUP_BY",
            "WINDOW",
            "LIMIT",
            "ORDER_BY",
            "COPY_FROM_FILE",
            "COPY_TO_FILE",
            "DISTINCT",
            "INDEX_SCAN",
            "GET",
            "CHUNK_GET",
            "DELIM_GET",
            "EXPRESSION_GET",
            "TABLE_FUNCTION",
            "SUBQUERY",
            "EMPTY_RESULT",
            "JOIN",
            "DELIM_JOIN",
            "COMPARISON_JOIN",
            "ANY_JOIN",
            "CROSS_PRODUCT",
            "UNION",
            "EXCEPT",
            "INTERSECT",
            "INSERT",
            "DELETE",
            "UPDATE",
            "CREATE_TABLE",
            "CREATE_INDEX",
            "EXPLAIN",
            "PRUNE_COLUMNS",
            "PREPARE",
            "EXECUTE"
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
            .setDefaultEdgeLabel(function() { return {}; });

        let buffer = this.props.plan!.getReader();
        let opCount = buffer.operatorTypesLength();
        let ofsCount = buffer.operatorChildOffsetsLength();
        let childCount = buffer.operatorChildrenLength();

        // Get operator child
        let getChildOffset = function(index: number) {
            return (buffer.operatorChildOffsets(index) || flatbuffers.Long.ZERO).toFloat64();
        };
        let getChild = function(index: number) {
            return (buffer.operatorChildren(index) || flatbuffers.Long.ZERO).toFloat64();
        };

        // Create nodes
        for (let oid = 0; oid < opCount; oid += 1) {
            let name = this.getOperatorName(buffer.operatorTypes(oid) || 0);
            graph.setNode(String(oid), {
                label: name,
                width: 4 + name.length * 8,
                height: 12,
                rx: 3,
                ry: 3,
            })
        }

        // Create edges
        for (let oid = 0; oid < opCount; oid += 1) {
            let begin = getChildOffset(oid);
            let end = (oid + 1 < ofsCount) ? getChildOffset(oid + 1) : childCount;
            for (let cid = begin; cid < end; cid += 1) {
                graph.setEdge(String(oid), String(getChild(cid)), {
                    arrowhead: "undirected",
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
                {
                    this.props.plan &&
                    <svg ref={this.container} className="plan_viewer_graph">
                    </svg>       
                }
            </div>
        );
    }
}

export default PlanViewer;
