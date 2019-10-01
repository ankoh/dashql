import './plan_viewer.scss';
import * as React from 'react';
import * as Model from '../../model';
import * as d3 from 'd3';
import * as dagre from 'dagre';
import * as dagreD3 from 'dagre-d3';

interface IPlanViewerProps {
    plan: Model.QueryPlan;
}

export class PlanViewer extends React.PureComponent<IPlanViewerProps> {
    protected container: React.RefObject<SVGSVGElement>;

    constructor(props: IPlanViewerProps) {
        super(props);
        this.container = React.createRef();
    }

    // Component did mount to the dom
    public componentDidMount() {
        if (this.container.current != null) {
            let graph = new dagre.graphlib.Graph();
            graph.setGraph({});

            let buffer = this.props.plan.plan.getBuffer();
            let opCount = buffer.operatorTypesLength();
            let ofsCount = buffer.operatorChildOffsetsLength();
            let childCount = buffer.operatorChildrenLength();

            // Get operator child
            let getOpChild = function(index: number) {
                return (buffer.operatorChildOffsets(index) || flatbuffers.Long.ZERO).toFloat64();
            };

            console.log("opCount " + opCount);
            console.log("opChildOffsets " + ofsCount);

            // Create nodes
            for (let oid = 0; oid < opCount; oid += 1) {
                console.log("Node: " + String(oid));
                graph.setNode(String(oid), { width: 100, height: 48 })
            }

            // Create edges
            for (let oid = 0; oid < opCount; oid += 1) {
                let begin = getOpChild(oid);
                let end = (oid + 1 === ofsCount) ? getOpChild(oid + 1) : childCount;
                for (let cid = begin; cid < end; cid += 1) {
                    graph.setEdge(String(oid), String(cid));
                }
            }

            dagre.layout(graph);

            // TODO(ankoh): Get rid of the any cast at some point (d3 <-> dagre)
            let render = new dagreD3.render() as any;
            let svg = d3.select(this.container.current);
            render(svg, graph);
        }
    }

    public render() {
        return (
            <div className="plan_viewer">
                <svg ref={this.container} className="plan_viewer_graph">
                </svg>       
            </div>
        );
    }
}

export default PlanViewer;
