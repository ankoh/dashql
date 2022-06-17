use super::import::Import;
use super::scalar_value::ScalarValue;
use crate::grammar::Expression;
use crate::grammar::NamePath;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::RwLock;
use std::sync::RwLockReadGuard;

#[derive(Clone, Debug, Default)]
pub struct ExecutionContextData<'ast> {
    pub named_values: HashMap<NamePath<'ast>, Rc<ScalarValue>>,
    pub cached_values: HashMap<Expression<'ast>, Option<Rc<ScalarValue>>>,
    pub imports_by_id: HashMap<usize, Import>,
}

impl<'ast> ExecutionContextData<'ast> {
    pub fn merge_into(mut self, other: &mut ExecutionContextData<'ast>) {
        for (k, v) in self.named_values.drain() {
            other.named_values.insert(k, v);
        }
        for (k, v) in self.cached_values.drain() {
            other.cached_values.insert(k, v);
        }
        for (k, v) in self.imports_by_id.drain() {
            other.imports_by_id.insert(k, v);
        }
    }
}

#[derive(Debug, Clone)]
pub struct ExecutionContext<'ast> {
    pub arena: &'ast bumpalo::Bump,
    pub data: Arc<RwLock<ExecutionContextData<'ast>>>,
}

impl<'ast> ExecutionContext<'ast> {
    pub fn with_arena(arena: &'ast bumpalo::Bump) -> Self {
        Self {
            arena,
            data: Arc::new(RwLock::new(ExecutionContextData::default())),
        }
    }
}

impl<'ast> ExecutionContext<'ast> {
    pub fn snapshot<'snap>(&'snap self) -> ExecutionContextSnapshot<'ast, 'snap> {
        ExecutionContextSnapshot {
            arena: self.arena,
            global: self.data.read().unwrap(),
            local: Default::default(),
        }
    }
}

#[derive(Debug)]
pub struct ExecutionContextSnapshot<'ast, 'snap> {
    pub arena: &'ast bumpalo::Bump,
    pub global: RwLockReadGuard<'snap, ExecutionContextData<'ast>>,
    pub local: ExecutionContextData<'ast>,
}

impl<'ast, 'snap> ExecutionContextSnapshot<'ast, 'snap> {
    pub fn finish(self) -> ExecutionContextData<'ast> {
        self.local
    }
}
