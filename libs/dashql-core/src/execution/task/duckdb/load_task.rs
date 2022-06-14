use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use crate::grammar::{LoadStatement, Statement};
use async_trait::async_trait;
use dashql_proto as proto;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct LoadTask {
    task: Rc<ProgramTask>,
    conn: Box<dyn DatabaseConnection>,
}

fn infer_load_method(url: &str) -> proto::LoadMethodType {
    if url.ends_with(".parquet") {
        return proto::LoadMethodType::PARQUET;
    } else if url.ends_with(".json") {
        return proto::LoadMethodType::JSON;
    } else if url.ends_with(".csv") {
        return proto::LoadMethodType::CSV;
    }
    return proto::LoadMethodType::NONE;
}

impl LoadTask {
    fn get_statement<'a>(&self, ctx: &TaskContext<'a>) -> Result<&'a LoadStatement<'a>, SystemError> {
        match &ctx.program.statements[self.task.origin_statement] {
            Statement::Load(load) => Ok(load),
            _ => Err(SystemError::InvalidStatementType("load")),
        }
    }
}

#[async_trait(?Send)]
impl Task for LoadTask {
    async fn prepare(&mut self, _ctx: &mut TaskContext) -> Result<(), SystemError> {
        todo!()
    }

    async fn execute(&mut self, _ctx: &mut TaskContext) -> Result<(), SystemError> {
        todo!()
    }
}
