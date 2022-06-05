sql_create_as_stmt:
    CREATE_P sql_opt_temp TABLE sql_create_as_target AS sql_select_stmt sql_opt_with_data {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CREATE_AS, Concat(std::move($4), {
            Attr(Key::SQL_CREATE_AS_TEMP, Enum(@2, $2)),
            Attr(Key::SQL_CREATE_AS_STATEMENT, ctx.Add(@6, sx::NodeType::OBJECT_SQL_SELECT, move($6))),
            Attr(Key::SQL_CREATE_AS_WITH_DATA, $7),
        }));
    }
  | CREATE_P sql_opt_temp TABLE IF_P NOT EXISTS sql_create_as_target AS sql_select_stmt sql_opt_with_data {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CREATE_AS, Concat(std::move($7), {
            Attr(Key::SQL_CREATE_AS_IF_NOT_EXISTS, Bool(Loc({@4, @5, @6}), true)),
            Attr(Key::SQL_CREATE_AS_TEMP, Enum(@2, $2)),
            Attr(Key::SQL_CREATE_AS_STATEMENT, ctx.Add(@9, sx::NodeType::OBJECT_SQL_SELECT, move($9))),
            Attr(Key::SQL_CREATE_AS_WITH_DATA, $10),
        }));
    }
    ;

sql_create_as_target:
    sql_qualified_name sql_opt_column_list sql_opt_with sql_on_commit_option {
        $$ = {
            Attr(Key::SQL_CREATE_AS_NAME, std::move($1)),
            Attr(Key::SQL_CREATE_AS_COLUMNS, ctx.Add(@2, move($2))),
            Attr(Key::SQL_CREATE_AS_ON_COMMIT, Enum(@4, $4))
        };
    }
    ;
    
sql_create_stmt:
    CREATE_P sql_opt_temp TABLE sql_qualified_name '(' sql_opt_table_element_list ')' sql_on_commit_option {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CREATE, {
            Attr(Key::SQL_CREATE_TABLE_TEMP, Enum(@2, $2)),
            Attr(Key::SQL_CREATE_TABLE_NAME, std::move($4)),
            Attr(Key::SQL_CREATE_TABLE_ELEMENTS, ctx.Add(Loc({@5, @6, @7}), std::move($6))),
            Attr(Key::SQL_CREATE_TABLE_ON_COMMIT, Enum(@8, $8)),
        });
    }
    ;

sql_opt_table_element_list:
    sql_table_element_list  { $$ = move($1); }
  | %empty                  { $$ = {}; }
    ;

sql_table_element_list:
    sql_table_element                             { $$ = { $1 }; }
  | sql_table_element_list ',' sql_table_element  { $1.push_back(std::move($3)); $$ = std::move($1); }
    ;

sql_table_element:
    sql_column_def  { $$ = { std::move($1) }; }
    ;

sql_column_def:
    sql_col_id sql_typename sql_create_generic_options sql_col_qual_list {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_COLUMN_DEF, {
            Attr(Key::SQL_COLUMN_DEF_NAME, String(@1)),
            Attr(Key::SQL_COLUMN_DEF_TYPE, std::move($2)),
            Attr(Key::SQL_COLUMN_DEF_OPTIONS, std::move($3)),
            Attr(Key::SQL_COLUMN_DEF_CONSTRAINTS, ctx.Add(@4, std::move($4)))
        });
    }
    ;

sql_col_qual_list:
    sql_col_qual_list sql_col_constraint    { $1.push_back(std::move($2)); $$ = std::move($1); }
  | %empty                                  { $$ = {}; }
    ;

sql_col_constraint:
    CONSTRAINT sql_name sql_col_constraint_elem {
        $3.push_back(Attr(Key::SQL_COLUMN_CONSTRAINT_NAME, String(@2)));
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_COLUMN_CONSTRAINT, std::move($3));
    }
  | sql_col_constraint_elem { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_COLUMN_CONSTRAINT, std::move($1)); }
  | sql_constraint_attr     { $$ = std::move($1); }
  | COLLATE sql_any_name    { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_COLUMN_CONSTRAINT, {
        Attr(Key::SQL_COLUMN_CONSTRAINT_TYPE, Enum(@$, sx::ColumnConstraint::COLLATE)),
        Attr(Key::SQL_COLUMN_CONSTRAINT_VALUE, String(@2)),
    });
  }
    ;

sql_constraint_attr:
    DEFERRABLE              { $$ = Enum(@$, sx::ConstraintAttribute::DEFERRABLE); }
  | NOT DEFERRABLE          { $$ = Enum(@$, sx::ConstraintAttribute::NOT_DEFERRABLE); }
  | INITIALLY DEFERRED      { $$ = Enum(@$, sx::ConstraintAttribute::INITIALLY_DEFERRED); }
  | INITIALLY IMMEDIATE     { $$ = Enum(@$, sx::ConstraintAttribute::INITIALLY_IMMEDIATE); }
    ;

sql_opt_definition:
    WITH sql_definition     { $$ = std::move($2); }
  | %empty                  { $$ = {}; }
    ;

sql_definition: '(' sql_def_list ')' { $$ = std::move($2); }

sql_def_list: 
    sql_def_elem                    { $$ = { std::move($1) }; }
  | sql_def_list ',' sql_def_elem   { $1.push_back($3); $$ = std::move($1); }
    ;

sql_def_elem:
    sql_col_label '=' sql_def_arg {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_DEF_ARG, {
            Attr(Key::SQL_DEFINITION_ARG_KEY, std::move(String(@1))),
            Attr(Key::SQL_DEFINITION_ARG_VALUE, std::move(std::move($3))),
        });
    }
    ;

sql_def_arg:
    sql_func_type           { $$ = std::move($1); }
  | sql_reserved_keywords   { $$ = String(@1); }
  | sql_qual_all_op         { $$ = std::move($1); }
  | sql_numeric_only        { $$ = std::move($1); }
  | SCONST                  { $$ = String(@1); }
  | NONE                    { $$ = {}; }
    ;

sql_numeric_only:
    FCONST              { $$ = Const(ctx, @$, sx::AConstType::FLOAT); }
  | '+' FCONST          { $$ = Const(ctx, @$, sx::AConstType::FLOAT); }
  | '-' FCONST          { $$ = Const(ctx, @$, sx::AConstType::FLOAT); }
  | sql_signed_iconst   { $$ = std::move($1); }
    ;

sql_signed_iconst:
    ICONST      { $$ = Const(ctx, @$, sx::AConstType::INTEGER); }
  | '+' ICONST  { $$ = Const(ctx, @$, sx::AConstType::INTEGER); }
  | '-' ICONST  { $$ = Const(ctx, @$, sx::AConstType::INTEGER); }
    ;

// XXX omitted SETOF
sql_func_type:
    sql_typename { $$ = std::move($1); }
    ;

// XXX omitted identity and foreign
sql_col_constraint_elem:
    NOT NULL_P                { $$ = { Attr(Key::SQL_COLUMN_CONSTRAINT_TYPE, Enum(@$, sx::ColumnConstraint::NOT_NULL)) }; }
  | NULL_P                    { $$ = { Attr(Key::SQL_COLUMN_CONSTRAINT_TYPE, Enum(@$, sx::ColumnConstraint::NULL_)) }; }
  | UNIQUE sql_opt_definition { $$ = {
        Attr(Key::SQL_COLUMN_CONSTRAINT_TYPE, Enum(@$, sx::ColumnConstraint::UNIQUE)),
        Attr(Key::SQL_COLUMN_CONSTRAINT_DEFINITION, ctx.Add(@2, std::move($2))),
    };
  }
  | PRIMARY KEY sql_opt_definition { $$ = {
        Attr(Key::SQL_COLUMN_CONSTRAINT_TYPE, Enum(@$, sx::ColumnConstraint::PRIMARY_KEY)),
        Attr(Key::SQL_COLUMN_CONSTRAINT_DEFINITION, ctx.Add(@3, std::move($3))),
    };
  }
  | CHECK_P '(' sql_a_expr ')' sql_opt_no_inherit { $$ = {
        Attr(Key::SQL_COLUMN_CONSTRAINT_TYPE, Enum(@$, sx::ColumnConstraint::CHECK)),
        Attr(Key::SQL_COLUMN_CONSTRAINT_VALUE, std::move($3)),
        Attr(Key::SQL_COLUMN_CONSTRAINT_NO_INHERIT, std::move($5)),
    };
  }
  | DEFAULT sql_b_expr { $$ = {
        Attr(Key::SQL_COLUMN_CONSTRAINT_TYPE, Enum(@$, sx::ColumnConstraint::DEFAULT)),
        Attr(Key::SQL_COLUMN_CONSTRAINT_VALUE, std::move($2)),
    };
  }
    ;

sql_opt_no_inherit:
    NO INHERIT  { $$ = Bool(@1, true); }
  | %empty      { $$ = Bool(@$, false); }
    ;

sql_create_generic_options:
    OPTIONS '(' sql_generic_option_list ')'     { $$ = ctx.Add(@$, std::move($3)); }
  | %empty                                      { $$ = {}; }
    ;

sql_generic_option_list:
    sql_generic_option_elem                                 { $$ = { std::move($1) };  }
  | sql_generic_option_list ',' sql_generic_option_elem     { $1.push_back(std::move($3)); $$ = std::move($1); }
    ;

sql_generic_option_elem:
    sql_col_label SCONST {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_GENERIC_OPTION, {
            Attr(Key::SQL_GENERIC_OPTION_KEY, String(@1)),
            Attr(Key::SQL_GENERIC_OPTION_VALUE, String(@2)),
        });
    }
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
  | %empty              { $$ = sx::TempType::NONE; }
    ;

sql_on_commit_option: 
    ON COMMIT DROP              { $$ = sx::OnCommitOption::DROP; }
  | ON COMMIT DELETE_P ROWS     { $$ = sx::OnCommitOption::DELETE_ROWS; }
  | ON COMMIT PRESERVE ROWS     { $$ = sx::OnCommitOption::PRESERVE_ROWS; }
  | %empty                      { $$ = sx::OnCommitOption::NOOP; }
  ;

// XXX omitted reloptions and OIDS
sql_opt_with:
    %empty          { $$ = Null(); }
    ;

sql_table_constraint:
    CONSTRAINT sql_name sql_table_constraint_elem
  | sql_table_constraint_elem
    ;

sql_existing_index:
    USING INDEX sql_col_id
    ;

sql_table_constraint_elem:
    CHECK_P '(' sql_a_expr ')' sql_opt_no_inherit { $$ = {
          Attr(Key::SQL_TABLE_CONSTRAINT_TYPE, Enum(@$, sx::ColumnConstraint::CHECK)),
          Attr(Key::SQL_TABLE_CONSTRAINT_VALUE, std::move($3)),
          Attr(Key::SQL_TABLE_CONSTRAINT_NO_INHERIT, std::move($5)),
    }; }
  | UNIQUE '(' sql_opt_column_list ')' sql_opt_definition { $$ = {
        Attr(Key::SQL_TABLE_CONSTRAINT_TYPE, Enum(@$, sx::ColumnConstraint::UNIQUE)),
        Attr(Key::SQL_TABLE_CONSTRAINT_DEFINITION, ctx.Add(@2, std::move($2))),
    }; }
  | PRIMARY KEY '(' sql_opt_column_list ')' sql_opt_definition { $$ = {
    }; }
  | FOREIGN KEY '(' sql_opt_column_list ')' REFERENCES sql_qualified_name { $$ = {
    }; }
  | FOREIGN KEY '(' sql_opt_column_list ')' REFERENCES sql_qualified_name { $$ = {
    }; }
