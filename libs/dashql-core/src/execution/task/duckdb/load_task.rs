use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::import::{FileImport, HttpImport, Import, TestImport};
use crate::execution::task::Task;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{LoadStatement, NamePath, Program};
use async_trait::async_trait;
use dashql_proto as proto;
use duckdbx_api::api::DatabaseConnection;
use proto::LoadMethodType;
use std::rc::Rc;

pub struct LoadTask<'ast> {
    program: &'ast Program<'ast>,
    statement: &'ast LoadStatement<'ast>,
    task: Rc<ProgramTask>,
    target: NamePath<'ast>,
    connection: Box<dyn DatabaseConnection>,
}

impl<'ast> LoadTask<'ast> {
    async fn try_create_view(&self, _import: &Import) -> Result<bool, SystemError> {
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
        let _script = format!("create view {} as parquet_scan(\"{}\")", "", "");
        Ok(())
    }

    async fn create_csv_view(&self) -> Result<(), SystemError> {
        let _script = format!("create view {} as read_csv_auto(\"{}\")", "", "");
        Ok(())
    }

    async fn fetch_data_from_file(&mut self, _import: &FileImport) -> Result<(), SystemError> {
        Ok(())
    }

    async fn fetch_data_from_http(&mut self, _import: &HttpImport) -> Result<(), SystemError> {
        Ok(())
    }

    async fn fetch_data_from_test(&mut self, _import: &TestImport) -> Result<(), SystemError> {
        Ok(())
    }
}

#[async_trait(?Send)]
impl<'ast> Task<'ast> for LoadTask<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        todo!()
    }

    async fn execute<'snap>(&mut self, ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let import = match ctx.global.imports_by_name.get(self.target) {
            Some(import) => import,
            None => {
                return Err(SystemError::ImportNotRegistered(
                    self.statement.name.get_node_id(),
                    print_ast_as_script_with_defaults(&self.target),
                ))
            }
        };
        if !self.try_create_view(&import).await? {
            match import {
                Import::File(i) => self.fetch_data_from_file(i).await?,
                Import::Http(i) => self.fetch_data_from_http(i).await?,
                Import::Test(i) => self.fetch_data_from_test(i).await?,
            }
        }
        Ok(())
    }
}
