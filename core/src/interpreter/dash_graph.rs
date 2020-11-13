use super::dash_operations::{DashOperation, DashOperations};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Default)]
pub struct DashGraph {
    nodes: HashMap<DashNodeHandle, DashNode>,
    consumers: HashSet<DashNodeHandle>,
}

impl DashGraph {
    pub fn get_node_count(&self) -> usize {
        self.nodes.len()
    }

    pub fn get_consumers(&self) -> Vec<DashNodeHandle> {
        self.consumers.clone().into_iter().collect()
    }

    pub fn remove_node(&mut self, handle: DashNodeHandle) -> DashNode {
        let node = self.nodes.remove(&handle).unwrap();

        for producer in node.get_producers() {
            self.get_node_mut(producer).remove_consumer(handle);
        }

        for consumer in node.get_consumers() {
            self.get_node_mut(consumer).remove_producer(handle);
        }

        node
    }

    pub fn get_node(&self, handle: DashNodeHandle) -> &DashNode {
        self.nodes.get(&handle).unwrap()
    }

    pub fn get_node_mut(&mut self, handle: DashNodeHandle) -> &mut DashNode {
        self.nodes.get_mut(&handle).unwrap()
    }
}

#[derive(Debug)]
pub struct DashNode {
    producers: HashSet<DashNodeHandle>,
    consumers: HashSet<DashNodeHandle>,
    pub operation: DashOperation,
}

impl DashNode {
    pub fn get_producers(&self) -> Vec<DashNodeHandle> {
        self.producers.clone().into_iter().collect()
    }

    pub fn get_producers_count(&self) -> usize {
        self.producers.len()
    }

    pub fn add_producer(&mut self, handle: DashNodeHandle) -> bool {
        self.producers.insert(handle)
    }

    pub fn remove_producer(&mut self, handle: DashNodeHandle) -> bool {
        self.producers.remove(&handle)
    }

    pub fn get_consumers(&self) -> Vec<DashNodeHandle> {
        self.consumers.clone().into_iter().collect()
    }

    pub fn get_consumers_count(&self) -> usize {
        self.consumers.len()
    }

    pub fn add_consumer(&mut self, handle: DashNodeHandle) -> bool {
        self.consumers.insert(handle)
    }

    pub fn remove_consumer(&mut self, handle: DashNodeHandle) -> bool {
        self.consumers.remove(&handle)
    }
}

#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub struct DashNodeHandle(usize);

impl DashNodeHandle {
    pub fn new(handle: usize) -> Self {
        Self { 0: handle }
    }
}

impl From<&super::super::Ast> for DashGraph {
    fn from(ast: &super::super::Ast) -> Self {
        // TODO
        Default::default()
    }
}
