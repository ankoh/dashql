mod interpreter;

pub type Ast = ();

static mut PREVIOUS_GRAPH: Option<interpreter::DashGraph> = None;

pub fn evaluate(ast: &Ast) -> Vec<interpreter::DashOperation> {
    let graph: interpreter::DashGraph = ast.into();

    let operations: interpreter::DashOperations =
        if let Some(previous_graph) = unsafe { &PREVIOUS_GRAPH } {
            (previous_graph, &graph).into()
        } else {
            (&graph).into()
        };

    unsafe {
        PREVIOUS_GRAPH = Some(graph);
    }

    operations.operations
}
