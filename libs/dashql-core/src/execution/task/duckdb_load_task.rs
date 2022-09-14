use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task_planner::TaskGraph;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::execution::task_state::{TableRef, TaskState, ViewRef};
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{LoadStatement, Statement};
use async_trait::async_trait;
use dashql_proto as proto;
use proto::LoadMethodType;
use std::sync::Arc;

pub struct DuckDBLoadTaskOperator<'ast> {
    state_id: usize,
    instance: Arc<ProgramInstance<'ast>>,
    task_graph: Arc<TaskGraph>,
    statement: &'ast LoadStatement<'ast>,
}

impl<'ast> DuckDBLoadTaskOperator<'ast> {
    pub fn create(
        instance: &Arc<ProgramInstance<'ast>>,
        task_graph: &Arc<TaskGraph>,
        task_id: usize,
    ) -> Result<Self, SystemError> {
        let task = &task_graph.tasks[task_id];
        let stmt_id = task.origin_statement.unwrap();
        let stmt: &'ast LoadStatement<'ast> = match instance.program.statements[stmt_id] {
            Statement::Load(l) => l,
            _ => return Err(SystemError::InvalidStatementType("expected load".to_string())),
        };
        Ok(Self {
            state_id: task.state_id,
            instance: instance.clone(),
            task_graph: task_graph.clone(),
            statement: stmt,
        })
    }

    async fn try_load_with_duckdb<'snap>(
        &self,
        ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        state: &TaskState,
    ) -> Result<bool, SystemError> {
        if self.statement.method.get() == proto::LoadMethodType::JSON {
            return Ok(false);
        }
        match self.statement.method.get() {
            LoadMethodType::CSV => self.create_csv_table(ctx, state).await?,
            LoadMethodType::PARQUET => self.create_parquet_view(ctx, state).await?,
            _ => return Ok(false),
        }
        return Ok(true);
    }

    async fn create_parquet_view<'snap>(
        &self,
        ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        state: &TaskState,
    ) -> Result<(), SystemError> {
        let conn = ctx.base.database_connection.as_ref();
        let name = self.statement.name.get();
        let name_string = print_ast_as_script_with_defaults(&name);
        let url = resolve_source_url(state)?;
        let script = format!(
            "create view {} as select * from parquet_scan(\'{}\')",
            &name_string, &url
        );
        conn.run_query(&script).await?;
        let view = Arc::new(TaskState::ViewRef(ViewRef { name: name_string }));
        ctx.local_state.state_by_id.insert(self.state_id, view.clone());
        Ok(())
    }

    async fn create_csv_table<'snap>(
        &self,
        ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        state: &TaskState,
    ) -> Result<(), SystemError> {
        let conn = ctx.base.database_connection.as_ref();
        let name = self.statement.name.get();
        let name_string = print_ast_as_script_with_defaults(&name);
        let url = resolve_source_url(state)?;
        let script = format!(
            "create table {} as select * from read_csv_auto(\'{}\')",
            &name_string, &url
        );
        conn.run_query(&script).await?;
        let table = Arc::new(TaskState::TableRef(TableRef { name: name_string }));
        ctx.local_state.state_by_id.insert(self.state_id, table.clone());
        Ok(())
    }
}

#[async_trait(?Send)]
impl<'ast> TaskOperator<'ast> for DuckDBLoadTaskOperator<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let source = self.statement.source.get();
        let name = self.statement.name.get();
        let name_string = print_ast_as_script_with_defaults(&name);
        let source_stmt_id = match self.instance.statement_by_name.get(source) {
            Some(stmt) => *stmt,
            None => {
                return Err(SystemError::TargetNotKnown(
                    self.statement.name.get_node_id(),
                    print_ast_as_script_with_defaults(&source),
                ))
            }
        };
        let source_task_id = self.task_graph.task_by_statement[source_stmt_id];
        let state = match ctx.global_state.state_by_id.get(&source_task_id) {
            Some(state) => state.clone(),
            None => {
                return Err(SystemError::TargetNotAvailable(
                    self.statement.name.get_node_id(),
                    print_ast_as_script_with_defaults(&source),
                ))
            }
        };
        if !self.try_load_with_duckdb(ctx, &state).await? {
            let hdl = ctx.base.runtime.import_data(&ctx, &state).await?;
            let state = match self.statement.method.get() {
                LoadMethodType::CSV => TaskState::TableRef(TableRef { name: name_string }),
                LoadMethodType::PARQUET => TaskState::ViewRef(ViewRef { name: name_string }),
                LoadMethodType::JSON => TaskState::TableRef(TableRef { name: name_string }),
                _ => return Err(SystemError::NotImplemented("load method".to_string())),
            };
            ctx.base.runtime.load_data(&ctx, hdl, &state).await?;
        }
        Ok(())
    }
}

fn resolve_source_url(state: &TaskState) -> Result<&String, SystemError> {
    let url = match state {
        TaskState::FileDataRef(file) => &file.url,
        TaskState::HttpDataRef(http) => &http.url,
        TaskState::TestDataRef(test) => &test.url,
        _ => return Err(SystemError::InvalidDataType(format!("{:?}", state))),
    };
    return Ok(url);
}
