dashql_identifier:
    IDENTIFIER_LITERAL  { $$ = sx::Value(@1, sx::ValueType::STRING, 0); }
  | STRING_LITERAL      { $$ = sx::Value(@1, sx::ValueType::STRING, 0); }
    ;

dashql_boolean_value:
    BOOLEAN_LITERAL     { $$ = sx::Value(@1, sx::ValueType::I32, $1); }
    ;

dashql_string_value:
    STRING_LITERAL      { $$ = sx::Value(@1, sx::ValueType::STRING, 0); }
    ;

dashql_opt_alias:
    %empty                  { $$ = std::nullopt; }
  | AS dashql_identifier    { $$ = $2; }
    ;
