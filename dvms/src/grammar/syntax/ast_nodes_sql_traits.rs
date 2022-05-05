use super::ast_nodes_sql::*;
use dashql_proto::syntax as sx;

impl<'a> Default for Indirection<'a> {
    fn default() -> Self {
        Indirection::Name("")
    }
}

impl<'text> Default for ArrayBound<'text> {
    fn default() -> Self {
        ArrayBound::Empty
    }
}

impl<'a> Default for ExpressionOperatorName<'a> {
    fn default() -> Self {
        ExpressionOperatorName::Known(sx::ExpressionOperator::EQUAL)
    }
}

impl<'a> Default for Expression<'a> {
    fn default() -> Self {
        Expression::Null
    }
}

impl<'a> Default for FunctionName<'a> {
    fn default() -> Self {
        FunctionName::Unknown("")
    }
}

impl<'a> Default for ColumnConstraintVariant<'a> {
    fn default() -> Self {
        ColumnConstraintVariant::Attribute(sx::ConstraintAttribute::DEFERRABLE)
    }
}
