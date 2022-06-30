use crate::grammar::Statement;

use super::program_instance::ProgramInstance;
use std::collections::HashSet;

pub fn determine_statement_liveness<'a>(inst: &mut ProgramInstance<'a>) {
    inst.statement_liveness.resize(inst.program.statements.len(), false);

    // Prepare DFSs starting from viz and input statements
    let mut pending = Vec::new();
    let mut visited = HashSet::new();
    for (stmt_id, stmt) in inst.program.statements.iter().enumerate() {
        match stmt {
            Statement::Viz(_) | Statement::Declare(_) => pending.push(stmt_id),
            _ => {}
        }
    }

    // Propagate dependencies
    while !pending.is_empty() {
        let next = *pending.last().unwrap();
        pending.pop();
        inst.statement_liveness[next] = true;
        if visited.contains(&next) {
            continue;
        }
        visited.insert(next);
        for ((_, dep), _) in inst.statement_depends_on.range((next, 0)..(next + 1, 0)) {
            pending.push(*dep);
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::analyzer::name_resolution::*;
    use crate::execution::execution_context::ExecutionContext;
    use crate::external::parser::parse;
    use crate::grammar;
    use std::collections::HashMap;
    use std::error::Error;
    use std::rc::Rc;

    async fn test_liveness(script: &'static str, expected: &[bool]) -> Result<(), Box<dyn Error + Send + Sync>> {
        let arena = bumpalo::Bump::new();
        let context = ExecutionContext::create_simple(&arena).await?;
        let ast = parse(&arena, script)?;
        let prog = Rc::new(grammar::deserialize_ast(&arena, script, ast).unwrap());
        let mut ctx = ProgramInstance::new(context, script, ast, prog, HashMap::new());
        normalize_statement_names(&mut ctx);
        discover_statement_dependencies(&mut ctx);
        determine_statement_liveness(&mut ctx);
        assert_eq!(&ctx.statement_liveness, expected);
        Ok(())
    }

    #[tokio::test]
    async fn test_simple_0() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_liveness(r#"SELECT 1"#, &[false]).await
    }

    #[tokio::test]
    async fn test_simple_1() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_liveness(
            r#"
            CREATE TABLE foo AS SELECT 1;
            VISUALIZE foo USING TABLE;
        "#,
            &[true, true],
        )
        .await
    }

    #[tokio::test]
    async fn test_simple_2() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_liveness(
            r#"
            CREATE TABLE dead AS SELECT 42;
            CREATE TABLE foo AS SELECT 1;
            VISUALIZE foo USING TABLE;
        "#,
            &[false, true, true],
        )
        .await
    }
}
