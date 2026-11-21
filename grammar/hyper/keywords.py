"""Emit the keyword lookup of the syntax grammar; independent of the semantic grammar's categories."""

import pathlib
import sys

entries = [line.split() for line in pathlib.Path(sys.argv[1]).read_text().splitlines() if line and not line.startswith("#")]
lines = ["pub fn keyword(text: &str) -> Option<u16> {", "    use super::syntax_tables::symbol_kind::*;", "    Some(match text {"]
lines += [f'        "{word}" => S_{token},' for word, token in entries]
lines += ["        _ => return None,", "    })", "}", ""]
pathlib.Path(sys.argv[2]).write_text("\n".join(lines))
