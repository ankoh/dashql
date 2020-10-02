%start Start

%%

Start -> Produce<bool>:
            { Ok(false) }
  | "foo"   { Ok(true) }
  ;


%%

use crate::parser::context::*;
