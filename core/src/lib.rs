use wasm_bindgen::prelude::wasm_bindgen;
mod interpreter;
mod proto;

pub struct Ast {}

impl<'a> From<&dashql_parser::syntax::Module<'a>> for Ast {
    fn from(module: &dashql_parser::syntax::Module<'a>) -> Self {
        todo!()
    }
}

static mut PREVIOUS_GRAPH: Option<interpreter::DashGraph> = None;

#[wasm_bindgen]
pub struct DashOperations {
    pub data_ptr: u64,
    pub data_size: u64,
    pub data_offset: u64,
}

#[wasm_bindgen]
pub fn interpret(module: *const dashql_parser::syntax::Module) -> DashOperations {
    let module = unsafe { module.as_ref() }.unwrap();
    let ast: Ast = module.into();
    let graph: interpreter::DashGraph = (&ast).into();

    let operations: interpreter::DashOperations =
        if let Some(previous_graph) = unsafe { &PREVIOUS_GRAPH } {
            (previous_graph, &graph).into()
        } else {
            (&graph).into()
        };

    unsafe {
        PREVIOUS_GRAPH = Some(graph);
    }

    todo!()
}
