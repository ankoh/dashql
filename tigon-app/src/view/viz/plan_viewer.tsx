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
            let graph = new dagre.graphlib.Graph()
                .setGraph({})
                .setDefaultEdgeLabel(function() { return {}; });

            let buffer = this.props.plan.buffer.getReader();
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
                graph.setNode(String(oid), { label: String(oid), width: 100, height: 48 })
            }

            // Create edges
            for (let oid = 0; oid < opCount; oid += 1) {
                let begin = getChildOffset(oid);
                let end = (oid + 1 < ofsCount) ? getChildOffset(oid + 1) : childCount;
                for (let cid = begin; cid < end; cid += 1) {
                    graph.setEdge(String(oid), String(getChild(cid)));
                }
            }

            dagre.layout(graph);

            // // // TODO(ankoh): Get rid of the any cast at some point (d3 <-> dagre)
            let render = new dagreD3.render() as any;
            render(d3.select(this.container.current), graph);
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
