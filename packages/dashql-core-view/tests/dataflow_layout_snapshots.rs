//! The dataflow layout snapshots (snapshots/dataflow_layout/*.yaml), with the default layout config.

use dashql_core_view::dataflow_layout::{compute_dataflow_layout, DataflowLayoutBox, DataflowLayoutConfig, DataflowLayoutEdge};
use dashql_snapshots::encode::dataflow_layout::LayoutFixture;
use dashql_snapshots::{compare, load_category, run, Arguments, Failed, Trial};

fn main() {
    let args = Arguments::from_args();
    let mut trials = Vec::new();
    for case in load_category("dataflow_layout").expect("cannot load dataflow layout snapshots") {
        trials.push(Trial::test(case.trial_name(), move || {
            let expected = case.expected().ok_or_else(|| Failed::from("missing expected"))?;
            let fixture = LayoutFixture::from_yaml(&case.node).map_err(Failed::from)?;
            let boxes: Vec<DataflowLayoutBox> = fixture
                .boxes
                .iter()
                .map(|b| DataflowLayoutBox { statements: b.rows, chart_statement: b.chart, collapsed: b.collapsed, fixed: b.fixed })
                .collect();
            let edges: Vec<DataflowLayoutEdge> = fixture
                .edges
                .iter()
                .map(|&(from_box, from_statement, to_box, to_statement)| DataflowLayoutEdge { from_box, from_statement, to_box, to_statement })
                .collect();
            let layout = compute_dataflow_layout(&boxes, &edges, &DataflowLayoutConfig::default());
            let actual: Vec<_> = layout.iter().map(|g| (g.x, g.y, g.width, g.height)).collect();
            compare(expected, &fixture.encode(&actual).to_yaml()).map_err(Failed::from)
        }));
    }
    run(&args, trials).exit();
}
