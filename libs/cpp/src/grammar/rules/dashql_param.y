dashql_parameter_declaration:
    DECLARE PARAMETER dashql_identifier dashql_opt_alias TYPE dashql_parameter_type  {
        $$ = ctx.CreateObject(@$, syntax::ObjectType::PARAMETER_DECLARATION, {
            {@3, AttrKey::PARAMETER_IDENTIFIER, $3},
            {@4, AttrKey::PARAMETER_ALIAS, $4},
            {@6, AttrKey::PARAMETER_TYPE, $6},
        });
    }
    ;

dashql_parameter_type:
    INTEGER     { $$ = Value(@$, ValueType::NUMBER, (int) ParamType::INTEGER); }
  | FLOAT       { $$ = Value(@$, ValueType::NUMBER, (int) ParamType::FLOAT); }
  | TEXT        { $$ = Value(@$, ValueType::NUMBER, (int) ParamType::TEXT); }
  | DATE        { $$ = Value(@$, ValueType::NUMBER, (int) ParamType::DATE); }
  | DATETIME    { $$ = Value(@$, ValueType::NUMBER, (int) ParamType::DATETIME); }
  | TIME        { $$ = Value(@$, ValueType::NUMBER, (int) ParamType::TIME); }
  | FILE        { $$ = Value(@$, ValueType::NUMBER, (int) ParamType::FILE); }
    ;

