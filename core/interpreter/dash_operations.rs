use super::dash_graph::{DashGraph, DashNodeHandle};
use super::heap::MinHeap;

pub struct DashOperations {
    pub operations: Vec<DashOperation>,
}

impl From<&DashGraph> for DashOperations {
    fn from(graph: &DashGraph) -> Self {
        let mut heap = (0..graph.get_node_count())
            .into_iter()
            .map(|i| {
                let handle = DashNodeHandle::new(i);
                let count = graph.get_node(handle).get_producers_count();

                (handle, count)
            })
            .collect::<MinHeap<_>>();

        let mut operations = Vec::new();

        while let Some((handle, pending)) = heap.pop() {
            debug_assert!(
                pending == 0,
                "top heap element must not have pending dependencies"
            );

            // Decrement key of consumers
            for consumer in graph.get_node(handle).get_consumers() {
                heap.decrement_key(consumer);
            }

            let node = graph.get_node(handle);

            operations.push(node.operation.clone());
        }

        Self { operations }
    }
}

impl From<(&DashGraph, &DashGraph)> for DashOperations {
    fn from(graph: (&DashGraph, &DashGraph)) -> Self {
        todo!()
    }
}

#[derive(Debug, Clone)]
pub enum DashOperation {
    Parameter,
    Load,
    Extract,
    Query,
    Visualize,
}
