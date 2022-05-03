use super::ast_nodes_sql::*;
use dashql_proto::syntax as sx;

impl<'text, 'arena> Default for Indirection<'text, 'arena> {
    fn default() -> Self {
        Indirection::Name("")
    }
}

impl<'text> Default for ArrayBound<'text> {
    fn default() -> Self {
        ArrayBound::Empty
    }
}

impl<'text, 'arena> Default for ExpressionOperatorName<'text, 'arena> {
    fn default() -> Self {
        ExpressionOperatorName::Known(sx::ExpressionOperator::EQUAL)
    }
}

impl<'text, 'arena> Default for Expression<'text, 'arena> {
    fn default() -> Self {
        Expression::Null
    }
}

impl<'text, 'arena> Default for FunctionName<'text> {
    fn default() -> Self {
        FunctionName::Unknown("")
    }
}

impl<'text, 'arena> Default for ColumnConstraintVariant<'text, 'arena> {
    fn default() -> Self {
        ColumnConstraintVariant::Attribute(sx::ConstraintAttribute::DEFERRABLE)
    }
}
