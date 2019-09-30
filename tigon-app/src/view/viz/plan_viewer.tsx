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
    protected container: React.RefObject<SVGElement>;

    constructor(props: IPlanViewerProps) {
        super(props);
        this.container = React.createRef();
    }

    // Component did mount to the dom
    public componentDidMount() {
        if (this.container.current != null) {
            let graph = new dagre.graphlib.Graph();

            let buffer = this.props.plan.plan.getBuffer();
            let ofsCount = buffer.operatorChildOffsetsLength();
            let childCount = buffer.operatorChildrenLength();

            // Get operator child
            let getOpChild = function(index: number) {
                return (buffer.operatorChildOffsets(index) || flatbuffers.Long.ZERO).toFloat64();
            };

            // Create nodes
            for (let oid = 0; oid < ofsCount; oid += 1) {
                graph.setNode(String(oid), { width: 100, height: 48 })
            }

            // Create edges
            for (let oid = 0; oid < ofsCount; oid += 1) {
                let begin = getOpChild(oid);
                let end = (oid + 1 == ofsCount) ? getOpChild(oid + 1) : childCount;
                for (let cid = begin; cid < end; cid += 1) {
                    graph.setEdge(String(oid), String(cid));
                }
            }

            dagre.layout(graph);

            let render = new dagreD3.render();
            let svg: d3.Selection<any> = d3.select(this.container.current);
            let inner = svg.append("g");
            render(svg, graph);
        }
    }

    public render() {


        return (
            <div className="plan_viewer">
                
            </div>
        );
    }
}

export default PlanViewer;
