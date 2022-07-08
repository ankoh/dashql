use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task::Task;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::external::database::DatabaseConnection;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{CreateViewStatement, Statement};
use async_trait::async_trait;

pub struct DuckDBCreateViewTaskOperator<'ast> {
    statement: &'ast CreateViewStatement<'ast>,
    connection: Option<DatabaseConnection>,
}

impl<'ast> DuckDBCreateViewTaskOperator<'ast> {
    pub fn create(instance: &'ast ProgramInstance<'ast>, task: &'ast Task) -> Result<Self, SystemError> {
        let stmt_id = task.origin_statement.unwrap();
        let stmt: &'ast CreateViewStatement<'ast> = match instance.program.statements[stmt_id] {
            Statement::CreateView(s) => s,
            _ => return Err(SystemError::InvalidStatementType("expected create")),
        };
        Ok(Self {
            statement: stmt,
            connection: None,
        })
    }
}

#[async_trait(?Send)]
impl<'ast> TaskOperator<'ast> for DuckDBCreateViewTaskOperator<'ast> {
    async fn prepare<'snap>(&mut self, ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        self.connection = Some(ctx.base.database.connect().await?);
        Ok(())
    }
    async fn execute<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let connection = self.connection.as_ref().unwrap();
        let script = print_ast_as_script_with_defaults(self.statement);
        connection.run_query(&script).await?;
        Ok(())
    }
}
