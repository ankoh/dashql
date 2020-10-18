use super::dash_graph::{DashGraph, DashNodeHandle};
use super::heap::MinHeap;

pub struct DashOperations {
    operations: Vec<DashOperation>,
}

struct HeapDashNode {
    graph: *const DashGraph,
    handle: DashNodeHandle,
}

impl<'graph> Eq for HeapDashNode {}

impl PartialEq for HeapDashNode {
    fn eq(&self, other: &Self) -> bool {
        self.handle == other.handle
    }
}

impl Ord for HeapDashNode {
    fn cmp(&self, other: &HeapDashNode) -> std::cmp::Ordering {
        let graph = unsafe { &*self.graph };

        let producers_self = graph.get_node(self.handle).get_producers_count();
        let producers_other = graph.get_node(other.handle).get_producers_count();

        producers_self.cmp(&producers_other).reverse()
    }
}

impl<'graph> PartialOrd for HeapDashNode {
    fn partial_cmp(&self, other: &HeapDashNode) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
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

#[derive(Debug, Clone)]
pub enum DashOperation {
    Parameter,
    Load,
    Extract,
    Query,
    Visualize,
}
