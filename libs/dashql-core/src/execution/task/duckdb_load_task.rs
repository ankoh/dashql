use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task_planner::Task;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::import_info::ImportInfo;
use crate::execution::load_info::{CsvLoadInfo, JsonLoadInfo, LoadInfo, ParquetLoadInfo};
use crate::execution::task::TaskOperator;
use crate::external::database::DatabaseConnection;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{LoadStatement, Statement};
use async_trait::async_trait;
use dashql_proto as proto;
use proto::LoadMethodType;

pub struct DuckDBLoadTaskOperator<'ast> {
    statement: &'ast LoadStatement<'ast>,
    connection: Option<DatabaseConnection>,
}

impl<'ast> DuckDBLoadTaskOperator<'ast> {
    pub fn create(instance: &'ast ProgramInstance<'ast>, task: &'ast Task) -> Result<Self, SystemError> {
        let stmt_id = task.origin_statement.unwrap();
        let stmt: &'ast LoadStatement<'ast> = match instance.program.statements[stmt_id] {
            Statement::Load(l) => l,
            _ => return Err(SystemError::InvalidStatementType("expected load")),
        };
        Ok(Self {
            statement: stmt,
            connection: None,
        })
    }

    async fn try_create_view(&self, conn: &DatabaseConnection, import: &ImportInfo) -> Result<bool, SystemError> {
        if self.statement.method.get() == proto::LoadMethodType::JSON {
            return Ok(false);
        }
        match self.statement.method.get() {
            LoadMethodType::CSV => self.create_csv_table(conn, import).await?,
            LoadMethodType::PARQUET => self.create_parquet_view(conn, import).await?,
            _ => return Ok(false),
        }
        return Ok(true);
    }

    async fn create_parquet_view(&self, conn: &DatabaseConnection, import: &ImportInfo) -> Result<(), SystemError> {
        let name = self.statement.name.get();
        let name_string = print_ast_as_script_with_defaults(&name);
        let url = match import {
            ImportInfo::File(file) => &file.url,
            ImportInfo::Http(http) => &http.url,
            ImportInfo::Test(test) => &test.url,
        };
        let script = format!(
            "create table {} as select * from parquet_scan(\'{}\')",
            &name_string, url
        );
        conn.run_query(&script).await?;
        Ok(())
    }

    async fn create_csv_table(&self, conn: &DatabaseConnection, _import: &ImportInfo) -> Result<(), SystemError> {
        let script = format!("create table {} as select * from read_csv_auto(\"{}\")", "", "");
        conn.run_query(&script).await?;
        Ok(())
    }
}

#[async_trait(?Send)]
impl<'ast> TaskOperator<'ast> for DuckDBLoadTaskOperator<'ast> {
    async fn prepare<'snap>(&mut self, ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        self.connection = Some(ctx.base.database.connect().await?);
        Ok(())
    }
    async fn execute<'snap>(&mut self, ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let source = self.statement.source.get();
        let name = self.statement.name.get();
        let name_string = print_ast_as_script_with_defaults(&name);
        let import = match ctx.global_state.imports_by_name.get(source) {
            Some(import) => import,
            None => {
                return Err(SystemError::ImportNotRegistered(
                    self.statement.name.get_node_id(),
                    print_ast_as_script_with_defaults(&source),
                ))
            }
        };
        if !self
            .try_create_view(&self.connection.as_ref().unwrap(), &import)
            .await?
        {
            let hdl = ctx.base.runtime.import_data(&ctx, &import).await?;
            let info = match self.statement.method.get() {
                LoadMethodType::CSV => LoadInfo::Csv(CsvLoadInfo { name: name_string }),
                LoadMethodType::PARQUET => LoadInfo::Parquet(ParquetLoadInfo { name: name_string }),
                LoadMethodType::JSON => LoadInfo::Json(JsonLoadInfo { name: name_string }),
                _ => return Err(SystemError::NotImplemented("load method".to_string())),
            };
            ctx.base.runtime.load_data(&ctx, hdl, &info).await?;
        }
        Ok(())
    }
}
