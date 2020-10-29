
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
    sql_fconst_value {
        $$ = ctx.AddObject(@$, sx::ObjectType::SQL_ACONST, {
            {@$, sx::AttributeKey::SQL_ACONST_TYPE, ctx.CreateEnum(@$, sxs::AConstType::FLOAT)},
            {@1, sx::AttributeKey::SQL_ACONST_VALUE, $1},
        });
    }
    ;


sql_fconst_value:
    FCONST     { $$ = sx::Value(@1, sx::ValueType::STRING, 0); }
    ;

