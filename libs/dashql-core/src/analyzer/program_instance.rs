use super::super::grammar::*;
use super::board_card::allocate_card_positions;
use super::board_card::collect_cards;
use super::board_card::Card;
use super::board_space::BoardPosition;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContext;
use crate::execution::scalar_value::ScalarValue;
use dashql_proto as proto;
use serde::ser::SerializeStruct;
use serde::Serialize;
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::sync::atomic::AtomicU32;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use crate::analyzer::liveness::determine_statement_liveness;
use crate::analyzer::name_resolution::{discover_statement_dependencies, normalize_statement_names};
use crate::grammar::Program;

pub type StatementID = usize;
pub type NodeID = usize;

static NEXT_INSTANCE_ID: AtomicU32 = AtomicU32::new(0);

#[derive(Debug)]
pub struct ProgramInstance<'a> {
    pub instance_id: u32,

    // The Context
    pub context: ExecutionContext<'a>,
    pub script_text: &'a str,
    pub program: Arc<Program<'a>>,

    // The input values
    pub input: HashMap<usize, ScalarValue>,

    // Analysis state
    pub node_error_messages: Vec<NodeError>,
    pub node_linter_messages: Vec<NodeLinterMessage>,
    pub statement_names: Vec<Option<NamePath<'a>>>,
    pub statement_by_name: HashMap<NamePath<'a>, usize>,
    pub statement_by_root: HashMap<usize, usize>,
    pub statement_required_for: BTreeMap<(StatementID, StatementID), (proto::DependencyType, NodeID)>,
    pub statement_depends_on: BTreeMap<(StatementID, StatementID), (proto::DependencyType, NodeID)>,
    pub statement_liveness: Vec<bool>,
    pub card_positions: HashMap<usize, BoardPosition>,
    pub cards: HashMap<usize, Card>,

    // Cached properties during analysis
    pub(super) cached_subtree_sizes: RefCell<Vec<usize>>,
    pub(super) cached_default_schema: RefCell<Option<&'a str>>,
}

#[derive(Debug)]
pub struct ProgramInstanceContainer {
    pub instance: ProgramInstance<'static>,
    pub program: Arc<ProgramContainer>,
}

unsafe impl<'a> Send for ProgramInstance<'a> {}

impl<'a> ProgramInstance<'a> {
    pub fn new(
        context: ExecutionContext<'a>,
        text: &'a str,
        program: Arc<Program<'a>>,
        input: HashMap<usize, ScalarValue>,
    ) -> Self {
        let instance_id = NEXT_INSTANCE_ID.fetch_add(1, Ordering::SeqCst);
        let mut ctx = ProgramInstance {
            instance_id,
            context,
            script_text: text,
            program: program.clone(),
            input,
            node_error_messages: Vec::new(),
            node_linter_messages: Vec::new(),
            statement_names: Vec::new(),
            statement_by_name: HashMap::default(),
            statement_by_root: HashMap::default(),
            statement_required_for: BTreeMap::new(),
            statement_depends_on: BTreeMap::new(),
            statement_liveness: Vec::new(),
            card_positions: HashMap::new(),
            cards: HashMap::new(),
            cached_subtree_sizes: RefCell::new(Vec::new()),
            cached_default_schema: RefCell::new(None),
        };
        let stmts_proto = program.ast_flat.statements().unwrap_or_default();
        ctx.statement_names.resize(stmts_proto.len(), None);
        ctx.statement_by_name.reserve(stmts_proto.len());
        ctx.statement_by_root.reserve(stmts_proto.len());
        for (stmt_id, stmt) in stmts_proto.iter().enumerate() {
            ctx.statement_by_root.insert(stmt.root_node() as usize, stmt_id);
        }
        ctx
    }

    pub fn wire(self, program: Arc<ProgramContainer>) -> ProgramInstanceContainer {
        ProgramInstanceContainer {
            instance: unsafe { std::mem::transmute(self) },
            program: program.clone(),
        }
    }
}

impl<'a> Serialize for ProgramInstance<'a> {
    fn serialize<S>(&self, s: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        #[derive(Serialize)]
        struct Dependency {
            source_stmt: usize,
            target_stmt: usize,
            target_node: usize,
        }
        let deps: Vec<_> = self
            .statement_depends_on
            .iter()
            .map(|((target, source), (_dep_type, node))| Dependency {
                source_stmt: *source,
                target_stmt: *target,
                target_node: *node,
            })
            .collect();

        let mut ana = s.serialize_struct("ProgramAnalysis", 10)?;
        ana.serialize_field("instance_id", &self.instance_id)?;
        ana.serialize_field("program_id", &self.program.program_id)?;
        ana.serialize_field("statement_dependencies", &deps)?;
        ana.serialize_field("statement_names", &self.statement_names)?;
        ana.serialize_field("statement_liveness", &self.statement_liveness)?;
        ana.serialize_field("node_error_messages", &self.node_error_messages)?;
        ana.serialize_field("node_linter_messages", &self.node_linter_messages)?;
        ana.serialize_field("cards", &self.cards)?;
        ana.end()
    }
}

pub fn analyze_program<'arena>(
    context: ExecutionContext<'arena>,
    text: &'arena str,
    program: Arc<Program<'arena>>,
    input: HashMap<usize, ScalarValue>,
) -> Result<ProgramInstance<'arena>, SystemError> {
    let mut inst = ProgramInstance::new(context, text, program, input);
    normalize_statement_names(&mut inst);
    discover_statement_dependencies(&mut inst);
    determine_statement_liveness(&mut inst);
    allocate_card_positions(&mut inst)?;
    collect_cards(&mut inst)?;
    Ok(inst)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NodeLinterMessage {
    pub node_id: u32,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum NodeErrorCode {
    ExpressionEvaluationFailed,
    InvalidInput,
    InvalidValueType,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NodeError {
    pub node_id: Option<u32>,
    pub error_code: NodeErrorCode,
    pub error_message: String,
}

#[cfg(test)]
mod test {

    use super::*;
    use crate::analyzer::program_instance::analyze_program;
    use crate::execution::scalar_value::ScalarValue;
    use crate::external::parser::parse_into;
    use crate::grammar;
    use dashql_proto as proto;
    use std::collections::HashMap;
    use std::error::Error;

    #[derive(Debug)]
    struct ExpectedTaskInstance {
        node_errors: Vec<NodeError>,
        linter_messages: Vec<NodeLinterMessage>,
        statement_names: Vec<Option<Vec<&'static str>>>,
        statement_by_name: Vec<(Vec<&'static str>, usize)>,
        statement_depends_on: Vec<(StatementID, StatementID, proto::DependencyType)>,
        statement_liveness: Vec<bool>,
    }

    #[derive(Debug)]
    struct TaskPlannerTest {
        script: &'static str,
        input: HashMap<usize, ScalarValue>,
        expected: ExpectedTaskInstance,
    }

    async fn test_planner(test: &TaskPlannerTest) -> Result<(), Box<dyn Error + Send + Sync>> {
        let arena = bumpalo::Bump::new();
        let context = ExecutionContext::create_simple(&arena).await?;
        let (ast, ast_data) = parse_into(&arena, test.script).await?;
        let prog = Arc::new(grammar::deserialize_ast(&arena, test.script, ast, ast_data).unwrap());
        let inst = analyze_program(context, test.script, prog, test.input.clone())?;

        assert_eq!(inst.node_error_messages.len(), test.expected.node_errors.len());
        for i in 0..inst.node_error_messages.len() {
            assert_eq!(inst.node_error_messages[i], test.expected.node_errors[i]);
        }
        assert_eq!(inst.node_linter_messages.len(), test.expected.linter_messages.len());
        for i in 0..inst.node_linter_messages.len() {
            assert_eq!(inst.node_linter_messages[i], test.expected.linter_messages[i]);
        }
        assert_eq!(inst.statement_names.len(), test.expected.statement_names.len());
        for i in 0..inst.statement_names.len() {
            let have = &inst.statement_names[i].map(|path| {
                let names: Vec<&str> = path
                    .iter()
                    .map(|c| match c.get() {
                        Indirection::Name(s) => s,
                        Indirection::Index(_) => panic!("unexpected index"),
                        Indirection::Bounds(_) => panic!("unepxected bounds"),
                    })
                    .collect();
                names
            });
            let want = &test.expected.statement_names[i];
            assert_eq!(have, want);
        }
        let mut statement_by_name: Vec<(Vec<&str>, usize)> = inst
            .statement_by_name
            .iter()
            .map(|(k, v)| {
                let names: Vec<&str> = k
                    .iter()
                    .map(|c| match c.get() {
                        Indirection::Name(s) => s,
                        Indirection::Index(_) => panic!("unexpected index"),
                        Indirection::Bounds(_) => panic!("unepxected bounds"),
                    })
                    .collect();
                (names, *v)
            })
            .collect();
        statement_by_name.sort_unstable();
        assert_eq!(statement_by_name, test.expected.statement_by_name);

        let mut statement_depends_on: Vec<(StatementID, StatementID, proto::DependencyType)> = inst
            .statement_depends_on
            .iter()
            .map(|((a, b), (dep, _))| (*a, *b, *dep))
            .collect();
        statement_depends_on.sort_unstable();
        assert_eq!(statement_depends_on, test.expected.statement_depends_on);

        let mut statement_required_for_flipped: Vec<(StatementID, StatementID, proto::DependencyType)> = inst
            .statement_required_for
            .iter()
            .map(|((a, b), (dep, _))| (*b, *a, *dep))
            .collect();
        statement_required_for_flipped.sort_unstable();
        assert_eq!(statement_required_for_flipped, test.expected.statement_depends_on);

        assert_eq!(inst.statement_liveness, test.expected.statement_liveness);
        Ok(())
    }

    #[tokio::test]
    async fn test_1() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_planner(&TaskPlannerTest {
            script: r#"
IMPORT a FROM 'http://remote/data1.parquet';
"#,
            input: HashMap::new(),
            expected: ExpectedTaskInstance {
                node_errors: vec![],
                linter_messages: vec![],
                statement_names: vec![Some(vec!["main", "a"])],
                statement_by_name: vec![(vec!["a"], 0), (vec!["main", "a"], 0)],
                statement_depends_on: vec![],
                statement_liveness: vec![false],
            },
        })
        .await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_2() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_planner(&TaskPlannerTest {
            script: r#"
CREATE TABLE a AS SELECT 1;
CREATE TABLE b AS SELECT 2;
"#,
            input: HashMap::new(),
            expected: ExpectedTaskInstance {
                node_errors: vec![],
                linter_messages: vec![],
                statement_names: vec![Some(vec!["main", "a"]), Some(vec!["main", "b"])],
                statement_by_name: vec![
                    (vec!["a"], 0),
                    (vec!["b"], 1),
                    (vec!["main", "a"], 0),
                    (vec!["main", "b"], 1),
                ],
                statement_depends_on: vec![],
                statement_liveness: vec![false, false],
            },
        })
        .await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_3() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_planner(&TaskPlannerTest {
            script: r#"
CREATE TABLE a AS SELECT 1;
CREATE TABLE b AS SELECT 2;
VIZ a USING TABLE;
"#,
            input: HashMap::new(),
            expected: ExpectedTaskInstance {
                node_errors: vec![],
                linter_messages: vec![],
                statement_names: vec![Some(vec!["main", "a"]), Some(vec!["main", "b"]), None],
                statement_by_name: vec![
                    (vec!["a"], 0),
                    (vec!["b"], 1),
                    (vec!["main", "a"], 0),
                    (vec!["main", "b"], 1),
                ],
                statement_depends_on: vec![(2, 0, proto::DependencyType::TABLE_REF)],
                statement_liveness: vec![true, false, true],
            },
        })
        .await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_4() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_planner(&TaskPlannerTest {
            script: r#"
IMPORT a FROM 'http://remote/data.parquet';
LOAD b FROM a USING PARQUET;
CREATE TABLE c AS SELECT * FROM b;
VIZ c USING TABLE;
"#,
            input: HashMap::new(),
            expected: ExpectedTaskInstance {
                node_errors: vec![],
                linter_messages: vec![],
                statement_names: vec![
                    Some(vec!["main", "a"]),
                    Some(vec!["main", "b"]),
                    Some(vec!["main", "c"]),
                    None,
                ],
                statement_by_name: vec![
                    (vec!["a"], 0),
                    (vec!["b"], 1),
                    (vec!["c"], 2),
                    (vec!["main", "a"], 0),
                    (vec!["main", "b"], 1),
                    (vec!["main", "c"], 2),
                ],
                statement_depends_on: vec![
                    (1, 0, proto::DependencyType::TABLE_REF),
                    (2, 1, proto::DependencyType::TABLE_REF),
                    (3, 2, proto::DependencyType::TABLE_REF),
                ],
                statement_liveness: vec![true, true, true, true],
            },
        })
        .await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_5() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_planner(&TaskPlannerTest {
            script: r#"
IMPORT a FROM 'http://remote/data1.parquet';
IMPORT b FROM 'http://remote/data2.parquet';
LOAD c FROM a USING PARQUET;
LOAD d FROM b USING PARQUET;
CREATE TABLE e AS SELECT * FROM c;
CREATE TABLE f AS SELECT * FROM d;
VIZ c USING TABLE;
VIZ e USING TABLE;
VIZ f USING TABLE;
"#,
            input: HashMap::new(),
            expected: ExpectedTaskInstance {
                node_errors: vec![],
                linter_messages: vec![],
                statement_names: vec![
                    Some(vec!["main", "a"]),
                    Some(vec!["main", "b"]),
                    Some(vec!["main", "c"]),
                    Some(vec!["main", "d"]),
                    Some(vec!["main", "e"]),
                    Some(vec!["main", "f"]),
                    None,
                    None,
                    None,
                ],
                statement_by_name: vec![
                    (vec!["a"], 0),
                    (vec!["b"], 1),
                    (vec!["c"], 2),
                    (vec!["d"], 3),
                    (vec!["e"], 4),
                    (vec!["f"], 5),
                    (vec!["main", "a"], 0),
                    (vec!["main", "b"], 1),
                    (vec!["main", "c"], 2),
                    (vec!["main", "d"], 3),
                    (vec!["main", "e"], 4),
                    (vec!["main", "f"], 5),
                ],
                statement_depends_on: vec![
                    (2, 0, proto::DependencyType::TABLE_REF),
                    (3, 1, proto::DependencyType::TABLE_REF),
                    (4, 2, proto::DependencyType::TABLE_REF),
                    (5, 3, proto::DependencyType::TABLE_REF),
                    (6, 2, proto::DependencyType::TABLE_REF),
                    (7, 4, proto::DependencyType::TABLE_REF),
                    (8, 5, proto::DependencyType::TABLE_REF),
                ],
                statement_liveness: vec![true, true, true, true, true, true, true, true, true],
            },
        })
        .await?;
        Ok(())
    }
}
