use super::dash_graph::{DashGraph, DashNodeHandle};

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

impl From<DashGraph> for DashOperations {
    fn from(mut graph: DashGraph) -> Self {
        let mut heap = (0..graph.get_node_count())
            .into_iter()
            .map(|handle| HeapDashNode {
                graph: &graph,
                handle: DashNodeHandle::new(handle),
            })
            .collect::<std::collections::BinaryHeap<_>>();

        let mut operations = Vec::new();

        while let Some(top) = heap.pop() {
            let node = graph.remove_node(top.handle);

            operations.push(node.operation);
        }

        Self { operations }
    }
}

pub enum DashOperation {
    Parameter,
    Load,
    Extract,
    Query,
    Visualize,
}
