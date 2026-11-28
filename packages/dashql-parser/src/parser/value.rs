//! The semantic values on the parser stack.
//!
//! Every value is `Copy`: node lists and n-ary expressions live in arenas of the parse context and are referenced by id.

use crate::names::NameId;
use dashql_buffers::parser::{JoinType, Node, NumericType};

/// The text of a keyword token
pub type Str = &'static str;

/// A temporary list of nodes in the parse context
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NodeList(pub(crate) u32);

impl NodeList {
    /// A list off the arena of the parse context, it reads as empty and ignores appends
    pub const NONE: NodeList = NodeList(u32::MAX);
}

/// An expression that is either a materialized node or an n-ary expression that may still be
/// flattened into an enclosing AND / OR
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ExprVariant {
    Node(Node),
    Nary(u32),
}

impl From<Node> for ExprVariant {
    fn from(node: Node) -> Self {
        ExprVariant::Node(node)
    }
}

/// A value on the parser stack
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Value {
    /// The value of untyped symbols, and of typed symbols whose action does not set one
    #[default]
    Empty,
    Node(Node),
    List(NodeList),
    Expr(ExprVariant),
    Bool(bool),
    Join(JoinType),
    Numeric(NumericType),
    Str(Str),
    Name(NameId),
}

macro_rules! value_from {
    ($t:ty, $variant:ident) => {
        impl From<$t> for Value {
            fn from(v: $t) -> Self {
                Value::$variant(v)
            }
        }
    };
}

value_from!(Node, Node);
value_from!(NodeList, List);
value_from!(ExprVariant, Expr);
value_from!(bool, Bool);
value_from!(JoinType, Join);
value_from!(NumericType, Numeric);
value_from!(Str, Str);
value_from!(NameId, Name);

impl From<()> for Value {
    fn from(_: ()) -> Self {
        Value::Empty
    }
}

/// Read a typed value from the stack.
///
/// An [`ExprVariant`] accepts a node, and a symbol whose action did not set a value holds a
/// default-constructed one. The grammar gives every symbol one type, a value of another type reads as the empty
/// value of the expected type, a node list as [`NodeList::NONE`].
pub trait FromValue: Sized {
    fn from_value(v: Value) -> Self;
}

impl FromValue for Value {
    fn from_value(v: Value) -> Self {
        v
    }
}

impl FromValue for Node {
    fn from_value(v: Value) -> Self {
        match v {
            Value::Node(n) => n,
            _ => Node::default(),
        }
    }
}

impl FromValue for ExprVariant {
    fn from_value(v: Value) -> Self {
        match v {
            Value::Expr(e) => e,
            Value::Node(n) => ExprVariant::Node(n),
            _ => ExprVariant::Node(Node::default()),
        }
    }
}

macro_rules! from_value {
    ($t:ty, $variant:ident) => {
        impl FromValue for $t {
            fn from_value(v: Value) -> Self {
                match v {
                    Value::$variant(x) => x,
                    _ => <$t>::default(),
                }
            }
        }
    };
}

from_value!(bool, Bool);
from_value!(JoinType, Join);
from_value!(NumericType, Numeric);
from_value!(Str, Str);
from_value!(NameId, Name);

impl FromValue for NodeList {
    fn from_value(v: Value) -> Self {
        match v {
            Value::List(l) => l,
            _ => NodeList::NONE,
        }
    }
}
