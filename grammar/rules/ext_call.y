// ---------------------------------------------------------------------------
// CALL <name>(<option> => <value>, ...)
//
// A generic statement, it knows no overlay. Keys reuse vararg_key, so every keyword is a valid name and no keyword
// list changes. See docs/design/overlay.md.

call_stmt:
    CALL_P sql_qualified_name LRB RRB {
        ctx.object(@$, NodeType::OBJECT_SQL_CALL, &[attr(Key::SQL_CALL_NAME, $2)])
    }
  | CALL_P sql_qualified_name LRB call_args RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CALL,
            &[attr(Key::SQL_CALL_NAME, $2), attr(Key::SQL_CALL_ARGS, ctx.array(loc(&[@3, @4, @5]), $4))],
        )
    }
  // The name while it is typed, `CALL cdp.`
  | CALL_P sql_col_id ext_dot_trailing {
        let name = ctx.array(loc(&[@2, @3]), &[$2, ctx.trailing_dot(@3)]);
        ctx.object(@$, NodeType::OBJECT_SQL_CALL, &[attr(Key::SQL_CALL_NAME, name)])
    }
    ;

call_args:
    call_arg                  { ctx.list(&[$1]) }
  | call_args COMMA call_arg  {
        ctx.push_back($1, $3);
        $1
    }
    ;

call_arg:
    vararg_key EQUALS_GREATER call_value {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FUNCTION_ARG,
            &[attr(Key::SQL_FUNCTION_ARG_NAME, $1), attr(Key::SQL_FUNCTION_ARG_VALUE, $3)],
        )
    }
    ;

// An object is an ARRAY of fields like the values of SET, the empty object and the empty array are nodes as well
call_value:
    call_scalar               { $1 }
  | LSB RSB                   {
        let values = ctx.array_ex(@$, NO_NODES, false, false);
        ctx.object(@$, NodeType::OBJECT_EXT_VARARG_ARRAY, &[attr(Key::EXT_VARARG_ARRAY_VALUES, values)])
    }
  | LSB call_values RSB       {
        let values = ctx.array_ex(@$, $2, false, false);
        ctx.object(@$, NodeType::OBJECT_EXT_VARARG_ARRAY, &[attr(Key::EXT_VARARG_ARRAY_VALUES, values)])
    }
  | LRB RRB                   { ctx.array_ex(@$, NO_NODES, false, false) }
  | LRB call_members RRB      { ctx.array_ex(@$, $2, false, false) }
    ;

call_values:
    call_value                    { ctx.list(&[$1]) }
  | call_values COMMA call_value  {
        ctx.push_back($1, $3);
        $1
    }
    ;

call_members:
    call_member                     { ctx.list(&[$1]) }
  | call_members COMMA call_member  {
        ctx.push_back($1, $3);
        $1
    }
    ;

call_member:
    vararg_key EQUALS call_value {
        ctx.object(
            @$,
            NodeType::OBJECT_EXT_VARARG_FIELD,
            &[attr(Key::EXT_VARARG_FIELD_KEY, $1), attr(Key::EXT_VARARG_FIELD_VALUE, $3)],
        )
    }
    ;

// A function is an ordinary call to the parser, the analyzer rejects everything except secret() of a call that has a
// signature. A bare name is no value.
call_scalar:
    SCONST        { const_node(@1, AConstType::STRING) }
  | DCONST        { const_node(@1, AConstType::STRING) }
  | ICONST        { const_node(@1, AConstType::INTEGER) }
  | FCONST        { const_node(@1, AConstType::FLOAT) }
  | MINUS ICONST  { negate(ctx, @$, @1, const_node(@2, AConstType::INTEGER)) }
  | MINUS FCONST  { negate(ctx, @$, @1, const_node(@2, AConstType::FLOAT)) }
  | TRUE_P        { bool_node(@1, true) }
  | FALSE_P       { bool_node(@1, false) }
  | NULL_P        { const_node(@1, AConstType::NULL_) }
  | sql_colon_param_ref     { $1 }
  | sql_func_expr           { $1 }
  | sql_select_with_parens  {
        let s = ctx.object(@1, NodeType::OBJECT_SQL_SELECT, $1);
        ctx.object(@$, NodeType::OBJECT_SQL_SELECT_EXPRESSION, &[attr(Key::SQL_SELECT_EXPRESSION_STATEMENT, s)])
    }
    ;
