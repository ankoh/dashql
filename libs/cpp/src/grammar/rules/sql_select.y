
sql_select_statement:
    LRB sql_select_statement RRB    { $$ = $2; }
  | sql_select_no_parens            { $$ = $1; }
    ;

sql_select_no_parens:
    sql_simple_select               { $$ = $1; }

sql_simple_select:
    SELECT sql_c_expr               { $$ = {}; }



sql_c_expr:
    sql_a_expr_const                { $$ = $1; }

sql_a_expr_const:
    sql_fconst {
        $$ = ctx.AddObject(@$, sx::ObjectType::SQL_ACONST, {
            {@$, sx::AttributeKey::SQL_ACONST_TYPE, ctx.CreateEnum(@$, sxs::AConstType::FLOAT)},
            {@1, sx::AttributeKey::SQL_ACONST_VALUE, $1},
        });
    }
  | sql_sconst {
        $$ = ctx.AddObject(@$, sx::ObjectType::SQL_ACONST, {
            {@$, sx::AttributeKey::SQL_ACONST_TYPE, ctx.CreateEnum(@$, sxs::AConstType::STRING)},
            {@1, sx::AttributeKey::SQL_ACONST_VALUE, $1},
        });
    }
  | sql_bconst {
        $$ = ctx.AddObject(@$, sx::ObjectType::SQL_ACONST, {
            {@$, sx::AttributeKey::SQL_ACONST_TYPE, ctx.CreateEnum(@$, sxs::AConstType::BITSTRING)},
            {@1, sx::AttributeKey::SQL_ACONST_VALUE, $1},
        });
    }
    ;


sql_fconst: FCONST { $$ = sx::Value(@1, sx::ValueType::STRING, 0); };
sql_sconst: SCONST { $$ = sx::Value(@1, sx::ValueType::STRING, 0); };
sql_bconst: BCONST { $$ = sx::Value(@1, sx::ValueType::STRING, 0); };
