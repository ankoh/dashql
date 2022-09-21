use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task_graph::TaskGraph;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::execution::task_state::{TableRef, TaskData, ViewRef};
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{LoadStatement, Statement};
use async_trait::async_trait;
use dashql_proto as proto;
use proto::LoadMethodType;
use std::sync::Arc;

pub struct DBLoadTaskOperator<'ast> {
    instance: Arc<ProgramInstance<'ast>>,
    task_graph: Arc<TaskGraph>,
    task_id: usize,
    statement: &'ast LoadStatement<'ast>,
}

impl<'ast> DBLoadTaskOperator<'ast> {
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
            instance: instance.clone(),
            task_graph: task_graph.clone(),
            task_id: task_id,
            statement: stmt,
        })
    }

    async fn try_load_with_duckdb<'snap>(
        &self,
        ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        source: &TaskData,
    ) -> Result<bool, SystemError> {
        if self.statement.method.get() == proto::LoadMethodType::JSON {
            return Ok(false);
        }
        match self.statement.method.get() {
            LoadMethodType::CSV => self.create_csv_table(ctx, source).await?,
            LoadMethodType::PARQUET => self.create_parquet_view(ctx, source).await?,
            _ => return Ok(false),
        }
        return Ok(true);
    }

    async fn create_parquet_view<'snap>(
        &self,
        ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        source: &TaskData,
    ) -> Result<(), SystemError> {
        let task = &self.task_graph.tasks[self.task_id];
        let conn = ctx.base.database_connection.as_ref();
        let name = self.statement.name.get();
        let name_string = print_ast_as_script_with_defaults(&name);
        let url = resolve_source_url(source)?;
        let script = format!(
            "create view {} as select * from parquet_scan(\'{}\')",
            &name_string, &url
        );
        conn.run_query(&script).await?;
        *task.data.write().unwrap() = Some(TaskData::ViewRef(ViewRef { name: name_string }));
        Ok(())
    }

    async fn create_csv_table<'snap>(
        &self,
        ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        source: &TaskData,
    ) -> Result<(), SystemError> {
        let task = &self.task_graph.tasks[self.task_id];
        let conn = ctx.base.database_connection.as_ref();
        let name = self.statement.name.get();
        let name_string = print_ast_as_script_with_defaults(&name);
        let url = resolve_source_url(source)?;
        let script = format!(
            "create table {} as select * from read_csv_auto(\'{}\')",
            &name_string, &url
        );
        conn.run_query(&script).await?;
        *task.data.write().unwrap() = Some(TaskData::TableRef(TableRef { name: name_string }));
        Ok(())
    }
}

#[async_trait(?Send)]
impl<'ast> TaskOperator<'ast> for DBLoadTaskOperator<'ast> {
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
                return Err(SystemError::SourceNotKnown(
                    self.statement.name.get_node_id(),
                    print_ast_as_script_with_defaults(&source),
                ))
            }
        };
        let source_task_id = self.task_graph.task_by_statement[source_stmt_id];
        let source_data = self.task_graph.tasks[source_task_id].data.read().unwrap();
        let source_data_ref = match source_data.as_ref() {
            Some(state) => state,
            None => {
                return Err(SystemError::TaskDataNotAvailable(
                    self.statement.name.get_node_id(),
                    print_ast_as_script_with_defaults(&source),
                ))
            }
        };
        if !self.try_load_with_duckdb(ctx, source_data_ref).await? {
            let hdl = ctx.base.runtime.import_data(&ctx, source_data_ref).await?;
            let state = match self.statement.method.get() {
                LoadMethodType::CSV => TaskData::TableRef(TableRef { name: name_string }),
                LoadMethodType::PARQUET => TaskData::ViewRef(ViewRef { name: name_string }),
                LoadMethodType::JSON => TaskData::TableRef(TableRef { name: name_string }),
                _ => return Err(SystemError::NotImplemented("load method".to_string())),
            };
            ctx.base.runtime.load_data(&ctx, hdl, &state).await?;
        }
        Ok(())
    }
}

fn resolve_source_url(state: &TaskData) -> Result<&String, SystemError> {
    let url = match state {
        TaskData::FileDataRef(file) => &file.url,
        TaskData::HttpDataRef(http) => &http.url,
        TaskData::TestDataRef(test) => &test.url,
        _ => return Err(SystemError::InvalidDataType(format!("{:?}", state))),
    };
    return Ok(url);
}
