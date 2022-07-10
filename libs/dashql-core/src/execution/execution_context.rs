use super::import_info::ImportInfo;
use super::scalar_value::ScalarValue;
use crate::analyzer::analysis_settings::ProgramAnalysisSettings;
use crate::error::SystemError;
use crate::external;
use crate::external::database::NativeDatabase;
use crate::external::runtime;
use crate::external::Database;
use crate::grammar::Expression;
use crate::grammar::NamePath;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::RwLock;
use std::sync::RwLockReadGuard;
use std::sync::RwLockWriteGuard;

#[derive(Clone, Debug, Default)]
pub struct ExecutionState<'ast> {
    pub named_values: HashMap<NamePath<'ast>, Rc<ScalarValue>>,
    pub cached_values: HashMap<Expression<'ast>, Option<Rc<ScalarValue>>>,
    pub imports_by_name: HashMap<NamePath<'ast>, ImportInfo>,
}

impl<'ast> ExecutionState<'ast> {
    pub fn merge_into(mut self, other: &mut ExecutionState<'ast>) {
        for (k, v) in self.named_values.drain() {
            other.named_values.insert(k, v);
        }
        for (k, v) in self.cached_values.drain() {
            other.cached_values.insert(k, v);
        }
        for (k, v) in self.imports_by_name.drain() {
            other.imports_by_name.insert(k, v);
        }
    }
}

#[derive(Debug, Clone)]
pub struct ExecutionContext<'ast> {
    pub settings: Arc<ProgramAnalysisSettings>,
    pub runtime: Arc<dyn external::Runtime>,
    pub database: Arc<Mutex<dyn Database>>,
    pub arena: &'ast bumpalo::Bump,
    pub state: Arc<RwLock<ExecutionState<'ast>>>,
}

impl<'ast> ExecutionContext<'ast> {
    pub async fn create_simple(arena: &'ast bumpalo::Bump) -> Result<ExecutionContext<'ast>, SystemError> {
        let database = NativeDatabase::open_in_memory().await?;
        Ok(Self {
            settings: Arc::new(ProgramAnalysisSettings::default()),
            runtime: runtime::create(),
            database: Arc::new(Mutex::new(database)),
            arena,
            state: Arc::new(RwLock::new(ExecutionState::default())),
        })
    }
    pub fn create(
        settings: Arc<ProgramAnalysisSettings>,
        runtime: Arc<dyn external::Runtime>,
        database: Arc<Mutex<dyn Database>>,
        arena: &'ast bumpalo::Bump,
    ) -> Self {
        Self {
            settings,
            runtime,
            database,
            arena,
            state: Arc::new(RwLock::new(ExecutionState::default())),
        }
    }
}

impl<'ast> ExecutionContext<'ast> {
    pub fn snapshot<'snap>(&'snap self) -> ExecutionContextSnapshot<'ast, 'snap> {
        ExecutionContextSnapshot {
            base: self,
            global_state: self.state.read().unwrap(),
            local_state: Default::default(),
        }
    }

    pub fn try_write_global(&self) -> Result<RwLockWriteGuard<'_, ExecutionState<'ast>>, SystemError> {
        self.state
            .try_write()
            .map_err(|_| SystemError::InternalError("failed to lock global execution context"))
    }
}

#[derive(Debug)]
pub struct ExecutionContextSnapshot<'ast, 'snap> {
    pub base: &'snap ExecutionContext<'ast>,
    pub global_state: RwLockReadGuard<'snap, ExecutionState<'ast>>,
    pub local_state: ExecutionState<'ast>,
}

impl<'ast, 'snap> ExecutionContextSnapshot<'ast, 'snap> {
    pub fn finish(self) -> ExecutionState<'ast> {
        self.local_state
    }
}
