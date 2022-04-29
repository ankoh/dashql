use super::ast_nodes_sql::SelectStatement;
use std::fmt;

macro_rules! writeln {
    ($dst:expr, $($arg:tt)*) => {{
        $dst.write_fmt(std::format_args!($($arg)*))?;
        $dst.write_str("\n")
    }}
}

impl<'text, 'arena> fmt::Display for SelectStatement<'text, 'arena> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "select ")?;
        writeln!(f, "into ")?;
        writeln!(f, "from ")?;
        writeln!(f, "where ")?;
        writeln!(f, "order by ")?;
        writeln!(f, "group by ")?;
        writeln!(f, "having ")?;
        writeln!(f, "window ")?;
        writeln!(f, "using sample ")?;
        Ok(())
    }
}
