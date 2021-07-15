sql_create_as_stmt:
    CREATE_P sql_opt_temp TABLE sql_create_as_target AS sql_select_stmt sql_opt_with_data {
        $$ = concat(std::move($4), {
                Key::SQL_CREATE_AS_TEMP << Enum(@2, $2),
                Key::SQL_CREATE_AS_STATEMENT << ctx.Add(@6, sx::NodeType::OBJECT_SQL_SELECT, move($6)),
                Key::SQL_CREATE_AS_WITH_DATA << $7
        });
    }
  | CREATE_P sql_opt_temp TABLE IF_P NOT EXISTS sql_create_as_target AS sql_select_stmt sql_opt_with_data {
        $$ = {};
    }
    ;

sql_create_as_target:
    sql_qualified_name sql_opt_column_list sql_opt_with sql_on_commit_option {
        $$ = {
            Key::SQL_CREATE_AS_NAME << std::move($1),
            Key::SQL_CREATE_AS_COLUMNS << ctx.Add(@2, move($2)),
            Key::SQL_CREATE_AS_ON_COMMIT << Enum(@4, $4)
        };
    }
    ;
    
sql_create_stmt:
    CREATE_P sql_opt_temp TABLE sql_qualified_name '(' sql_opt_table_element_list ')' sql_on_commit_option {
        $$ = {
            Key::SQL_CREATE_TABLE_TEMP << Enum(@2, $2),
            Key::SQL_CREATE_TABLE_NAME << std::move($4),
            Key::SQL_CREATE_TABLE_ELEMENTS << std::move($6),
            Key::SQL_CREATE_TABLE_ON_COMMIT << Enum(@8, $8),
        };
    }
    ;

sql_opt_table_element_list:
    sql_table_element_list  { $$ = move($1); }
  | %empty                  { $$ = {}; }
    ;

sql_table_element_list:
    sql_table_element                             { $$ = { $1 }; }
    sql_table_element_list ',' sql_table_element  { $1.push_back(std::move($3)); $$ = std::move($1); }
    ;

sql_table_element:
    
    ;

sql_opt_column_list:
    '(' sql_column_list ')' { $$ = move($2); }
  | %empty                  { $$ = {}; }

sql_column_list:
    sql_column_elem                     { $$ = { String(@1) }; }
  | sql_column_list ',' sql_column_elem { $1.push_back(String(@3)); $$ = move($1); }
    ;

sql_column_elem: sql_col_id;

sql_opt_with_data:
    WITH DATA_P         { $$ = Bool(@$, true); }
  | WITH NO DATA_P      { $$ = Bool(@$, false); }
  | %empty              { $$ = Bool(@$, true); }
    ;

sql_opt_temp:
    TEMPORARY           { $$ = sx::TempType::LOCAL; }
  | TEMP                { $$ = sx::TempType::LOCAL; }
  | LOCAL TEMPORARY     { $$ = sx::TempType::LOCAL; }
  | LOCAL TEMP          { $$ = sx::TempType::LOCAL; }
  | GLOBAL TEMPORARY    { $$ = sx::TempType::GLOBAL; }
  | GLOBAL TEMP         { $$ = sx::TempType::GLOBAL; }
  | UNLOGGED            { $$ = sx::TempType::UNLOGGED; }
  | %empty              { $$ = sx::TempType::DEFAULT; }
    ;

sql_on_commit_option: 
    ON COMMIT DROP              { $$ = sx::OnCommitOption::DROP; }
  | ON COMMIT DELETE_P ROWS     { $$ = sx::OnCommitOption::DELETE_ROWS; }
  | ON COMMIT PRESERVE ROWS     { $$ = sx::OnCommitOption::PRESERVE_ROWS; }
  | %empty                      { $$ = sx::OnCommitOption::NOOP; }
  ;

sql_opt_with:
    %empty          { $$ = Null(); }
    ;
