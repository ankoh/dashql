dashql_parameter_declaration:
    DECLARE PARAMETER dashql_identifier dashql_opt_alias TYPE_P dashql_parameter_type  {
        $$ = ctx.CreateObject(@$, sx::ObjectType::DASHQL_PARAMTER, {
            {sx::AttributeKey::DASHQL_PARAMETER_IDENTIFIER, $3},
            {sx::AttributeKey::DASHQL_PARAMETER_ALIAS, $4},
            {sx::AttributeKey::DASHQL_PARAMETER_TYPE, $6},
        });
    }
    ;

dashql_parameter_type:
    INTEGER     { $$ = sx::Value(@$, sx::ValueType::I64, (int) sxd::ParameterType::INTEGER); }
  | FLOAT       { $$ = sx::Value(@$, sx::ValueType::I64, (int) sxd::ParameterType::FLOAT); }
  | TEXT        { $$ = sx::Value(@$, sx::ValueType::I64, (int) sxd::ParameterType::TEXT); }
  | DATE        { $$ = sx::Value(@$, sx::ValueType::I64, (int) sxd::ParameterType::DATE); }
  | DATETIME    { $$ = sx::Value(@$, sx::ValueType::I64, (int) sxd::ParameterType::DATETIME); }
  | TIME        { $$ = sx::Value(@$, sx::ValueType::I64, (int) sxd::ParameterType::TIME); }
  | FILE        { $$ = sx::Value(@$, sx::ValueType::I64, (int) sxd::ParameterType::FILE); }
    ;

