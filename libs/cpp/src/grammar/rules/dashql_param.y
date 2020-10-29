dashql_parameter_declaration:
    DECLARE PARAMETER dashql_identifier dashql_opt_alias TYPE dashql_parameter_type  {
        $$ = ctx.CreateObject(@$.encode(), syntax::ObjectType::PARAMETER_DECLARATION, {
            {@3.encode(), AttrKey::PARAMETER_IDENTIFIER, $3},
            {@4.encode(), AttrKey::PARAMETER_ALIAS, $4},
            {@6.encode(), AttrKey::PARAMETER_TYPE, $6},
        });
    }
    ;

dashql_parameter_type:
    INTEGER     { $$ = Value(@$.encode(), ValueType::NUMBER, (int) ParamType::INTEGER); }
  | FLOAT       { $$ = Value(@$.encode(), ValueType::NUMBER, (int) ParamType::FLOAT); }
  | TEXT        { $$ = Value(@$.encode(), ValueType::NUMBER, (int) ParamType::TEXT); }
  | DATE        { $$ = Value(@$.encode(), ValueType::NUMBER, (int) ParamType::DATE); }
  | DATETIME    { $$ = Value(@$.encode(), ValueType::NUMBER, (int) ParamType::DATETIME); }
  | TIME        { $$ = Value(@$.encode(), ValueType::NUMBER, (int) ParamType::TIME); }
  | FILE        { $$ = Value(@$.encode(), ValueType::NUMBER, (int) ParamType::FILE); }
    ;

