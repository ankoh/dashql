use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::import_info::ImportInfo;
use crate::execution::task::Task;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{LoadStatement, NamePath, Program};
use async_trait::async_trait;
use dashql_proto as proto;
use duckdbx_api::api::DatabaseConnection;
use proto::LoadMethodType;
use std::rc::Rc;

pub struct LoadTask<'ast> {
    _program: &'ast Program<'ast>,
    statement: &'ast LoadStatement<'ast>,
    _task: Rc<ProgramTask>,
    target: NamePath<'ast>,
    _connection: Box<dyn DatabaseConnection>,
}

impl<'ast> LoadTask<'ast> {
    async fn try_create_view(&self, _import: &ImportInfo) -> Result<bool, SystemError> {
        if self.statement.method.get() == proto::LoadMethodType::JSON {
            return Ok(false);
        }
        match self.statement.method.get() {
            LoadMethodType::CSV => self.create_csv_view().await?,
            LoadMethodType::PARQUET => self.create_parquet_view().await?,
            _ => return Ok(false),
        }
        return Ok(true);
    }

    async fn create_parquet_view(&self) -> Result<(), SystemError> {
        let _script = format!("create view {} as select * from parquet_scan(\"{}\")", "", "");
        Ok(())
    }

    async fn create_csv_view(&self) -> Result<(), SystemError> {
        let _script = format!("create view {} as select * from read_csv_auto(\"{}\")", "", "");
        Ok(())
    }
}

#[async_trait(?Send)]
impl<'ast> Task<'ast> for LoadTask<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        todo!()
    }

    async fn execute<'snap>(&mut self, ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let import = match ctx.global_state.imports_by_name.get(self.target) {
            Some(import) => import,
            None => {
                return Err(SystemError::ImportNotRegistered(
                    self.statement.name.get_node_id(),
                    print_ast_as_script_with_defaults(&self.target),
                ))
            }
        };
        if !self.try_create_view(&import).await? {
            let hdl = ctx.base.runtime.import_data(&ctx, &import).await?;
            ctx.base.runtime.load_data(&ctx, hdl).await?;
        }
        Ok(())
    }
}
