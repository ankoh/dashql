// Statement and clause productions with explicit AST projections.

sql_cmd_alter_db_stmt:
    ALTER sql_cmd_opt_db_locality DATABASE sql_cmd_database_name sql_cmd_opt_with sql_cmd_createdb_opt_list SET sql_cmd_generic_set {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_DATABASE,
            &[
                attr(Key::SQL_ALTER_DATABASE_LOCALITY, $2),
                attr(Key::SQL_ALTER_DATABASE_DATABASE, $4),
                attr(Key::SQL_ALTER_DATABASE_OPTIONS, ctx.array(@6, $6)),
                attr(Key::SQL_ALTER_DATABASE_ARGS, ctx.set(@8, $8)),
            ],
        )
    }
    ;

sql_cmd_alter_group_stmt:
    ALTER GROUP_P sql_qualified_name ADD_P USER sql_cmd_role_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_ROLE,
            &[
                attr(Key::SQL_ALTER_ROLE_ACTION, enum_node(@$, AlterRoleAction::ADD)),
                attr(Key::SQL_ALTER_ROLE_ROLE, $3),
                attr(Key::SQL_ALTER_ROLE_ARGS, ctx.array(@6, $6)),
            ],
        )
    }
    | ALTER GROUP_P sql_qualified_name DROP USER sql_cmd_role_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_ROLE,
            &[
                attr(Key::SQL_ALTER_ROLE_ACTION, enum_node(@$, AlterRoleAction::DROP)),
                attr(Key::SQL_ALTER_ROLE_ROLE, $3),
                attr(Key::SQL_ALTER_ROLE_ARGS, ctx.array(@6, $6)),
            ],
        )
    }
    ;

sql_cmd_alter_opt_role_elem:
    PASSWORD sql_string_literal {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROLE_ELEMENT,
            &[
                attr(Key::SQL_ROLE_ELEMENT_KIND, enum_node(@$, RoleOption::PASSWORD)),
                attr(Key::SQL_ROLE_ELEMENT_ARG, $2),
            ],
        )
    }
    | PASSWORD NULL_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROLE_ELEMENT,
            &[attr(Key::SQL_ROLE_ELEMENT_KIND, enum_node(@$, RoleOption::PASSWORD))],
        )
    }
    | ENCRYPTED PASSWORD sql_string_literal {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROLE_ELEMENT,
            &[
                attr(Key::SQL_ROLE_ELEMENT_KIND, enum_node(@$, RoleOption::PASSWORD)),
                attr(Key::SQL_ROLE_ELEMENT_ENCRYPTED, bool_node(@$, true)),
                attr(Key::SQL_ROLE_ELEMENT_ARG, $3),
            ],
        )
    }
    | UNENCRYPTED PASSWORD sql_string_literal {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROLE_ELEMENT,
            &[
                attr(Key::SQL_ROLE_ELEMENT_KIND, enum_node(@$, RoleOption::PASSWORD)),
                attr(Key::SQL_ROLE_ELEMENT_ENCRYPTED, bool_node(@$, false)),
                attr(Key::SQL_ROLE_ELEMENT_ARG, $3),
            ],
        )
    }
    | INHERIT {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROLE_ELEMENT,
            &[attr(Key::SQL_ROLE_ELEMENT_KIND, enum_node(@$, RoleOption::INHERIT))],
        )
    }
    | CONNECTION LIMIT sql_signed_iconst {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROLE_ELEMENT,
            &[
                attr(Key::SQL_ROLE_ELEMENT_KIND, enum_node(@$, RoleOption::CONNECTION_LIMIT)),
                attr(Key::SQL_ROLE_ELEMENT_ARG, $3),
            ],
        )
    }
    | VALID UNTIL sql_string_literal {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROLE_ELEMENT,
            &[
                attr(Key::SQL_ROLE_ELEMENT_KIND, enum_node(@$, RoleOption::VALID_UNTIL)),
                attr(Key::SQL_ROLE_ELEMENT_ARG, $3),
            ],
        )
    }
    | IDENT {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROLE_ELEMENT,
            &[
                attr(Key::SQL_ROLE_ELEMENT_ARG, name_from_identifier(@1, $1)),
            ],
        )
    }
    ;

sql_cmd_alter_opt_role_list:
    sql_cmd_alter_opt_role_list sql_cmd_alter_opt_role_elem { ctx.push_back($1,$2); $1 }
    | %empty { ctx.list(NO_NODES) }
    ;

sql_cmd_alter_role_set_stmt:
    ALTER ROLE sql_qualified_name sql_cmd_opt_in_database sql_cmd_set_reset_clause {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_ROLE,
            &[
                attr(Key::SQL_ALTER_ROLE_ACTION, enum_node(@$, AlterRoleAction::SET)),
                attr(Key::SQL_ALTER_ROLE_ROLE, $3),
                attr(Key::SQL_ALTER_ROLE_DATABASE, $4),
                attr(Key::SQL_ALTER_ROLE_ARGS, $5),
            ],
        )
    }
    | ALTER ROLE ALL sql_cmd_opt_in_database sql_cmd_set_reset_clause {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_ROLE,
            &[
                attr(Key::SQL_ALTER_ROLE_ACTION, enum_node(@$, AlterRoleAction::SET)),
                attr(Key::SQL_ALTER_ROLE_DATABASE, $4),
                attr(Key::SQL_ALTER_ROLE_ARGS, $5),
            ],
        )
    }
    ;

sql_cmd_alter_role_stmt:
    ALTER ROLE sql_qualified_name sql_cmd_opt_with sql_cmd_alter_opt_role_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_ROLE,
            &[
                attr(Key::SQL_ALTER_ROLE_ROLE, $3),
                attr(Key::SQL_ALTER_ROLE_ARGS, ctx.array(@5, $5)),
            ],
        )
    }
    ;

sql_cmd_alter_seq_stmt:
    ALTER SEQUENCE sql_qualified_name sql_cmd_opt__sequence_option_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_SEQUENCE,
            &[
                attr(Key::SQL_ALTER_SEQUENCE_NAME, $3),
                attr(Key::SQL_ALTER_SEQUENCE_OPTIONS, ctx.array(@4, $4)),
            ],
        )
    }
    | ALTER SEQUENCE IF_P EXISTS sql_qualified_name sql_cmd_opt__sequence_option_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_SEQUENCE,
            &[
                attr(Key::SQL_ALTER_SEQUENCE_IF_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_ALTER_SEQUENCE_NAME, $5),
                attr(Key::SQL_ALTER_SEQUENCE_OPTIONS, ctx.array(@6, $6)),
            ],
        )
    }
    ;

sql_cmd_alter_user_set_stmt:
    ALTER USER sql_qualified_name sql_cmd_set_reset_clause {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_ROLE,
            &[
                attr(Key::SQL_ALTER_ROLE_ACTION, enum_node(@$, AlterRoleAction::SET)),
                attr(Key::SQL_ALTER_ROLE_ROLE, $3),
                attr(Key::SQL_ALTER_ROLE_ARGS, $4),
            ],
        )
    }
    ;

sql_cmd_alter_user_stmt:
    ALTER USER sql_qualified_name sql_cmd_opt_with sql_cmd_alter_opt_role_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_ROLE,
            &[
                attr(Key::SQL_ALTER_ROLE_ROLE, $3),
                attr(Key::SQL_ALTER_ROLE_ARGS, ctx.array(@5, $5)),
            ],
        )
    }
    ;

sql_cmd_analyze_stmt:
    sql_cmd_analyze sql_cmd_opt_verbose { ctx.object(@$,NodeType::OBJECT_SQL_ANALYZE,&[attr(Key::SQL_ANALYZE_VERBOSE,$2)]) }
    | sql_cmd_analyze sql_cmd_opt_verbose sql_qualified_name sql_cmd_opt_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ANALYZE,
            &[
                attr(Key::SQL_ANALYZE_VERBOSE, $2),
                attr(Key::SQL_ANALYZE_TABLE, $3),
                attr(Key::SQL_ANALYZE_COLUMNS, ctx.array(@4, $4)),
            ],
        )
    }
    ;

sql_cmd_close_external_stream_stmt:
    CLOSE EXTERNAL STREAM sql_qualified_name { ctx.object(@$,NodeType::OBJECT_SQL_CLOSE_STREAM,&[attr(Key::SQL_CLOSE_STREAM_NAME,$4)]) }
    | CLOSE EXTERNAL STREAM IF_P EXISTS sql_qualified_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CLOSE_STREAM,
            &[
                attr(Key::SQL_CLOSE_STREAM_IF_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_CLOSE_STREAM_NAME, $6),
            ],
        )
    }
    ;

sql_cmd_close_portal_stmt:
    CLOSE sql_cmd_cursor_name { ctx.object(@$,NodeType::OBJECT_SQL_CLOSE_CURSOR,&[attr(Key::SQL_CLOSE_CURSOR_NAME,$2)]) }
    | CLOSE ALL { ctx.object_ex(@$,NodeType::OBJECT_SQL_CLOSE_CURSOR,NO_NODES,false,false) }
    ;

sql_cmd_comment_stmt:
    COMMENT ON COLUMN sql_any_name IS sql_cmd_comment_text {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COMMENT,
            &[
                attr(Key::SQL_COMMENT_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_COMMENT_DESCRIPTION, $6),
            ],
        )
    }
    ;

sql_cmd_copy_stmt:
    COPY sql_cmd_opt_binary sql_qualified_name sql_opt_column_list sql_cmd_opt_oids FROM sql_cmd_copy_source_descriptor sql_cmd_copy_delimiter sql_cmd_opt_with sql_cmd_copy_options {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY,
            &[
                attr(Key::SQL_COPY_DIRECTION, enum_node(@$, CopyDirection::FROM)),
                attr(Key::SQL_COPY_BINARY, $2),
                attr(Key::SQL_COPY_RELATION, $3),
                attr(Key::SQL_COPY_COLUMNS, ctx.array(@4, $4)),
                attr(Key::SQL_COPY_OIDS, $5),
                attr(Key::SQL_COPY_LOCATION, $7),
                attr(Key::SQL_COPY_DELIMITER, $8),
                attr(Key::SQL_COPY_OPTIONS, ctx.array(@10, $10)),
            ],
        )
    }
    | COPY sql_cmd_opt_binary sql_qualified_name sql_opt_column_list sql_cmd_opt_oids TO sql_cmd_copy_target_descriptor sql_cmd_copy_delimiter sql_cmd_opt_with sql_cmd_copy_options sql_partition_expressions {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY,
            &[
                attr(Key::SQL_COPY_DIRECTION, enum_node(@$, CopyDirection::TO)),
                attr(Key::SQL_COPY_BINARY, $2),
                attr(Key::SQL_COPY_RELATION, $3),
                attr(Key::SQL_COPY_COLUMNS, ctx.array(@4, $4)),
                attr(Key::SQL_COPY_OIDS, $5),
                attr(Key::SQL_COPY_LOCATION, $7),
                attr(Key::SQL_COPY_DELIMITER, $8),
                attr(Key::SQL_COPY_OPTIONS, ctx.array(@10, $10)),
                attr(Key::SQL_COPY_PARTITION_BY, $11),
            ],
        )
    }
    | COPY sql_select_parens_node TO sql_cmd_copy_target_descriptor sql_cmd_opt_with sql_cmd_copy_options sql_partition_expressions {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY,
            &[
                attr(Key::SQL_COPY_DIRECTION, enum_node(@$, CopyDirection::TO)),
                attr(Key::SQL_COPY_QUERY, $2),
                attr(Key::SQL_COPY_LOCATION, $4),
                attr(Key::SQL_COPY_OPTIONS, ctx.array(@6, $6)),
                attr(Key::SQL_COPY_PARTITION_BY, $7),
            ],
        )
    }
    ;

sql_cmd_create_db_from_stmt:
    CREATE_P sql_cmd_opt_db_locality DATABASE sql_cmd_database_name sql_cmd_opt_with sql_cmd_createdb_opt_list FROM sql_cmd_database_name sql_cmd_opt_with sql_cmd_createdb_opt_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DATABASE_COPY,
            &[
                attr(Key::SQL_CREATE_DATABASE_COPY_LOCALITY, $2),
                attr(Key::SQL_CREATE_DATABASE_COPY_TARGET, $4),
                attr(Key::SQL_CREATE_DATABASE_COPY_OPTIONS, ctx.array(@6, $6)),
                attr(Key::SQL_CREATE_DATABASE_COPY_SOURCE, $8),
                attr(Key::SQL_CREATE_DATABASE_COPY_SOURCE_OPTIONS, ctx.array(@10, $10)),
            ],
        )
    }
    | CREATE_P sql_cmd_opt_db_locality DATABASE IF_P NOT EXISTS sql_cmd_database_name sql_cmd_opt_with sql_cmd_createdb_opt_list FROM sql_cmd_database_name sql_cmd_opt_with sql_cmd_createdb_opt_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DATABASE_COPY,
            &[
                attr(Key::SQL_CREATE_DATABASE_COPY_IF_NOT_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_CREATE_DATABASE_COPY_LOCALITY, $2),
                attr(Key::SQL_CREATE_DATABASE_COPY_TARGET, $7),
                attr(Key::SQL_CREATE_DATABASE_COPY_OPTIONS, ctx.array(@9, $9)),
                attr(Key::SQL_CREATE_DATABASE_COPY_SOURCE, $11),
                attr(Key::SQL_CREATE_DATABASE_COPY_SOURCE_OPTIONS, ctx.array(@13, $13)),
            ],
        )
    }
    ;

sql_cmd_create_db_stmt:
    CREATE_P sql_cmd_opt_db_locality DATABASE sql_cmd_database_name sql_cmd_opt_with sql_cmd_createdb_opt_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DATABASE,
            &[
                attr(Key::SQL_CREATE_DATABASE_LOCALITY, $2),
                attr(Key::SQL_CREATE_DATABASE_NAME, $4),
                attr(Key::SQL_CREATE_DATABASE_OPTIONS, ctx.array(@6, $6)),
            ],
        )
    }
    | CREATE_P sql_cmd_opt_db_locality DATABASE IF_P NOT EXISTS sql_cmd_database_name sql_cmd_opt_with sql_cmd_createdb_opt_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DATABASE,
            &[
                attr(Key::SQL_CREATE_DATABASE_IF_NOT_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_CREATE_DATABASE_LOCALITY, $2),
                attr(Key::SQL_CREATE_DATABASE_NAME, $7),
                attr(Key::SQL_CREATE_DATABASE_OPTIONS, ctx.array(@9, $9)),
            ],
        )
    }
    ;

sql_cmd_create_external_stream_stmt:
    CREATE_P sql_opt_temp sql_cmd_stream_type sql_qualified_name sql_cmd_external_stream_schema sql_cmd_opt_external_stream_options {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_EXTERNAL_STREAM,
            &[
                attr(Key::SQL_CREATE_EXTERNAL_STREAM_TEMP, $2),
                attr(Key::SQL_CREATE_EXTERNAL_STREAM_TYPE, $3),
                attr(Key::SQL_CREATE_EXTERNAL_STREAM_NAME, $4),
                attr(Key::SQL_CREATE_EXTERNAL_STREAM_SCHEMA, $5),
                attr(Key::SQL_CREATE_EXTERNAL_STREAM_OPTIONS, ctx.array(@6, $6)),
            ],
        )
    }
    | CREATE_P sql_opt_temp sql_cmd_stream_type IF_P NOT EXISTS sql_qualified_name sql_cmd_external_stream_schema sql_cmd_opt_external_stream_options {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_EXTERNAL_STREAM,
            &[
                attr(Key::SQL_CREATE_EXTERNAL_STREAM_IF_NOT_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_CREATE_EXTERNAL_STREAM_TEMP, $2),
                attr(Key::SQL_CREATE_EXTERNAL_STREAM_TYPE, $3),
                attr(Key::SQL_CREATE_EXTERNAL_STREAM_NAME, $7),
                attr(Key::SQL_CREATE_EXTERNAL_STREAM_SCHEMA, $8),
                attr(Key::SQL_CREATE_EXTERNAL_STREAM_OPTIONS, ctx.array(@9, $9)),
            ],
        )
    }
    ;

sql_cmd_create_external_table_stmt:
    CREATE_P sql_opt_temp EXTERNAL TABLE sql_qualified_name sql_cmd_external_table_schema FOR sql_cmd_source_descriptor {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_EXTERNAL_TABLE,
            &[
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_TEMP, $2),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_NAME, $5),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_SCHEMA, $6),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_FILENAME, $8),
            ],
        )
    }
    | CREATE_P sql_opt_temp EXTERNAL TABLE IF_P NOT EXISTS sql_qualified_name sql_cmd_external_table_schema FOR sql_cmd_source_descriptor {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_EXTERNAL_TABLE,
            &[
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_IF_NOT_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_TEMP, $2),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_NAME, $8),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_SCHEMA, $9),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_FILENAME, $11),
            ],
        )
    }
    | CREATE_P sql_opt_temp EXTERNAL TABLE sql_qualified_name sql_cmd_external_table_schema FOR sql_cmd_source_descriptor LRB sql_cmd_opt_with sql_cmd_copy_options RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_EXTERNAL_TABLE,
            &[
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_TEMP, $2),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_NAME, $5),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_SCHEMA, $6),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_FILENAME, $8),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_OPTIONS, ctx.array(@11, $11)),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_IS_OLD_SYNTAX, bool_node(@1, true)),
            ],
        )
    }
    | CREATE_P sql_opt_temp EXTERNAL TABLE IF_P NOT EXISTS sql_qualified_name sql_cmd_external_table_schema FOR sql_cmd_source_descriptor LRB sql_cmd_opt_with sql_cmd_copy_options RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_EXTERNAL_TABLE,
            &[
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_IF_NOT_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_TEMP, $2),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_NAME, $8),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_SCHEMA, $9),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_FILENAME, $11),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_OPTIONS, ctx.array(@14, $14)),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_IS_OLD_SYNTAX, bool_node(@1, true)),
            ],
        )
    }
    | CREATE_P sql_opt_temp EXTERNAL TABLE sql_qualified_name sql_cmd_external_table_schema FOR sql_cmd_source_descriptor WITH LRB sql_cmd_copy_named_opt_list RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_EXTERNAL_TABLE,
            &[
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_TEMP, $2),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_NAME, $5),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_SCHEMA, $6),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_FILENAME, $8),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_OPTIONS, ctx.array(@11, $11)),
            ],
        )
    }
    | CREATE_P sql_opt_temp EXTERNAL TABLE IF_P NOT EXISTS sql_qualified_name sql_cmd_external_table_schema FOR sql_cmd_source_descriptor WITH LRB sql_cmd_copy_named_opt_list RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_EXTERNAL_TABLE,
            &[
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_IF_NOT_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_TEMP, $2),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_NAME, $8),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_SCHEMA, $9),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_FILENAME, $11),
                attr(Key::SQL_CREATE_EXTERNAL_TABLE_OPTIONS, ctx.array(@14, $14)),
            ],
        )
    }
    ;

sql_cmd_create_function_stmt:
    CREATE_P sql_opt_temp FUNCTION sql_func_name sql_cmd_func_args_with_defaults RETURNS sql_cmd_func_arg_type sql_cmd_createfunc_opt_list sql_opt_definition {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION,
            &[
                attr(Key::SQL_CREATE_FUNCTION_TEMP, $2),
                attr(Key::SQL_CREATE_FUNCTION_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_CREATE_FUNCTION_PARAMS, ctx.array(@5, $5)),
                attr(Key::SQL_CREATE_FUNCTION_RETURNS, $7),
                attr(Key::SQL_CREATE_FUNCTION_OPTIONS, ctx.array(@8, $8)),
                attr(Key::SQL_CREATE_FUNCTION_WITH_OPTIONS, ctx.array(@9, $9)),
            ],
        )
    }
    | CREATE_P sql_opt_temp FUNCTION sql_func_name sql_cmd_func_args_with_defaults RETURNS sql_cmd_func_arg_type NOT NULL_P sql_cmd_createfunc_opt_list sql_opt_definition {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION,
            &[
                attr(Key::SQL_CREATE_FUNCTION_TEMP, $2),
                attr(Key::SQL_CREATE_FUNCTION_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_CREATE_FUNCTION_PARAMS, ctx.array(@5, $5)),
                attr(Key::SQL_CREATE_FUNCTION_RETURNS, $7),
                attr(Key::SQL_CREATE_FUNCTION_RETURNS_NOT_NULL, bool_node(@8, true)),
                attr(Key::SQL_CREATE_FUNCTION_OPTIONS, ctx.array(@10, $10)),
                attr(Key::SQL_CREATE_FUNCTION_WITH_OPTIONS, ctx.array(@11, $11)),
            ],
        )
    }
    | CREATE_P sql_opt_temp FUNCTION sql_func_name sql_cmd_func_args_with_defaults sql_cmd_createfunc_opt_list sql_opt_definition {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION,
            &[
                attr(Key::SQL_CREATE_FUNCTION_TEMP, $2),
                attr(Key::SQL_CREATE_FUNCTION_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_CREATE_FUNCTION_PARAMS, ctx.array(@5, $5)),
                attr(Key::SQL_CREATE_FUNCTION_OPTIONS, ctx.array(@6, $6)),
                attr(Key::SQL_CREATE_FUNCTION_WITH_OPTIONS, ctx.array(@7, $7)),
            ],
        )
    }
    | CREATE_P OR REPLACE sql_opt_temp FUNCTION sql_func_name sql_cmd_func_args_with_defaults RETURNS sql_cmd_func_arg_type sql_cmd_createfunc_opt_list sql_opt_definition {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION,
            &[
                attr(Key::SQL_CREATE_FUNCTION_REPLACE, bool_node(@3, true)),
                attr(Key::SQL_CREATE_FUNCTION_TEMP, $4),
                attr(Key::SQL_CREATE_FUNCTION_NAME, ctx.array(@6, $6)),
                attr(Key::SQL_CREATE_FUNCTION_PARAMS, ctx.array(@7, $7)),
                attr(Key::SQL_CREATE_FUNCTION_RETURNS, $9),
                attr(Key::SQL_CREATE_FUNCTION_OPTIONS, ctx.array(@10, $10)),
                attr(Key::SQL_CREATE_FUNCTION_WITH_OPTIONS, ctx.array(@11, $11)),
            ],
        )
    }
    | CREATE_P OR REPLACE sql_opt_temp FUNCTION sql_func_name sql_cmd_func_args_with_defaults RETURNS sql_cmd_func_arg_type NOT NULL_P sql_cmd_createfunc_opt_list sql_opt_definition {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION,
            &[
                attr(Key::SQL_CREATE_FUNCTION_REPLACE, bool_node(@3, true)),
                attr(Key::SQL_CREATE_FUNCTION_TEMP, $4),
                attr(Key::SQL_CREATE_FUNCTION_NAME, ctx.array(@6, $6)),
                attr(Key::SQL_CREATE_FUNCTION_PARAMS, ctx.array(@7, $7)),
                attr(Key::SQL_CREATE_FUNCTION_RETURNS, $9),
                attr(Key::SQL_CREATE_FUNCTION_RETURNS_NOT_NULL, bool_node(@10, true)),
                attr(Key::SQL_CREATE_FUNCTION_OPTIONS, ctx.array(@12, $12)),
                attr(Key::SQL_CREATE_FUNCTION_WITH_OPTIONS, ctx.array(@13, $13)),
            ],
        )
    }
    | CREATE_P OR REPLACE sql_opt_temp FUNCTION sql_func_name sql_cmd_func_args_with_defaults sql_cmd_createfunc_opt_list sql_opt_definition {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION,
            &[
                attr(Key::SQL_CREATE_FUNCTION_REPLACE, bool_node(@3, true)),
                attr(Key::SQL_CREATE_FUNCTION_TEMP, $4),
                attr(Key::SQL_CREATE_FUNCTION_NAME, ctx.array(@6, $6)),
                attr(Key::SQL_CREATE_FUNCTION_PARAMS, ctx.array(@7, $7)),
                attr(Key::SQL_CREATE_FUNCTION_OPTIONS, ctx.array(@8, $8)),
                attr(Key::SQL_CREATE_FUNCTION_WITH_OPTIONS, ctx.array(@9, $9)),
            ],
        )
    }
  | CREATE_P sql_opt_temp FUNCTION sql_func_name sql_cmd_func_args_with_defaults RETURNS sql_cmd_func_arg_type {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION,
            &[
                attr(Key::SQL_CREATE_FUNCTION_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_CREATE_FUNCTION_PARAMS, ctx.array(@5, $5)),
                attr(Key::SQL_CREATE_FUNCTION_RETURNS, $7),
                attr(Key::SQL_CREATE_FUNCTION_TEMP, $2),
            ],
        )
    }
  | CREATE_P sql_opt_temp FUNCTION sql_func_name sql_cmd_func_args_with_defaults RETURNS sql_cmd_func_arg_type NOT NULL_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION,
            &[
                attr(Key::SQL_CREATE_FUNCTION_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_CREATE_FUNCTION_PARAMS, ctx.array(@5, $5)),
                attr(Key::SQL_CREATE_FUNCTION_RETURNS, $7),
                attr(Key::SQL_CREATE_FUNCTION_TEMP, $2),
                attr(Key::SQL_CREATE_FUNCTION_RETURNS_NOT_NULL, bool_node(@$, true)),
            ],
        )
    }
  | CREATE_P OR REPLACE sql_opt_temp FUNCTION sql_func_name sql_cmd_func_args_with_defaults RETURNS sql_cmd_func_arg_type {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION,
            &[
                attr(Key::SQL_CREATE_FUNCTION_NAME, ctx.array(@6, $6)),
                attr(Key::SQL_CREATE_FUNCTION_PARAMS, ctx.array(@7, $7)),
                attr(Key::SQL_CREATE_FUNCTION_RETURNS, $9),
                attr(Key::SQL_CREATE_FUNCTION_TEMP, $4),
                attr(Key::SQL_CREATE_FUNCTION_REPLACE, bool_node(@3, true)),
            ],
        )
    }
  | CREATE_P OR REPLACE sql_opt_temp FUNCTION sql_func_name sql_cmd_func_args_with_defaults RETURNS sql_cmd_func_arg_type NOT NULL_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION,
            &[
                attr(Key::SQL_CREATE_FUNCTION_NAME, ctx.array(@6, $6)),
                attr(Key::SQL_CREATE_FUNCTION_PARAMS, ctx.array(@7, $7)),
                attr(Key::SQL_CREATE_FUNCTION_RETURNS, $9),
                attr(Key::SQL_CREATE_FUNCTION_TEMP, $4),
                attr(Key::SQL_CREATE_FUNCTION_REPLACE, bool_node(@3, true)),
                attr(Key::SQL_CREATE_FUNCTION_RETURNS_NOT_NULL, bool_node(@$, true)),
            ],
        )
    }
    ;
sql_cmd_create_group_stmt:
    CREATE_P GROUP_P sql_qualified_name sql_cmd_opt_with sql_cmd_opt_role_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_ROLE,
            &[
                attr(Key::SQL_CREATE_ROLE_TYPE, enum_node(@$, RoleType::GROUP)),
                attr(Key::SQL_CREATE_ROLE_ROLE, $3),
                attr(Key::SQL_CREATE_ROLE_OPTIONS, ctx.array(@5, $5)),
            ],
        )
    }
    ;

sql_cmd_create_index_stmt:
    CREATE_P sql_cmd_opt_unique INDEX sql_cmd_opt_concurrently sql_cmd_opt_index_name ON sql_qualified_name sql_cmd_access_method_clause LRB sql_cmd_index_params RRB sql_cmd_opt_reloptions {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_INDEX,
            &[
                attr(Key::SQL_CREATE_INDEX_UNIQUE, $2),
                attr(Key::SQL_CREATE_INDEX_CONCURRENT, $4),
                attr(Key::SQL_CREATE_INDEX_NAME, $5),
                attr(Key::SQL_CREATE_INDEX_RELATION, $7),
                attr(Key::SQL_CREATE_INDEX_ACCESS_METHOD, $8),
                attr(Key::SQL_CREATE_INDEX_INDEX_PARAMS, ctx.array(@10, $10)),
                attr(Key::SQL_CREATE_INDEX_OPTIONS, ctx.array(@12, $12)),
            ],
        )
    }
    | CREATE_P sql_cmd_opt_unique INDEX sql_cmd_opt_concurrently IF_P NOT EXISTS sql_cmd_opt_index_name ON sql_qualified_name sql_cmd_access_method_clause LRB sql_cmd_index_params RRB sql_cmd_opt_reloptions {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_INDEX,
            &[
                attr(Key::SQL_CREATE_INDEX_IF_NOT_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_CREATE_INDEX_UNIQUE, $2),
                attr(Key::SQL_CREATE_INDEX_CONCURRENT, $4),
                attr(Key::SQL_CREATE_INDEX_NAME, $8),
                attr(Key::SQL_CREATE_INDEX_RELATION, $10),
                attr(Key::SQL_CREATE_INDEX_ACCESS_METHOD, $11),
                attr(Key::SQL_CREATE_INDEX_INDEX_PARAMS, ctx.array(@13, $13)),
                attr(Key::SQL_CREATE_INDEX_OPTIONS, ctx.array(@15, $15)),
            ],
        )
    }
    ;

sql_cmd_create_opt_role_elem:
    sql_cmd_alter_opt_role_elem { $1 }
    | ADMIN sql_cmd_role_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROLE_ELEMENT,
            &[
                attr(Key::SQL_ROLE_ELEMENT_KIND, enum_node(@$, RoleOption::ADMIN)),
                attr(Key::SQL_ROLE_ELEMENT_ARG, ctx.array(@2, $2)),
            ],
        )
    }
    | ROLE sql_cmd_role_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROLE_ELEMENT,
            &[
                attr(Key::SQL_ROLE_ELEMENT_KIND, enum_node(@$, RoleOption::ROLE)),
                attr(Key::SQL_ROLE_ELEMENT_ARG, ctx.array(@2, $2)),
            ],
        )
    }
    | IN_P ROLE sql_cmd_role_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROLE_ELEMENT,
            &[
                attr(Key::SQL_ROLE_ELEMENT_KIND, enum_node(@$, RoleOption::IN_ROLE)),
                attr(Key::SQL_ROLE_ELEMENT_ARG, ctx.array(@3, $3)),
            ],
        )
    }
    ;

sql_cmd_create_role_stmt:
    CREATE_P ROLE sql_qualified_name sql_cmd_opt_with sql_cmd_opt_role_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_ROLE,
            &[
                attr(Key::SQL_CREATE_ROLE_TYPE, enum_node(@$, RoleType::ROLE)),
                attr(Key::SQL_CREATE_ROLE_ROLE, $3),
                attr(Key::SQL_CREATE_ROLE_OPTIONS, ctx.array(@5, $5)),
            ],
        )
    }
    ;

sql_cmd_create_seq_stmt:
    CREATE_P sql_opt_temp SEQUENCE sql_qualified_name sql_cmd_opt__sequence_option_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_SEQUENCE,
            &[
                attr(Key::SQL_CREATE_SEQUENCE_TEMP, $2),
                attr(Key::SQL_CREATE_SEQUENCE_NAME, $4),
                attr(Key::SQL_CREATE_SEQUENCE_OPTIONS, ctx.array(@5, $5)),
            ],
        )
    }
    | CREATE_P sql_opt_temp SEQUENCE IF_P NOT EXISTS sql_qualified_name sql_cmd_opt__sequence_option_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_SEQUENCE,
            &[
                attr(Key::SQL_CREATE_SEQUENCE_IF_NOT_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_CREATE_SEQUENCE_TEMP, $2),
                attr(Key::SQL_CREATE_SEQUENCE_NAME, $7),
                attr(Key::SQL_CREATE_SEQUENCE_OPTIONS, ctx.array(@8, $8)),
            ],
        )
    }
    ;

sql_cmd_create_user_stmt:
    CREATE_P USER sql_qualified_name sql_cmd_opt_with sql_cmd_opt_role_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_ROLE,
            &[
                attr(Key::SQL_CREATE_ROLE_TYPE, enum_node(@$, RoleType::USER)),
                attr(Key::SQL_CREATE_ROLE_ROLE, $3),
                attr(Key::SQL_CREATE_ROLE_OPTIONS, ctx.array(@5, $5)),
            ],
        )
    }
    ;

sql_cmd_deallocate_stmt:
    DEALLOCATE sql_name { ctx.object(@$,NodeType::OBJECT_SQL_DEALLOCATE,&[attr(Key::SQL_DEALLOCATE_NAME,$2)]) }
    | DEALLOCATE PREPARE sql_name { ctx.object(@$,NodeType::OBJECT_SQL_DEALLOCATE,&[attr(Key::SQL_DEALLOCATE_NAME,$3)]) }
    | DEALLOCATE ALL { ctx.object_ex(@$,NodeType::OBJECT_SQL_DEALLOCATE,NO_NODES,false,false) }
    | DEALLOCATE PREPARE ALL { ctx.object_ex(@$,NodeType::OBJECT_SQL_DEALLOCATE,NO_NODES,false,false) }
    ;

sql_cmd_declare_cursor_stmt:
    DECLARE sql_cmd_cursor_name sql_cmd_cursor_options CURSOR sql_cmd_opt_hold FOR sql_select_node {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DECLARE_CURSOR,
            &[
                attr(Key::SQL_DECLARE_CURSOR_NAME, $2),
                attr(Key::SQL_DECLARE_CURSOR_OPTIONS, ctx.array(@3, $3)),
                attr(Key::SQL_DECLARE_CURSOR_WITH_HOLD, $5),
                attr(Key::SQL_DECLARE_CURSOR_QUERY, $7),
            ],
        )
    }
    ;

sql_cmd_define_stmt:
    CREATE_P sql_opt_temp AGGREGATE sql_func_name sql_cmd_aggr_args sql_definition {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DEFINITION,
            &[
                attr(Key::SQL_CREATE_DEFINITION_KIND, enum_node(@$, DefinitionType::AGGREGATE)),
                attr(Key::SQL_CREATE_DEFINITION_TEMP, $2),
                attr(Key::SQL_CREATE_DEFINITION_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_CREATE_DEFINITION_ARGS, $5),
                attr(Key::SQL_CREATE_DEFINITION_DEFINITION, ctx.array(@6, $6)),
            ],
        )
    }
    | CREATE_P sql_opt_temp AGGREGATE sql_func_name sql_cmd_old_aggr_definition {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DEFINITION,
            &[
                attr(Key::SQL_CREATE_DEFINITION_KIND, enum_node(@$, DefinitionType::AGGREGATE)),
                attr(Key::SQL_CREATE_DEFINITION_OLD_SYNTAX, bool_node(@$, true)),
                attr(Key::SQL_CREATE_DEFINITION_TEMP, $2),
                attr(Key::SQL_CREATE_DEFINITION_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_CREATE_DEFINITION_DEFINITION, ctx.array(@5, $5)),
            ],
        )
    }
    | CREATE_P sql_opt_temp OPERATOR sql_any_operator sql_definition {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DEFINITION,
            &[
                attr(Key::SQL_CREATE_DEFINITION_KIND, enum_node(@$, DefinitionType::OPERATOR)),
                attr(Key::SQL_CREATE_DEFINITION_TEMP, $2),
                attr(Key::SQL_CREATE_DEFINITION_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_CREATE_DEFINITION_DEFINITION, ctx.array(@5, $5)),
            ],
        )
    }
    | CREATE_P sql_opt_temp TYPE_P sql_any_name sql_definition {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DEFINITION,
            &[
                attr(Key::SQL_CREATE_DEFINITION_KIND, enum_node(@$, DefinitionType::TYPE)),
                attr(Key::SQL_CREATE_DEFINITION_TEMP, $2),
                attr(Key::SQL_CREATE_DEFINITION_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_CREATE_DEFINITION_DEFINITION, ctx.array(@5, $5)),
            ],
        )
    }
    | CREATE_P sql_opt_temp TYPE_P sql_any_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DEFINITION,
            &[
                attr(Key::SQL_CREATE_DEFINITION_KIND, enum_node(@$, DefinitionType::TYPE)),
                attr(Key::SQL_CREATE_DEFINITION_TEMP, $2),
                attr(Key::SQL_CREATE_DEFINITION_NAME, ctx.array(@4, $4)),
            ],
        )
    }
    | CREATE_P sql_opt_temp TYPE_P sql_any_name AS LRB sql_optional_table_columns RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DEFINITION,
            &[
                attr(Key::SQL_CREATE_DEFINITION_KIND, enum_node(@$, DefinitionType::STRUCT)),
                attr(Key::SQL_CREATE_DEFINITION_TEMP, $2),
                attr(Key::SQL_CREATE_DEFINITION_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_CREATE_DEFINITION_DEFINITION, ctx.array(@7, $7)),
            ],
        )
    }
    | CREATE_P sql_opt_temp TYPE_P sql_any_name AS ENUM_P LRB sql_cmd_opt_enum_val_list RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DEFINITION,
            &[
                attr(Key::SQL_CREATE_DEFINITION_KIND, enum_node(@$, DefinitionType::ENUM)),
                attr(Key::SQL_CREATE_DEFINITION_TEMP, $2),
                attr(Key::SQL_CREATE_DEFINITION_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_CREATE_DEFINITION_DEFINITION, ctx.array(@8, $8)),
            ],
        )
    }
    | CREATE_P sql_opt_temp TYPE_P sql_any_name AS RANGE sql_definition {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DEFINITION,
            &[
                attr(Key::SQL_CREATE_DEFINITION_KIND, enum_node(@$, DefinitionType::RANGE)),
                attr(Key::SQL_CREATE_DEFINITION_TEMP, $2),
                attr(Key::SQL_CREATE_DEFINITION_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_CREATE_DEFINITION_DEFINITION, ctx.array(@7, $7)),
            ],
        )
    }
    | CREATE_P sql_opt_temp DOMAIN_P sql_any_name AS sql_typename {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DEFINITION,
            &[
                attr(Key::SQL_CREATE_DEFINITION_KIND, enum_node(@$, DefinitionType::DOMAIN)),
                attr(Key::SQL_CREATE_DEFINITION_TEMP, $2),
                attr(Key::SQL_CREATE_DEFINITION_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_CREATE_DEFINITION_DEFINITION, $6),
            ],
        )
    }
    | CREATE_P sql_opt_temp DOMAIN_P sql_any_name AS sql_typename WITH LRB sql_cmd_domain_arg_list RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DEFINITION,
            &[
                attr(Key::SQL_CREATE_DEFINITION_KIND, enum_node(@$, DefinitionType::DOMAIN)),
                attr(Key::SQL_CREATE_DEFINITION_TEMP, $2),
                attr(Key::SQL_CREATE_DEFINITION_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_CREATE_DEFINITION_DEFINITION, $6),
                attr(Key::SQL_CREATE_DEFINITION_ARGS, ctx.array(@9, $9)),
            ],
        )
    }
    | CREATE_P TEXT_P SEARCH PARSER sql_any_name sql_definition {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DEFINITION,
            &[
                attr(Key::SQL_CREATE_DEFINITION_KIND, enum_node(@$, DefinitionType::TEXT_SEARCH_PARSER)),
                attr(Key::SQL_CREATE_DEFINITION_NAME, ctx.array(@5, $5)),
                attr(Key::SQL_CREATE_DEFINITION_DEFINITION, ctx.array(@6, $6)),
            ],
        )
    }
    | CREATE_P TEXT_P SEARCH DICTIONARY sql_any_name sql_definition {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DEFINITION,
            &[
                attr(Key::SQL_CREATE_DEFINITION_KIND, enum_node(@$, DefinitionType::TEXT_SEARCH_DICTIONARY)),
                attr(Key::SQL_CREATE_DEFINITION_NAME, ctx.array(@5, $5)),
                attr(Key::SQL_CREATE_DEFINITION_DEFINITION, ctx.array(@6, $6)),
            ],
        )
    }
    | CREATE_P TEXT_P SEARCH TEMPLATE sql_any_name sql_definition {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DEFINITION,
            &[
                attr(Key::SQL_CREATE_DEFINITION_KIND, enum_node(@$, DefinitionType::TEXT_SEARCH_TEMPLATE)),
                attr(Key::SQL_CREATE_DEFINITION_NAME, ctx.array(@5, $5)),
                attr(Key::SQL_CREATE_DEFINITION_DEFINITION, ctx.array(@6, $6)),
            ],
        )
    }
    | CREATE_P TEXT_P SEARCH CONFIGURATION sql_any_name sql_definition {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DEFINITION,
            &[
                attr(Key::SQL_CREATE_DEFINITION_KIND, enum_node(@$, DefinitionType::TEXT_SEARCH_CONFIGURATION)),
                attr(Key::SQL_CREATE_DEFINITION_NAME, ctx.array(@5, $5)),
                attr(Key::SQL_CREATE_DEFINITION_DEFINITION, ctx.array(@6, $6)),
            ],
        )
    }
    | CREATE_P COLLATION sql_any_name sql_definition {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DEFINITION,
            &[
                attr(Key::SQL_CREATE_DEFINITION_KIND, enum_node(@$, DefinitionType::COLLATION)),
                attr(Key::SQL_CREATE_DEFINITION_NAME, ctx.array(@3, $3)),
                attr(Key::SQL_CREATE_DEFINITION_DEFINITION, ctx.array(@4, $4)),
            ],
        )
    }
    | CREATE_P COLLATION sql_any_name FROM sql_any_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DEFINITION,
            &[
                attr(Key::SQL_CREATE_DEFINITION_KIND, enum_node(@$, DefinitionType::COLLATION)),
                attr(Key::SQL_CREATE_DEFINITION_NAME, ctx.array(@3, $3)),
                attr(Key::SQL_CREATE_DEFINITION_FROM, ctx.array(@5, $5)),
            ],
        )
    }
    ;

sql_cmd_detach_db_stmt:
    DETACH DATABASE sql_cmd_database_name_list { ctx.object(@$,NodeType::OBJECT_SQL_DETACH_DATABASE,&[attr(Key::SQL_DETACH_DATABASE_ALIAS,ctx.array(@3,$3))]) }
    | DETACH DATABASE STAR { ctx.object_ex(@$,NodeType::OBJECT_SQL_DETACH_DATABASE,NO_NODES,false,false) }
    ;

sql_cmd_drop_db_stmt:
    DROP sql_cmd_opt_db_locality DATABASE sql_cmd_database_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DROP_DATABASE,
            &[attr(Key::SQL_DROP_DATABASE_LOCALITY, $2), attr(Key::SQL_DROP_DATABASE_NAME, $4)],
        )
    }
    | DROP sql_cmd_opt_db_locality DATABASE IF_P EXISTS sql_cmd_database_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DROP_DATABASE,
            &[
                attr(Key::SQL_DROP_DATABASE_IF_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_DROP_DATABASE_LOCALITY, $2),
                attr(Key::SQL_DROP_DATABASE_NAME, $6),
            ],
        )
    }
    ;

sql_cmd_drop_func_stmt:
    DROP FUNCTION sql_func_name sql_cmd_func_args sql_cmd_opt_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DROP_FUNCTION,
            &[
                attr(Key::SQL_DROP_FUNCTION_NAME, ctx.array(@3, $3)),
                attr(Key::SQL_DROP_FUNCTION_ARGUMENTS, ctx.array(@4, $4)),
                attr(Key::SQL_DROP_FUNCTION_BEHAVIOR, $5),
            ],
        )
    }
    | DROP FUNCTION IF_P EXISTS sql_func_name sql_cmd_func_args sql_cmd_opt_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DROP_FUNCTION,
            &[
                attr(Key::SQL_DROP_FUNCTION_IF_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_DROP_FUNCTION_NAME, ctx.array(@5, $5)),
                attr(Key::SQL_DROP_FUNCTION_ARGUMENTS, ctx.array(@6, $6)),
                attr(Key::SQL_DROP_FUNCTION_BEHAVIOR, $7),
            ],
        )
    }
    ;

sql_cmd_drop_group_stmt:
    DROP GROUP_P sql_qualified_name_list { ctx.object(@$,NodeType::OBJECT_SQL_DROP_ROLE,&[attr(Key::SQL_DROP_ROLE_ROLES,ctx.array(@3,$3))]) }
    | DROP GROUP_P IF_P EXISTS sql_qualified_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DROP_ROLE,
            &[
                attr(Key::SQL_DROP_ROLE_IF_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_DROP_ROLE_ROLES, ctx.array(@5, $5)),
            ],
        )
    }
    ;

sql_cmd_drop_role_stmt:
    DROP ROLE sql_qualified_name_list { ctx.object(@$,NodeType::OBJECT_SQL_DROP_ROLE,&[attr(Key::SQL_DROP_ROLE_ROLES,ctx.array(@3,$3))]) }
    | DROP ROLE IF_P EXISTS sql_qualified_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DROP_ROLE,
            &[
                attr(Key::SQL_DROP_ROLE_IF_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_DROP_ROLE_ROLES, ctx.array(@5, $5)),
            ],
        )
    }
    ;

sql_cmd_drop_stmt:
    DROP sql_cmd_drop_type IF_P EXISTS sql_cmd_any_name_list sql_cmd_opt_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DROP,
            &[
                attr(Key::SQL_DROP_IF_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_DROP_TYPE, $2),
                attr(Key::SQL_DROP_NAME, ctx.array(@5, $5)),
                attr(Key::SQL_DROP_BEHAVIOR, $6),
            ],
        )
    }
    | DROP sql_cmd_drop_type sql_cmd_any_name_list sql_cmd_opt_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DROP,
            &[
                attr(Key::SQL_DROP_TYPE, $2),
                attr(Key::SQL_DROP_NAME, ctx.array(@3, $3)),
                attr(Key::SQL_DROP_BEHAVIOR, $4),
            ],
        )
    }
    | DROP INDEX CONCURRENTLY sql_cmd_any_name_list sql_cmd_opt_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DROP,
            &[
                attr(Key::SQL_DROP_TYPE, enum_node(@2, DropObjectType::INDEX)),
                attr(Key::SQL_DROP_CONCURRENTLY, bool_node(@$, true)),
                attr(Key::SQL_DROP_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_DROP_BEHAVIOR, $5),
            ],
        )
    }
    | DROP INDEX CONCURRENTLY IF_P EXISTS sql_cmd_any_name_list sql_cmd_opt_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DROP,
            &[
                attr(Key::SQL_DROP_TYPE, enum_node(@2, DropObjectType::INDEX)),
                attr(Key::SQL_DROP_CONCURRENTLY, bool_node(@$, true)),
                attr(Key::SQL_DROP_IF_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_DROP_NAME, ctx.array(@6, $6)),
                attr(Key::SQL_DROP_BEHAVIOR, $7),
            ],
        )
    }
    ;

sql_cmd_drop_user_stmt:
    DROP USER sql_qualified_name_list { ctx.object(@$,NodeType::OBJECT_SQL_DROP_ROLE,&[attr(Key::SQL_DROP_ROLE_ROLES,ctx.array(@3,$3))]) }
    | DROP USER IF_P EXISTS sql_qualified_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DROP_ROLE,
            &[
                attr(Key::SQL_DROP_ROLE_IF_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_DROP_ROLE_ROLES, ctx.array(@5, $5)),
            ],
        )
    }
    ;

sql_cmd_execute_stmt:
    EXECUTE sql_name sql_cmd_execute_param_clause {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_EXECUTE,
            &[
                attr(Key::SQL_EXECUTE_NAME, $2),
                attr(Key::SQL_EXECUTE_ARGS, ctx.array(@3, $3)),
            ],
        )
    }
    ;

sql_cmd_export_db_stmt:
    EXPORT_P sql_cmd_opt_db_locality DATABASE sql_cmd_database_name sql_cmd_opt_with sql_cmd_createdb_opt_list TO sql_cmd_copy_target_descriptor sql_cmd_opt_with sql_cmd_createdb_opt_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DATABASE_COPY,
            &[
                attr(Key::SQL_CREATE_DATABASE_COPY_DIRECTION, enum_node(@$, DatabaseCopyDirection::EXPORT)),
                attr(Key::SQL_CREATE_DATABASE_COPY_SOURCE_LOCALITY, $2),
                attr(Key::SQL_CREATE_DATABASE_COPY_SOURCE, $4),
                attr(Key::SQL_CREATE_DATABASE_COPY_SOURCE_OPTIONS, ctx.array(@6, $6)),
                attr(Key::SQL_CREATE_DATABASE_COPY_TARGET, $8),
                attr(Key::SQL_CREATE_DATABASE_COPY_OPTIONS, ctx.array(@10, $10)),
            ],
        )
    }
    ;

sql_cmd_external_stream_schema:
    LIKE sql_qualified_name { $2 }
    | LRB sql_column_def_list RRB { ctx.array(@$, $2) }
    | LRB RRB { null() }
    ;

sql_cmd_external_table_schema:
    LIKE sql_qualified_name { $2 }
    | LRB sql_column_def_list RRB { ctx.array(@$, $2) }
    | LRB RRB { null() }
    | %empty { ctx.object_ex(@$,NodeType::OBJECT_SQL_CREATE_EXTERNAL_TABLE_INFER_SCHEMA,NO_NODES,false,false) }
    ;

sql_cmd_fetch_stmt:
    FETCH sql_cmd_fetch_args sql_cmd_opt_from_in sql_cmd_cursor_name { ctx.object(@$,NodeType::OBJECT_SQL_FETCH,&[attr(Key::SQL_FETCH_DIRECTION,$2),attr(Key::SQL_FETCH_NAME,$4)]) }
    | FETCH sql_cmd_cursor_name { ctx.object(@$,NodeType::OBJECT_SQL_FETCH,&[attr(Key::SQL_FETCH_NAME,$2)]) }
    | MOVE sql_cmd_fetch_args sql_cmd_opt_from_in sql_cmd_cursor_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FETCH,
            &[
                attr(Key::SQL_FETCH_MOVE, bool_node(@$, true)),
                attr(Key::SQL_FETCH_DIRECTION, $2),
                attr(Key::SQL_FETCH_NAME, $4),
            ],
        )
    }
    | MOVE sql_cmd_cursor_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FETCH,
            &[
                attr(Key::SQL_FETCH_MOVE, bool_node(@$, true)),
                attr(Key::SQL_FETCH_NAME, $2),
            ],
        )
    }
    ;

sql_cmd_function_set_reset_clause:
    SET sql_cmd_set_rest_more { ctx.set(@$, $2) }
    | sql_cmd_variable_reset_stmt { $1 }
    ;

sql_cmd_grant_role_stmt:
    GRANT sql_cmd_privilege_list TO sql_qualified_name_list sql_cmd_opt_grant_admin_option sql_cmd_opt_granted_by {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_ROLE,
            &[
                attr(Key::SQL_GRANT_ROLE_ROLES, ctx.array(@2, $2)),
                attr(Key::SQL_GRANT_ROLE_GRANTEES, ctx.array(@4, $4)),
                attr(Key::SQL_GRANT_ROLE_BEHAVIOR, $5),
                attr(Key::SQL_GRANT_ROLE_GRANTOR, $6),
            ],
        )
    }
    ;

sql_cmd_grant_stmt:
    GRANT sql_cmd_privileges ON sql_cmd_privilege_target TO sql_cmd_grantee_list sql_cmd_opt_grant_grant_option {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT,
            &[
                attr(Key::SQL_GRANT_PRIVILEGES, $2),
                attr(Key::SQL_GRANT_TARGET, $4),
                attr(Key::SQL_GRANT_GRANTEES, ctx.array(@6, $6)),
                attr(Key::SQL_GRANT_BEHAVIOR, $7),
            ],
        )
    }
    ;

sql_cmd_import_db_stmt:
    IMPORT_P sql_cmd_opt_db_locality DATABASE sql_cmd_database_name sql_cmd_opt_with sql_cmd_createdb_opt_list FROM sql_cmd_import_source_descriptor sql_cmd_opt_with sql_cmd_createdb_opt_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DATABASE_COPY,
            &[
                attr(Key::SQL_CREATE_DATABASE_COPY_DIRECTION, enum_node(@$, DatabaseCopyDirection::IMPORT)),
                attr(Key::SQL_CREATE_DATABASE_COPY_LOCALITY, $2),
                attr(Key::SQL_CREATE_DATABASE_COPY_TARGET, $4),
                attr(Key::SQL_CREATE_DATABASE_COPY_OPTIONS, ctx.array(@6, $6)),
                attr(Key::SQL_CREATE_DATABASE_COPY_SOURCE, $8),
                attr(Key::SQL_CREATE_DATABASE_COPY_SOURCE_OPTIONS, ctx.array(@10, $10)),
            ],
        )
    }
    | IMPORT_P sql_cmd_opt_db_locality DATABASE IF_P NOT EXISTS sql_cmd_database_name sql_cmd_opt_with sql_cmd_createdb_opt_list FROM sql_cmd_import_source_descriptor sql_cmd_opt_with sql_cmd_createdb_opt_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DATABASE_COPY,
            &[
                attr(Key::SQL_CREATE_DATABASE_COPY_DIRECTION, enum_node(@$, DatabaseCopyDirection::IMPORT)),
                attr(Key::SQL_CREATE_DATABASE_COPY_IF_NOT_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_CREATE_DATABASE_COPY_LOCALITY, $2),
                attr(Key::SQL_CREATE_DATABASE_COPY_TARGET, $7),
                attr(Key::SQL_CREATE_DATABASE_COPY_OPTIONS, ctx.array(@9, $9)),
                attr(Key::SQL_CREATE_DATABASE_COPY_SOURCE, $11),
                attr(Key::SQL_CREATE_DATABASE_COPY_SOURCE_OPTIONS, ctx.array(@13, $13)),
            ],
        )
    }
    ;

sql_cmd_merge_stmt:
    sql_optional_with_clause MERGE INTO sql_cmd_relation_expr_opt_alias USING sql_table_ref ON sql_expression_node sql_cmd_merge_when_list sql_insert_returning_clause {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_MERGE,
            ctx.concat2(
                $1,
                &[
                    attr(Key::SQL_MERGE_TARGET, $4),
                    attr(Key::SQL_MERGE_SOURCE, $6),
                    attr(Key::SQL_MERGE_CONDITION, $8),
                    attr(Key::SQL_MERGE_CLAUSES, ctx.array(@9, $9)),
                    attr(Key::SQL_MERGE_RETURNING, $10),
                ],
            ),
        )
    }
    ;

sql_cmd_numeric_only_list:
    sql_numeric_only { ctx.list(&[$1]) }
    | sql_cmd_numeric_only_list COMMA sql_numeric_only { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_opt_role_list:
    sql_cmd_opt_role_list sql_cmd_create_opt_role_elem { ctx.push_back($1,$2); $1 }
    | %empty { ctx.list(NO_NODES) }
    ;

sql_cmd_prepare_stmt:
    PREPARE sql_name sql_cmd_prep_type_clause AS sql_preparable_stmt {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_PREPARE,
            &[
                attr(Key::SQL_PREPARE_NAME, $2),
                attr(Key::SQL_PREPARE_PARAMETER_TYPES, ctx.array(@3, $3)),
                attr(Key::SQL_PREPARE_STATEMENT, $5),
            ],
        )
    }
    ;

sql_cmd_rename_stmt:
    ALTER AGGREGATE sql_func_name sql_cmd_aggr_args RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::AGGREGATE)),
                attr(Key::SQL_RENAME_OBJECT_NAME, ctx.array(@3, $3)),
                attr(Key::SQL_RENAME_OBJECT_ARG, $4),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $7),
            ],
        )
    }
    | ALTER COLLATION sql_any_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::COLLATION)),
                attr(Key::SQL_RENAME_OBJECT_NAME, ctx.array(@3, $3)),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $6),
            ],
        )
    }
    | ALTER CONVERSION_P sql_any_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::CONVERSION)),
                attr(Key::SQL_RENAME_OBJECT_NAME, ctx.array(@3, $3)),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $6),
            ],
        )
    }
    | ALTER sql_cmd_opt_db_locality DATABASE sql_cmd_database_name RENAME TO sql_cmd_database_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::DATABASE)),
                attr(Key::SQL_RENAME_OBJECT_LOCALITY, $2),
                attr(Key::SQL_RENAME_OBJECT_NAME, $4),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $7),
            ],
        )
    }
    | ALTER DOMAIN_P sql_any_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::DOMAIN)),
                attr(Key::SQL_RENAME_OBJECT_NAME, ctx.array(@3, $3)),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $6),
            ],
        )
    }
    | ALTER DOMAIN_P sql_any_name RENAME CONSTRAINT sql_name TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::DOMAIN_CONSTRAINT)),
                attr(Key::SQL_RENAME_OBJECT_NAME, ctx.array(@3, $3)),
                attr(Key::SQL_RENAME_OBJECT_ARG, $6),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $8),
            ],
        )
    }
    | ALTER FOREIGN DATA_P WRAPPER sql_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::FOREIGN_DATA_WRAPPER)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $5),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $8),
            ],
        )
    }
    | ALTER FUNCTION sql_cmd_function_with_argtypes RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::FUNCTION)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $3),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $6),
            ],
        )
    }
    | ALTER GROUP_P sql_qualified_name RENAME TO sql_cmd_role_id {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::ROLE)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $3),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $6),
            ],
        )
    }
    | ALTER sql_cmd_opt_procedural LANGUAGE sql_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::LANGUAGE)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $4),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $7),
            ],
        )
    }
    | ALTER OPERATOR CLASS sql_any_name USING sql_cmd_access_method RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::OPERATOR_CLASS)),
                attr(Key::SQL_RENAME_OBJECT_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_RENAME_OBJECT_ARG, $6),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $9),
            ],
        )
    }
    | ALTER OPERATOR FAMILY sql_any_name USING sql_cmd_access_method RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::OPERATOR_FAMILY)),
                attr(Key::SQL_RENAME_OBJECT_NAME, ctx.array(@4, $4)),
                attr(Key::SQL_RENAME_OBJECT_ARG, $6),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $9),
            ],
        )
    }
    | ALTER POLICY sql_name ON sql_qualified_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::POLICY)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $3),
                attr(Key::SQL_RENAME_OBJECT_ARG, $5),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $8),
            ],
        )
    }
    | ALTER POLICY IF_P EXISTS sql_name ON sql_qualified_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::POLICY)),
                attr(Key::SQL_RENAME_OBJECT_IF_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $5),
                attr(Key::SQL_RENAME_OBJECT_ARG, $7),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $10),
            ],
        )
    }
    | ALTER SERVER sql_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::SERVER)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $3),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $6),
            ],
        )
    }
    | ALTER SEQUENCE sql_qualified_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::SEQUENCE)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $3),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $6),
            ],
        )
    }
    | ALTER SEQUENCE IF_P EXISTS sql_qualified_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::SEQUENCE)),
                attr(Key::SQL_RENAME_OBJECT_IF_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $5),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $8),
            ],
        )
    }
    | ALTER MATERIALIZED VIEW sql_qualified_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::MATERIALIZED_VIEW)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $4),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $7),
            ],
        )
    }
    | ALTER MATERIALIZED VIEW IF_P EXISTS sql_qualified_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::MATERIALIZED_VIEW)),
                attr(Key::SQL_RENAME_OBJECT_IF_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $6),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $9),
            ],
        )
    }
    | ALTER INDEX sql_qualified_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::INDEX)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $3),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $6),
            ],
        )
    }
    | ALTER INDEX IF_P EXISTS sql_qualified_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::INDEX)),
                attr(Key::SQL_RENAME_OBJECT_IF_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $5),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $8),
            ],
        )
    }
    | ALTER FOREIGN TABLE sql_relation_expr RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::FOREIGN_TABLE)),
                attr(
                    Key::SQL_RENAME_OBJECT_NAME,
                    ctx.object(@4, NodeType::OBJECT_SQL_TABLEREF, $4),
                ),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $7),
            ],
        )
    }
    | ALTER FOREIGN TABLE IF_P EXISTS sql_relation_expr RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::FOREIGN_TABLE)),
                attr(Key::SQL_RENAME_OBJECT_IF_EXISTS, bool_node(@$, true)),
                attr(
                    Key::SQL_RENAME_OBJECT_NAME,
                    ctx.object(@6, NodeType::OBJECT_SQL_TABLEREF, $6),
                ),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $9),
            ],
        )
    }
    | ALTER MATERIALIZED VIEW sql_qualified_name RENAME sql_cmd_opt_column sql_name TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::MATERIALIZED_VIEW_COLUMN)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $7),
                attr(Key::SQL_RENAME_OBJECT_ARG, $4),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $9),
            ],
        )
    }
    | ALTER MATERIALIZED VIEW IF_P EXISTS sql_qualified_name RENAME sql_cmd_opt_column sql_name TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::MATERIALIZED_VIEW_COLUMN)),
                attr(Key::SQL_RENAME_OBJECT_IF_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $9),
                attr(Key::SQL_RENAME_OBJECT_ARG, $6),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $11),
            ],
        )
    }
    | ALTER FOREIGN TABLE sql_relation_expr RENAME sql_cmd_opt_column sql_name TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::FOREIGN_TABLE_COLUMN)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $7),
                attr(
                    Key::SQL_RENAME_OBJECT_ARG,
                    ctx.object(@4, NodeType::OBJECT_SQL_TABLEREF, $4),
                ),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $9),
            ],
        )
    }
    | ALTER FOREIGN TABLE IF_P EXISTS sql_relation_expr RENAME sql_cmd_opt_column sql_name TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::FOREIGN_TABLE_COLUMN)),
                attr(Key::SQL_RENAME_OBJECT_IF_EXISTS, bool_node(@$, true)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $9),
                attr(
                    Key::SQL_RENAME_OBJECT_ARG,
                    ctx.object(@6, NodeType::OBJECT_SQL_TABLEREF, $6),
                ),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $11),
            ],
        )
    }
    | ALTER RULE sql_name ON sql_qualified_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::RULE)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $3),
                attr(Key::SQL_RENAME_OBJECT_ARG, $5),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $8),
            ],
        )
    }
    | ALTER TRIGGER sql_name ON sql_qualified_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::TRIGGER)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $3),
                attr(Key::SQL_RENAME_OBJECT_ARG, $5),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $8),
            ],
        )
    }
    | ALTER EVENT TRIGGER sql_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::EVENT_TRIGGER)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $4),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $7),
            ],
        )
    }
    | ALTER ROLE sql_qualified_name RENAME TO sql_cmd_role_id {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::ROLE)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $3),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $6),
            ],
        )
    }
    | ALTER USER sql_qualified_name RENAME TO sql_cmd_role_id {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::ROLE)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $3),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $6),
            ],
        )
    }
    | ALTER TABLESPACE sql_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::TABLESPACE)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $3),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $6),
            ],
        )
    }
    | ALTER TEXT_P SEARCH PARSER sql_any_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::TEXT_SEARCH_PARSER)),
                attr(Key::SQL_RENAME_OBJECT_NAME, ctx.array(@5, $5)),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $8),
            ],
        )
    }
    | ALTER TEXT_P SEARCH DICTIONARY sql_any_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::TEXT_SEARCH_DICTIONARY)),
                attr(Key::SQL_RENAME_OBJECT_NAME, ctx.array(@5, $5)),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $8),
            ],
        )
    }
    | ALTER TEXT_P SEARCH TEMPLATE sql_any_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::TEXT_SEARCH_TEMPLATE)),
                attr(Key::SQL_RENAME_OBJECT_NAME, ctx.array(@5, $5)),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $8),
            ],
        )
    }
    | ALTER TEXT_P SEARCH CONFIGURATION sql_any_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::TEXT_SEARCH_CONFIGURATION)),
                attr(Key::SQL_RENAME_OBJECT_NAME, ctx.array(@5, $5)),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $8),
            ],
        )
    }
    | ALTER TYPE_P sql_any_name RENAME TO sql_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::TYPE)),
                attr(Key::SQL_RENAME_OBJECT_NAME, ctx.array(@3, $3)),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $6),
            ],
        )
    }
    | ALTER TYPE_P sql_any_name RENAME ATTRIBUTE sql_name TO sql_name sql_cmd_opt_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RENAME_OBJECT,
            &[
                attr(Key::SQL_RENAME_OBJECT_KIND, enum_node(@$, RenameObjectType::TYPE_ATTRIBUTE)),
                attr(Key::SQL_RENAME_OBJECT_NAME, $6),
                attr(Key::SQL_RENAME_OBJECT_ARG, ctx.array(@3, $3)),
                attr(Key::SQL_RENAME_OBJECT_NEW_NAME, $8),
                attr(Key::SQL_RENAME_OBJECT_BEHAVIOR, $9),
            ],
        )
    }
    ;

sql_cmd_revoke_role_stmt:
    REVOKE sql_cmd_privilege_list FROM sql_qualified_name_list sql_cmd_opt_granted_by sql_cmd_opt_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_REVOKE_ROLE,
            &[
                attr(Key::SQL_REVOKE_ROLE_ROLES, ctx.array(@2, $2)),
                attr(Key::SQL_REVOKE_ROLE_GRANTEES, ctx.array(@4, $4)),
                attr(Key::SQL_REVOKE_ROLE_BEHAVIOR, $6),
                attr(Key::SQL_REVOKE_ROLE_GRANTOR, $5),
            ],
        )
    }
    | REVOKE ADMIN OPTION FOR sql_cmd_privilege_list FROM sql_qualified_name_list sql_cmd_opt_granted_by sql_cmd_opt_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_REVOKE_ROLE,
            &[
                attr(Key::SQL_REVOKE_ROLE_ADMIN_OPTION, bool_node(@$, true)),
                attr(Key::SQL_REVOKE_ROLE_ROLES, ctx.array(@5, $5)),
                attr(Key::SQL_REVOKE_ROLE_GRANTEES, ctx.array(@7, $7)),
                attr(Key::SQL_REVOKE_ROLE_BEHAVIOR, $9),
                attr(Key::SQL_REVOKE_ROLE_GRANTOR, $8),
            ],
        )
    }
    ;

sql_cmd_revoke_stmt:
    REVOKE sql_cmd_privileges ON sql_cmd_privilege_target FROM sql_cmd_grantee_list sql_cmd_opt_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_REVOKE,
            &[
                attr(Key::SQL_REVOKE_PRIVILEGES, $2),
                attr(Key::SQL_REVOKE_TARGET, $4),
                attr(Key::SQL_REVOKE_GRANTEES, ctx.array(@6, $6)),
                attr(Key::SQL_REVOKE_BEHAVIOR, $7),
            ],
        )
    }
    | REVOKE GRANT OPTION FOR sql_cmd_privileges ON sql_cmd_privilege_target FROM sql_cmd_grantee_list sql_cmd_opt_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_REVOKE,
            &[
                attr(Key::SQL_REVOKE_GRANT_OPTION, bool_node(@$, true)),
                attr(Key::SQL_REVOKE_PRIVILEGES, $5),
                attr(Key::SQL_REVOKE_TARGET, $7),
                attr(Key::SQL_REVOKE_GRANTEES, ctx.array(@9, $9)),
                attr(Key::SQL_REVOKE_BEHAVIOR, $10),
            ],
        )
    }
    ;

sql_cmd_role_id:
    sql_nonreserved_word { $1 }
    ;

sql_cmd_sequence_option_item:
    AS sql_numeric {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEQUENCE_OPTION,
            &[
                attr(Key::SQL_SEQUENCE_OPTION_KIND, enum_node(@$, SequenceOption::AS)),
                attr(Key::SQL_SEQUENCE_OPTION_VALUE, $2),
            ],
        )
    }
    | INCREMENT sql_signed_iconst {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEQUENCE_OPTION,
            &[
                attr(Key::SQL_SEQUENCE_OPTION_KIND, enum_node(@$, SequenceOption::INCREMENT)),
                attr(Key::SQL_SEQUENCE_OPTION_VALUE, $2),
            ],
        )
    }
    | INCREMENT BY sql_signed_iconst {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEQUENCE_OPTION,
            &[
                attr(Key::SQL_SEQUENCE_OPTION_KIND, enum_node(@$, SequenceOption::INCREMENT)),
                attr(Key::SQL_SEQUENCE_OPTION_VALUE, $3),
            ],
        )
    }
    | MINVALUE sql_signed_iconst {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEQUENCE_OPTION,
            &[
                attr(Key::SQL_SEQUENCE_OPTION_KIND, enum_node(@$, SequenceOption::MIN_VALUE)),
                attr(Key::SQL_SEQUENCE_OPTION_VALUE, $2),
            ],
        )
    }
    | NO MINVALUE {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEQUENCE_OPTION,
            &[
                attr(Key::SQL_SEQUENCE_OPTION_KIND, enum_node(@$, SequenceOption::MIN_VALUE)),
                attr(Key::SQL_SEQUENCE_OPTION_NO, bool_node(@$, true)),
            ],
        )
    }
    | MAXVALUE sql_signed_iconst {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEQUENCE_OPTION,
            &[
                attr(Key::SQL_SEQUENCE_OPTION_KIND, enum_node(@$, SequenceOption::MAX_VALUE)),
                attr(Key::SQL_SEQUENCE_OPTION_VALUE, $2),
            ],
        )
    }
    | NO MAXVALUE {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEQUENCE_OPTION,
            &[
                attr(Key::SQL_SEQUENCE_OPTION_KIND, enum_node(@$, SequenceOption::MAX_VALUE)),
                attr(Key::SQL_SEQUENCE_OPTION_NO, bool_node(@$, true)),
            ],
        )
    }
    | START sql_signed_iconst {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEQUENCE_OPTION,
            &[
                attr(Key::SQL_SEQUENCE_OPTION_KIND, enum_node(@$, SequenceOption::START)),
                attr(Key::SQL_SEQUENCE_OPTION_VALUE, $2),
            ],
        )
    }
    | START WITH sql_signed_iconst {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEQUENCE_OPTION,
            &[
                attr(Key::SQL_SEQUENCE_OPTION_KIND, enum_node(@$, SequenceOption::START)),
                attr(Key::SQL_SEQUENCE_OPTION_VALUE, $3),
            ],
        )
    }
    | RESTART sql_signed_iconst {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEQUENCE_OPTION,
            &[
                attr(Key::SQL_SEQUENCE_OPTION_KIND, enum_node(@$, SequenceOption::RESTART)),
                attr(Key::SQL_SEQUENCE_OPTION_VALUE, $2),
            ],
        )
    }
    | RESTART WITH sql_signed_iconst {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEQUENCE_OPTION,
            &[
                attr(Key::SQL_SEQUENCE_OPTION_KIND, enum_node(@$, SequenceOption::RESTART)),
                attr(Key::SQL_SEQUENCE_OPTION_VALUE, $3),
            ],
        )
    }
    | RESTART {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEQUENCE_OPTION,
            &[attr(Key::SQL_SEQUENCE_OPTION_KIND, enum_node(@$, SequenceOption::RESTART))],
        )
    }
    | CACHE sql_signed_iconst {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEQUENCE_OPTION,
            &[
                attr(Key::SQL_SEQUENCE_OPTION_KIND, enum_node(@$, SequenceOption::CACHE)),
                attr(Key::SQL_SEQUENCE_OPTION_VALUE, $2),
            ],
        )
    }
    | CYCLE {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEQUENCE_OPTION,
            &[attr(Key::SQL_SEQUENCE_OPTION_KIND, enum_node(@$, SequenceOption::CYCLE))],
        )
    }
    | NO CYCLE {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEQUENCE_OPTION,
            &[
                attr(Key::SQL_SEQUENCE_OPTION_KIND, enum_node(@$, SequenceOption::CYCLE)),
                attr(Key::SQL_SEQUENCE_OPTION_NO, bool_node(@$, true)),
            ],
        )
    }
    | OWNED BY sql_columnref {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEQUENCE_OPTION,
            &[
                attr(Key::SQL_SEQUENCE_OPTION_KIND, enum_node(@$, SequenceOption::OWNED_BY)),
                attr(Key::SQL_SEQUENCE_OPTION_VALUE, $3),
            ],
        )
    }
    ;

sql_cmd_sequence_option_list:
    sql_cmd_sequence_option_item { ctx.list(&[$1]) }
    | sql_cmd_sequence_option_list sql_cmd_sequence_option_item { ctx.push_back($1,$2); $1 }
    ;

sql_cmd_set_reset_clause:
    SET sql_cmd_set_rest { ctx.set(@$, $2) }
    | sql_cmd_variable_reset_stmt { $1 }
    ;

sql_cmd_stream_type:
    BOUNDED EXTERNAL STREAM { enum_node(@$, StreamType::BOUNDED) }
    | BUFFERED EXTERNAL STREAM { enum_node(@$, StreamType::BUFFERED) }
    | EXTERNAL STREAM { null() }
    ;

sql_cmd_truncate_stmt:
    TRUNCATE sql_cmd_opt_table sql_cmd_relation_expr_list sql_cmd_opt_restart_seqs sql_cmd_opt_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_TRUNCATE,
            &[
                attr(Key::SQL_TRUNCATE_RELATIONS, ctx.array(@3, $3)),
                attr(Key::SQL_TRUNCATE_RESTARTSEQS, $4),
                attr(Key::SQL_TRUNCATE_BEHAVIOR, $5),
            ],
        )
    }
    ;

sql_cmd_unload_db_stmt:
    UNLOAD sql_cmd_opt_db_locality DATABASE sql_cmd_database_name sql_cmd_opt_unload_defragment {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_UNLOAD_DATABASE,
            &[
                attr(Key::SQL_UNLOAD_DATABASE_LOCALITY, $2),
                attr(Key::SQL_UNLOAD_DATABASE_NAME, $4),
                attr(Key::SQL_UNLOAD_DATABASE_DEFRAGMENT, $5),
            ],
        )
    }
    | UNLOAD sql_cmd_opt_db_locality DATABASE sql_cmd_database_name FORCEFULLY sql_cmd_opt_unload_defragment {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_UNLOAD_DATABASE,
            &[
                attr(Key::SQL_UNLOAD_DATABASE_FORCEFULLY, bool_node(@$, true)),
                attr(Key::SQL_UNLOAD_DATABASE_LOCALITY, $2),
                attr(Key::SQL_UNLOAD_DATABASE_NAME, $4),
                attr(Key::SQL_UNLOAD_DATABASE_DEFRAGMENT, $6),
            ],
        )
    }
    | UNLOAD sql_cmd_opt_db_locality DATABASE sql_cmd_database_name GRACEFULLY sql_cmd_opt_unload_defragment {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_UNLOAD_DATABASE,
            &[
                attr(Key::SQL_UNLOAD_DATABASE_FORCEFULLY, bool_node(@$, false)),
                attr(Key::SQL_UNLOAD_DATABASE_LOCALITY, $2),
                attr(Key::SQL_UNLOAD_DATABASE_NAME, $4),
                attr(Key::SQL_UNLOAD_DATABASE_DEFRAGMENT, $6),
            ],
        )
    }
    ;

sql_cmd_unload_release_stmt:
    UNLOAD RELEASE { ctx.object_ex(@$,NodeType::OBJECT_SQL_UNLOAD_RELEASE,NO_NODES,false,false) }
    ;

sql_cmd_update_stmt:
    sql_optional_with_clause UPDATE sql_cmd_relation_expr_opt_alias SET sql_cmd_set_clause_list sql_cmd_where_or_current_clause sql_insert_returning_clause {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_UPDATE,
            ctx.concat2(
                $1,
                &[
                    attr(Key::SQL_UPDATE_TARGET, $3),
                    attr(Key::SQL_UPDATE_ASSIGNMENTS, ctx.array(@5, $5)),
                    attr(Key::SQL_UPDATE_WHERE, $6),
                    attr(Key::SQL_UPDATE_RETURNING, $7),
                ],
            ),
        )
    }
    | sql_optional_with_clause UPDATE sql_cmd_relation_expr_opt_alias SET sql_cmd_set_clause_list FROM sql_from_list sql_cmd_where_or_current_clause sql_insert_returning_clause {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_UPDATE,
            ctx.concat2(
                $1,
                &[
                    attr(Key::SQL_UPDATE_TARGET, $3),
                    attr(Key::SQL_UPDATE_ASSIGNMENTS, ctx.array(@5, $5)),
                    attr(Key::SQL_UPDATE_FROM, ctx.array(@7, $7)),
                    attr(Key::SQL_UPDATE_WHERE, $8),
                    attr(Key::SQL_UPDATE_RETURNING, $9),
                ],
            ),
        )
    }
    ;

sql_cmd_validate_stmt:
    VALIDATE sql_cmd_opt_db_locality DATABASE sql_cmd_database_name sql_cmd_opt_attach_database_options {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_VALIDATE_DATABASE,
            &[
                attr(Key::SQL_VALIDATE_DATABASE_LOCALITY, $2),
                attr(Key::SQL_VALIDATE_DATABASE_ALIAS, $4),
                attr(Key::SQL_VALIDATE_DATABASE_OPTIONS, ctx.array(@5, $5)),
            ],
        )
    }
    ;

sql_cmd_variable_reset_stmt:
    RESET sql_cmd_reset_rest { ctx.object(@$,NodeType::OBJECT_SQL_RESET,&[attr(Key::SQL_RESET_ARG,$2)]) }
    ;

sql_cmd_variable_show_stmt:
    SHOW sql_config_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SHOW,
            &[
                attr(Key::SQL_SHOW_ARG, ctx.array(@2, $2)),
            ],
        )
    }
    | SHOW TIME ZONE { ctx.object(@$,NodeType::OBJECT_SQL_SHOW,&[attr(Key::SQL_SHOW_PARAMETER, enum_node(@$, SessionParameter::TIME_ZONE))]) }
    | SHOW TRANSACTION ISOLATION LEVEL {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SHOW,
            &[attr(Key::SQL_SHOW_PARAMETER, enum_node(@$, SessionParameter::TRANSACTION_ISOLATION))],
        )
    }
    | SHOW SESSION AUTHORIZATION {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SHOW,
            &[attr(Key::SQL_SHOW_PARAMETER, enum_node(@$, SessionParameter::SESSION_AUTHORIZATION))],
        )
    }
    | SHOW ALL { ctx.object(@$,NodeType::OBJECT_SQL_SHOW,&[attr(Key::SQL_SHOW_PARAMETER, enum_node(@$, SessionParameter::ALL))]) }
    ;

sql_cmd_access_method:
    sql_col_id { $1 }
    ;

sql_cmd_access_method_clause:
    USING sql_cmd_access_method { $2 }
    | %empty { null() }
    ;

sql_cmd_aggr_arg:
    sql_cmd_func_arg { $1 }
    ;

sql_cmd_aggr_args:
sql_aggregate_signature { ctx.object(@$,NodeType::OBJECT_SQL_AGGREGATION_ARGUMENTS,$1) }
    ;
sql_cmd_aggr_args_list:
    sql_cmd_aggr_arg { ctx.list(&[$1]) }
    | sql_cmd_aggr_args_list COMMA sql_cmd_aggr_arg { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_analyze:
    ANALYZE { null() }
    | ANALYSE { null() }
    ;

sql_cmd_any_name_list:
    sql_any_name { ctx.list(&[ctx.array(@1,$1)]) }
    | sql_cmd_any_name_list COMMA sql_any_name { ctx.push_back($1,ctx.array(@3,$3)); $1 }
    ;

sql_cmd_arg_class:
    IN_P { null() }
    | OUT_P { enum_node(@$, FunctionParameterMode::OUT) }
    | INOUT { enum_node(@$, FunctionParameterMode::INOUT) }
    | IN_P OUT_P { enum_node(@$, FunctionParameterMode::INOUT) }
    | VARIADIC { enum_node(@$, FunctionParameterMode::VARIADIC) }
    | CONST { enum_node(@$, FunctionParameterMode::CONST) }
    | CONSTREF { enum_node(@$, FunctionParameterMode::CONSTREF) }
    ;

sql_cmd_array_external_location_descriptor_list:
    sql_cmd_nestable_external_location_descriptor { ctx.list(&[$1]) }
    | sql_cmd_array_external_location_descriptor_list COMMA sql_cmd_nestable_external_location_descriptor { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_attachdb_opt_item:
    sql_word_or_string EQUALS sql_word_or_string {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GENERIC_OPTION,
            &[attr(Key::SQL_GENERIC_OPTION_NAME, $1), attr(Key::SQL_GENERIC_OPTION_VALUE, $3)],
        )
    }
    | sql_word_or_string EQUALS DEFAULT { ctx.object(@$,NodeType::OBJECT_SQL_GENERIC_OPTION,&[attr(Key::SQL_GENERIC_OPTION_NAME,$1)]) }
    ;

sql_cmd_attachdb_opt_items:
    sql_cmd_attachdb_opt_item { ctx.list(&[$1]) }
    | sql_cmd_attachdb_opt_items COMMA sql_cmd_attachdb_opt_item { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_comment_text:
    sql_string_literal { $1 }
    | NULL_P { null() }
    ;

sql_cmd_common_func_opt_item:
    CALLED ON NULL_P INPUT_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::CALLED_ON_NULL_INPUT))],
        )
    }
    | RETURNS NULL_P ON NULL_P INPUT_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::STRICT))],
        )
    }
    | STRICT_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::STRICT))],
        )
    }
    | IMMUTABLE {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::IMMUTABLE))],
        )
    }
    | STABLE {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::STABLE))],
        )
    }
    | VOLATILE {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::VOLATILE))],
        )
    }
    | EXTERNAL SECURITY DEFINER {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::SECURITY_DEFINER))],
        )
    }
    | EXTERNAL SECURITY INVOKER {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::SECURITY_INVOKER))],
        )
    }
    | SECURITY DEFINER {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::SECURITY_DEFINER))],
        )
    }
    | SECURITY INVOKER {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::SECURITY_INVOKER))],
        )
    }
    | LEAKPROOF {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::LEAKPROOF))],
        )
    }
    | NOT LEAKPROOF {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::NOT_LEAKPROOF))],
        )
    }
    | COST sql_numeric_only {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[
                attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::COST)),
                attr(Key::SQL_CREATE_FUNCTION_OPTION_VALUE, $2),
            ],
        )
    }
    | ROWS sql_numeric_only {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[
                attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::ROWS)),
                attr(Key::SQL_CREATE_FUNCTION_OPTION_VALUE, $2),
            ],
        )
    }
    | sql_cmd_function_set_reset_clause {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[
                attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::SET)),
                attr(Key::SQL_CREATE_FUNCTION_OPTION_VALUE, $1),
            ],
        )
    }
    ;

sql_cmd_copy_delimiter:
    sql_cmd_opt_using DELIMITERS sql_string_literal {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY_OPTION,
            &[
                attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::DELIMITER)),
                attr(Key::SQL_COPY_OPTION_VALUE, $3),
            ],
        )
    }
    | %empty { null() }
    ;

sql_cmd_copy_generic_opt_arg:
    sql_setting_value { $1 }
    | sql_numeric_only { $1 }
    | STAR { operator_node(@1) }
    | LRB sql_cmd_copy_generic_opt_arg_list RRB { ctx.array(@$, $2) }
    | %empty { null() }
    ;

sql_cmd_copy_generic_opt_arg_list:
    sql_cmd_copy_generic_opt_arg_list_item { ctx.list(&[$1]) }
    | sql_cmd_copy_generic_opt_arg_list COMMA sql_cmd_copy_generic_opt_arg_list_item { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_copy_generic_opt_arg_list_item:
    sql_setting_value { $1 }
    ;

sql_cmd_copy_generic_opt_list:
    sql_cmd_postgres_copy_generic_opt_list { $1 }
    | sql_cmd_copy_named_opt_list { $1 }
    ;

sql_cmd_copy_opt_item:
    BINARY {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY_OPTION,
            &[attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::BINARY))],
        )
    }
    | OIDS { ctx.object(@$,NodeType::OBJECT_SQL_COPY_OPTION,&[attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::OIDS))]) }
    | FREEZE {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY_OPTION,
            &[attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::FREEZE))],
        )
    }
    | DELIMITER sql_cmd_opt_as sql_string_literal {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY_OPTION,
            &[
                attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::DELIMITER)),
                attr(Key::SQL_COPY_OPTION_VALUE, $3),
            ],
        )
    }
    | NULL_P sql_cmd_opt_as sql_string_literal {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY_OPTION,
            &[
                attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::NULL_)),
                attr(Key::SQL_COPY_OPTION_VALUE, $3),
            ],
        )
    }
    | CSV { ctx.object(@$,NodeType::OBJECT_SQL_COPY_OPTION,&[attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::CSV))]) }
    | HEADER_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY_OPTION,
            &[attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::HEADER))],
        )
    }
    | QUOTE sql_cmd_opt_as sql_string_literal {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY_OPTION,
            &[
                attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::QUOTE)),
                attr(Key::SQL_COPY_OPTION_VALUE, $3),
            ],
        )
    }
    | ESCAPE sql_cmd_opt_as sql_string_literal {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY_OPTION,
            &[
                attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::ESCAPE)),
                attr(Key::SQL_COPY_OPTION_VALUE, $3),
            ],
        )
    }
    | FORCE QUOTE sql_column_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY_OPTION,
            &[
                attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::FORCE_QUOTE)),
                attr(Key::SQL_COPY_OPTION_VALUE, ctx.array(@3, $3)),
            ],
        )
    }
    | FORCE QUOTE STAR {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY_OPTION,
            &[attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::FORCE_QUOTE))],
        )
    }
    | FORCE NOT NULL_P sql_column_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY_OPTION,
            &[
                attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::FORCE_NOT_NULL)),
                attr(Key::SQL_COPY_OPTION_VALUE, ctx.array(@4, $4)),
            ],
        )
    }
    | FORCE NULL_P sql_column_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY_OPTION,
            &[
                attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::FORCE_NULL)),
                attr(Key::SQL_COPY_OPTION_VALUE, ctx.array(@3, $3)),
            ],
        )
    }
    | ENCODING sql_string_literal {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY_OPTION,
            &[
                attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::ENCODING)),
                attr(Key::SQL_COPY_OPTION_VALUE, $2),
            ],
        )
    }
    | SANITIZE {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY_OPTION,
            &[attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::SANITIZE))],
        )
    }
    ;

sql_cmd_copy_opt_list:
    sql_cmd_copy_opt_list sql_cmd_copy_opt_item { ctx.push_back($1,$2); $1 }
    | %empty { ctx.list(NO_NODES) }
    ;

sql_cmd_copy_options:
    sql_cmd_copy_opt_list { $1 }
    | LRB sql_cmd_copy_generic_opt_list RRB { $2 }
    ;

sql_cmd_copy_source_descriptor:
    sql_cmd_source_descriptor { $1 }
    | STDIN { null() }
    ;

sql_cmd_copy_target_descriptor:
    sql_cmd_nestable_external_location_descriptor { $1 }
    | STDOUT { ctx.object_ex(@$,NodeType::OBJECT_SQL_STDOUT_TARGET_DESCRIPTOR,NO_NODES,false,false) }
    | NULL_P { ctx.object_ex(@$,NodeType::OBJECT_SQL_NULL_TARGET_DESCRIPTOR,NO_NODES,false,false) }
    ;

sql_cmd_createdb_opt_item:
    sql_cmd_createdb_opt_name sql_cmd_opt_equal sql_signed_iconst {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GENERIC_OPTION,
            &[attr(Key::SQL_GENERIC_OPTION_NAME, $1), attr(Key::SQL_GENERIC_OPTION_VALUE, $3)],
        )
    }
    | sql_cmd_createdb_opt_name sql_cmd_opt_equal sql_setting_value {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GENERIC_OPTION,
            &[attr(Key::SQL_GENERIC_OPTION_NAME, $1), attr(Key::SQL_GENERIC_OPTION_VALUE, $3)],
        )
    }
    ;

sql_cmd_createdb_opt_items:
    sql_cmd_createdb_opt_item { ctx.list(&[$1]) }
    | sql_cmd_createdb_opt_items sql_cmd_createdb_opt_item { ctx.push_back($1,$2); $1 }
    ;

sql_cmd_createdb_opt_list:
    sql_cmd_createdb_opt_items { $1 }
    | %empty { ctx.list(NO_NODES) }
    ;

sql_cmd_createdb_opt_name:
    IDENT {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DATABASE_OPTION,
            &[
                attr(Key::SQL_CREATE_DATABASE_OPTION_NAME, name_from_identifier(@1, $1)),
            ],
        )
    }
    | VERSION_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DATABASE_OPTION,
            &[
                attr(Key::SQL_CREATE_DATABASE_OPTION_NAME, ctx.name_from_keyword(@1, $1)),
            ],
        )
    }
    | CONNECTION LIMIT {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DATABASE_OPTION,
            &[attr(Key::SQL_CREATE_DATABASE_OPTION_KIND, enum_node(@$, DatabaseOption::CONNECTION_LIMIT))],
        )
    }
    | ENCODING {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DATABASE_OPTION,
            &[attr(Key::SQL_CREATE_DATABASE_OPTION_KIND, enum_node(@$, DatabaseOption::ENCODING))],
        )
    }
    | LOCATION {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DATABASE_OPTION,
            &[attr(Key::SQL_CREATE_DATABASE_OPTION_KIND, enum_node(@$, DatabaseOption::LOCATION))],
        )
    }
    | OWNER {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DATABASE_OPTION,
            &[attr(Key::SQL_CREATE_DATABASE_OPTION_KIND, enum_node(@$, DatabaseOption::OWNER))],
        )
    }
    | TABLESPACE {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DATABASE_OPTION,
            &[attr(Key::SQL_CREATE_DATABASE_OPTION_KIND, enum_node(@$, DatabaseOption::TABLESPACE))],
        )
    }
    | TEMPLATE {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_DATABASE_OPTION,
            &[attr(Key::SQL_CREATE_DATABASE_OPTION_KIND, enum_node(@$, DatabaseOption::TEMPLATE))],
        )
    }
    ;

sql_cmd_createfunc_opt_item:
    AS sql_cmd_func_as {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[
                attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::AS)),
                attr(Key::SQL_CREATE_FUNCTION_OPTION_VALUE, ctx.array(@2, $2)),
            ],
        )
    }
    | LANGUAGE sql_word_or_string {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[
                attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::LANGUAGE)),
                attr(Key::SQL_CREATE_FUNCTION_OPTION_VALUE, $2),
            ],
        )
    }
    | WINDOW {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION_OPTION,
            &[attr(Key::SQL_CREATE_FUNCTION_OPTION_KIND, enum_node(@$, FunctionOption::WINDOW))],
        )
    }
    | sql_cmd_common_func_opt_item { $1 }
    ;

sql_cmd_createfunc_opt_list:
sql_cmd_createfunc_opt_item { ctx.list(&[$1]) }
  | sql_cmd_createfunc_opt_list sql_cmd_createfunc_opt_item { ctx.push_back($1,$2);$1 }
    ;
sql_cmd_ctext_expr:
sql_expression_node { $1 }
    ;
sql_cmd_ctext_expr_list:
    sql_cmd_ctext_expr { ctx.list(&[$1]) }
    | sql_cmd_ctext_expr_list COMMA sql_cmd_ctext_expr { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_ctext_row:
    LRB sql_cmd_ctext_expr_list RRB { $2 }
    ;

sql_cmd_cursor_name:
    sql_name { $1 }
    ;

sql_cmd_cursor_option:
    NO SCROLL { enum_node(@$, CursorOption::NO_SCROLL) }
    | SCROLL { enum_node(@$, CursorOption::SCROLL) }
    | BINARY { enum_node(@$, CursorOption::BINARY) }
    | INSENSITIVE { enum_node(@$, CursorOption::INSENSITIVE) }
    ;

sql_cmd_cursor_options:
    %empty { ctx.list(NO_NODES) }
    | sql_cmd_cursor_options sql_cmd_cursor_option { ctx.push_back($1,$2); $1 }
    ;

sql_cmd_database_name:
    sql_col_id { $1 }
    ;

sql_cmd_database_name_list:
    sql_cmd_database_name { ctx.list(&[$1]) }
    | sql_cmd_database_name_list COMMA sql_cmd_database_name { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_def_arg:
    sql_typename { $1 }
    | sql_cmd_table_column_type { $1 }
    | sql_cmd_reserved_keyword { $1 }
    | sql_qual_all_op { $1 }
    | sql_numeric_only { $1 }
    | sql_string_literal { $1 }
    ;

sql_cmd_domain_arg:
    sql_param_name COLON_EQUALS sql_cmd_domain_constant_expr {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_NAMED_ARG_EXPR,
            &[attr(Key::SQL_NAMED_ARG_EXPR_NAME, $1), attr(Key::SQL_NAMED_ARG_EXPR_VALUE, $3)],
        )
    }
    | sql_param_name EQUALS_GREATER sql_cmd_domain_constant_expr {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_NAMED_ARG_EXPR,
            &[attr(Key::SQL_NAMED_ARG_EXPR_NAME, $1), attr(Key::SQL_NAMED_ARG_EXPR_VALUE, $3)],
        )
    }
    ;

sql_cmd_domain_arg_list:
    sql_cmd_domain_arg { ctx.list(&[$1]) }
    | sql_cmd_domain_arg_list COMMA sql_cmd_domain_arg { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_domain_constant_expr:
    sql_signed_iconst { $1 }
    | TRUE_P { bool_node(@$,true) }
    | FALSE_P { bool_node(@$,false) }
    | sql_string_literal { $1 }
    ;

sql_cmd_drop_type:
    EXTERNAL STREAM { enum_node(@$, DropObjectType::EXTERNAL_STREAM) }
    | EXTERNAL TABLE { enum_node(@$, DropObjectType::EXTERNAL_TABLE) }
    | SEQUENCE { enum_node(@$, DropObjectType::SEQUENCE) }
    | MATERIALIZED VIEW { enum_node(@$, DropObjectType::MATERIALIZED_VIEW) }
    | INDEX { enum_node(@$, DropObjectType::INDEX) }
    | FOREIGN TABLE { enum_node(@$, DropObjectType::FOREIGN_TABLE) }
    | EVENT TRIGGER { enum_node(@$, DropObjectType::EVENT_TRIGGER) }
    | TYPE_P { enum_node(@$, DropObjectType::TYPE) }
    | DOMAIN_P { enum_node(@$, DropObjectType::DOMAIN) }
    | COLLATION { enum_node(@$, DropObjectType::COLLATION) }
    | CONVERSION_P { enum_node(@$, DropObjectType::CONVERSION) }
    | EXTENSION { enum_node(@$, DropObjectType::EXTENSION) }
    ;

sql_cmd_enum_val_list:
    sql_string_literal { ctx.list(&[$1]) }
    | sql_cmd_enum_val_list COMMA sql_string_literal { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_execute_arg_list:
    sql_cmd_execute_arg_list_item { ctx.list(&[$1]) }
    | sql_cmd_execute_arg_list COMMA sql_cmd_execute_arg_list_item { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_execute_arg_list_item:
    sql_expression_node { $1 }
    | sql_param_name COLON_EQUALS sql_expression_node {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_NAMED_ARG_EXPR,
            &[attr(Key::SQL_NAMED_ARG_EXPR_NAME, $1), attr(Key::SQL_NAMED_ARG_EXPR_VALUE, $3)],
        )
    }
    | sql_param_name EQUALS_GREATER sql_expression_node {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_NAMED_ARG_EXPR,
            &[attr(Key::SQL_NAMED_ARG_EXPR_NAME, $1), attr(Key::SQL_NAMED_ARG_EXPR_VALUE, $3)],
        )
    }
    ;

sql_cmd_execute_param_clause:
    LRB sql_cmd_execute_arg_list RRB { $2 }
    | %empty { ctx.list(NO_NODES) }
    ;

sql_cmd_fetch_args:
    NEXT {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FETCH_DIRECTION,
            &[attr(Key::SQL_FETCH_DIRECTION_KIND, enum_node(@$, FetchDirection::NEXT))],
        )
    }
    | PRIOR {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FETCH_DIRECTION,
            &[attr(Key::SQL_FETCH_DIRECTION_KIND, enum_node(@$, FetchDirection::PRIOR))],
        )
    }
    | FIRST_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FETCH_DIRECTION,
            &[attr(Key::SQL_FETCH_DIRECTION_KIND, enum_node(@$, FetchDirection::FIRST))],
        )
    }
    | LAST_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FETCH_DIRECTION,
            &[attr(Key::SQL_FETCH_DIRECTION_KIND, enum_node(@$, FetchDirection::LAST))],
        )
    }
    | ABSOLUTE_P sql_signed_iconst {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FETCH_DIRECTION,
            &[
                attr(Key::SQL_FETCH_DIRECTION_KIND, enum_node(@$, FetchDirection::ABSOLUTE)),
                attr(Key::SQL_FETCH_DIRECTION_COUNT, $2),
            ],
        )
    }
    | RELATIVE_P sql_signed_iconst {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FETCH_DIRECTION,
            &[
                attr(Key::SQL_FETCH_DIRECTION_KIND, enum_node(@$, FetchDirection::RELATIVE)),
                attr(Key::SQL_FETCH_DIRECTION_COUNT, $2),
            ],
        )
    }
    | sql_signed_iconst {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FETCH_DIRECTION,
            &[
                attr(Key::SQL_FETCH_DIRECTION_COUNT, $1),
            ],
        )
    }
    | ALL {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FETCH_DIRECTION,
            &[attr(Key::SQL_FETCH_DIRECTION_ALL, bool_node(@$, true))],
        )
    }
    | FORWARD {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FETCH_DIRECTION,
            &[attr(Key::SQL_FETCH_DIRECTION_KIND, enum_node(@$, FetchDirection::FORWARD))],
        )
    }
    | FORWARD sql_signed_iconst {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FETCH_DIRECTION,
            &[
                attr(Key::SQL_FETCH_DIRECTION_KIND, enum_node(@$, FetchDirection::FORWARD)),
                attr(Key::SQL_FETCH_DIRECTION_COUNT, $2),
            ],
        )
    }
    | FORWARD ALL {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FETCH_DIRECTION,
            &[
                attr(Key::SQL_FETCH_DIRECTION_KIND, enum_node(@$, FetchDirection::FORWARD)),
                attr(Key::SQL_FETCH_DIRECTION_ALL, bool_node(@$, true)),
            ],
        )
    }
    | BACKWARD {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FETCH_DIRECTION,
            &[attr(Key::SQL_FETCH_DIRECTION_KIND, enum_node(@$, FetchDirection::BACKWARD))],
        )
    }
    | BACKWARD sql_signed_iconst {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FETCH_DIRECTION,
            &[
                attr(Key::SQL_FETCH_DIRECTION_KIND, enum_node(@$, FetchDirection::BACKWARD)),
                attr(Key::SQL_FETCH_DIRECTION_COUNT, $2),
            ],
        )
    }
    | BACKWARD ALL {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FETCH_DIRECTION,
            &[
                attr(Key::SQL_FETCH_DIRECTION_KIND, enum_node(@$, FetchDirection::BACKWARD)),
                attr(Key::SQL_FETCH_DIRECTION_ALL, bool_node(@$, true)),
            ],
        )
    }
    ;

sql_function_param_fields:
    sql_cmd_arg_class sql_param_name sql_cmd_func_arg_type sql_opt_not_null {
        ctx.list(&[
            attr(Key::SQL_FUNCTION_PARAM_NAME, $2),
            attr(Key::SQL_FUNCTION_PARAM_TYPE, $3),
            attr(Key::SQL_FUNCTION_PARAM_MODE, $1),
            attr(Key::SQL_FUNCTION_PARAM_NOT_NULL, $4),
        ])
    }
    | sql_param_name sql_cmd_arg_class sql_cmd_func_arg_type sql_opt_not_null {
        ctx.list(&[
            attr(Key::SQL_FUNCTION_PARAM_NAME, $1),
            attr(Key::SQL_FUNCTION_PARAM_TYPE, $3),
            attr(Key::SQL_FUNCTION_PARAM_MODE, $2),
            attr(Key::SQL_FUNCTION_PARAM_NOT_NULL, $4),
        ])
    }
    | sql_param_name sql_cmd_func_arg_type sql_opt_not_null {
        ctx.list(&[
            attr(Key::SQL_FUNCTION_PARAM_NAME, $1),
            attr(Key::SQL_FUNCTION_PARAM_TYPE, $2),
            attr(Key::SQL_FUNCTION_PARAM_NOT_NULL, $3),
        ])
    }
    | sql_cmd_arg_class sql_cmd_func_arg_type sql_opt_not_null {
        ctx.list(&[
            attr(Key::SQL_FUNCTION_PARAM_TYPE, $2),
            attr(Key::SQL_FUNCTION_PARAM_MODE, $1),
            attr(Key::SQL_FUNCTION_PARAM_NOT_NULL, $3),
        ])
    }
    | sql_cmd_func_arg_type sql_opt_not_null { ctx.list(&[attr(Key::SQL_FUNCTION_PARAM_TYPE,$1),attr(Key::SQL_FUNCTION_PARAM_NOT_NULL,$2)]) }
    ;

sql_cmd_func_arg_type:
    sql_function_param_type { $1 }
    | sql_cmd_table_column_type { $1 }
    | SETOF sql_cmd_table_column_type {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FUNCTION_RETURN_TYPE,
            &[
                attr(Key::SQL_FUNCTION_RETURN_TYPE_SETOF, bool_node(@$, true)),
                attr(Key::SQL_FUNCTION_RETURN_TYPE_ATTRIBUTES, $2),
            ],
        )
    }
    | TABLE LRB sql_cmd_opt_table_func_column_list RRB sql_cmd_opt_table_pass_through sql_cmd_opt_table_arg_semantics {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FUNCTION_RETURN_TYPE,
            &[
                attr(Key::SQL_FUNCTION_RETURN_TYPE_ATTRIBUTES, ctx.array(@3, $3)),
                attr(Key::SQL_FUNCTION_RETURN_TYPE_TABLE_PASSTHROUGH, $5),
                attr(Key::SQL_FUNCTION_RETURN_TYPE_TABLE_SEMANTICS, $6),
            ],
        )
    }
    | TABLE sql_cmd_opt_table_pass_through sql_cmd_opt_table_arg_semantics {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FUNCTION_RETURN_TYPE,
            &[
                attr(Key::SQL_FUNCTION_RETURN_TYPE_TABLE_PASSTHROUGH, $2),
                attr(Key::SQL_FUNCTION_RETURN_TYPE_TABLE_SEMANTICS, $3),
            ],
        )
    }
    | ONLY PASS THROUGHS {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FUNCTION_RETURN_TYPE,
            &[attr(Key::SQL_FUNCTION_RETURN_TYPE_ONLY_PASS_THROUGHS, bool_node(@$, true))],
        )
    }
    ;

sql_cmd_func_arg_with_default:
sql_function_param_fields { ctx.object(@$,NodeType::OBJECT_SQL_FUNCTION_PARAM,$1) }
 | sql_function_param_fields DEFAULT sql_expression_node { ctx.push_back($1,attr(Key::SQL_FUNCTION_PARAM_DEFAULT,$3)); ctx.object(@$,NodeType::OBJECT_SQL_FUNCTION_PARAM,$1) }
 | sql_function_param_fields EQUALS sql_expression_node { ctx.push_back($1,attr(Key::SQL_FUNCTION_PARAM_DEFAULT,$3)); ctx.object(@$,NodeType::OBJECT_SQL_FUNCTION_PARAM,$1) }
    ;
sql_cmd_func_args:
    LRB sql_cmd_func_args_list RRB { $2 }
    | LRB RRB { ctx.list(NO_NODES) }
    ;

sql_cmd_func_args_list:
    sql_cmd_func_arg { ctx.list(&[$1]) }
    | sql_cmd_func_args_list COMMA sql_cmd_func_arg { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_func_args_with_defaults:
    LRB sql_cmd_func_args_with_defaults_list RRB { $2 }
    | LRB RRB { ctx.list(NO_NODES) }
    ;

sql_cmd_func_args_with_defaults_list:
    sql_cmd_func_arg_with_default { ctx.list(&[$1]) }
    | sql_cmd_func_args_with_defaults_list COMMA sql_cmd_func_arg_with_default { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_func_as:
    sql_string_literal { ctx.list(&[$1]) }
    | sql_cmd_func_as COMMA sql_string_literal { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_function_with_argtypes:
    sql_func_name sql_cmd_func_args {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FUNCTION_WITH_ARGUMENTS,
            &[
                attr(Key::SQL_FUNCTION_WITH_ARGUMENTS_NAME, ctx.array(@1, $1)),
                attr(Key::SQL_FUNCTION_WITH_ARGUMENTS_ARGUMENTS, ctx.array(@2, $2)),
            ],
        )
    }
    ;

sql_cmd_function_with_argtypes_list:
    sql_cmd_function_with_argtypes { ctx.list(&[$1]) }
    | sql_cmd_function_with_argtypes_list COMMA sql_cmd_function_with_argtypes { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_generic_reset:
    sql_config_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RESET,
            &[
                attr(Key::SQL_RESET_ARG, ctx.array(@1, $1)),
            ],
        )
    }
    | ALL { ctx.object(@$,NodeType::OBJECT_SQL_RESET,&[attr(Key::SQL_RESET_PARAMETER, enum_node(@$, SessionParameter::ALL))]) }
    | ALL GLOBAL { ctx.object(@$,NodeType::OBJECT_SQL_RESET,&[attr(Key::SQL_RESET_PARAMETER, enum_node(@$, SessionParameter::ALL)), attr(Key::SQL_RESET_GLOBAL, bool_node(@$, true))]) }
    ;

sql_cmd_generic_set:
    sql_cmd_var_name TO sql_cmd_var_list {
        ctx.list(&[attr(Key::SQL_SET_NAME, ctx.array(@1, $1)), attr(Key::SQL_SET_ARGS, ctx.array(@3, $3))])
    }
    | sql_cmd_var_name EQUALS vararg_value sql_set_more_values {
        if ctx.list_is_empty($4) {
            ctx.list(&[attr(Key::EXT_SET_VARARGS, vararg_field(ctx, @$, $1, $3))])
        } else {
            let args = ctx.concat2(&[$3], $4);
            ctx.list(&[attr(Key::SQL_SET_NAME, ctx.array(@1, $1)), attr(Key::SQL_SET_ARGS, ctx.array(@3, args))])
        }
    }
    | sql_cmd_var_name TO DEFAULT {
        ctx.list(&[attr(Key::SQL_SET_DEFAULT, bool_node(@3, true)), attr(Key::SQL_SET_NAME, ctx.array(@1, $1))])
    }
    | sql_cmd_var_name EQUALS DEFAULT {
        ctx.list(&[attr(Key::SQL_SET_DEFAULT, bool_node(@3, true)), attr(Key::SQL_SET_NAME, ctx.array(@1, $1))])
    }
    ;

sql_cmd_grantee:
    sql_qualified_name { $1 }
    | GROUP_P sql_qualified_name { $2 }
    ;

sql_cmd_grantee_list:
    sql_cmd_grantee { ctx.list(&[$1]) }
    | sql_cmd_grantee_list COMMA sql_cmd_grantee { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_copy_named_opt_elem:
    sql_param_name COLON_EQUALS sql_argument_value {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_NAMED_ARG_EXPR,
            &[attr(Key::SQL_NAMED_ARG_EXPR_NAME, $1), attr(Key::SQL_NAMED_ARG_EXPR_VALUE, $3)],
        )
    }
    | sql_param_name EQUALS_GREATER sql_argument_value {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_NAMED_ARG_EXPR,
            &[attr(Key::SQL_NAMED_ARG_EXPR_NAME, $1), attr(Key::SQL_NAMED_ARG_EXPR_VALUE, $3)],
        )
    }
    ;

sql_cmd_copy_named_opt_list:
    sql_cmd_copy_named_opt_elem { ctx.list(&[$1]) }
    | sql_cmd_copy_named_opt_list COMMA sql_cmd_copy_named_opt_elem { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_import_source_descriptor:
    sql_cmd_nestable_external_location_descriptor { $1 }
    | STDIN { null() }
    ;

sql_cmd_index_elem:
    sql_col_id sql_cmd_opt_collate sql_cmd_opt_class sql_opt_asc_desc sql_opt_nulls_order {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_INDEX_ELEMENT,
            &[
                attr(Key::SQL_INDEX_ELEMENT_NAME, $1),
                attr(Key::SQL_INDEX_ELEMENT_COLLATION, ctx.array(@2, $2)),
                attr(Key::SQL_INDEX_ELEMENT_OPCLASS, ctx.array(@3, $3)),
                attr(Key::SQL_INDEX_ELEMENT_DIRECTION, $4),
                attr(Key::SQL_INDEX_ELEMENT_NULL_RULE, $5),
            ],
        )
    }
    ;

sql_cmd_index_name:
    sql_col_id { $1 }
    ;

sql_cmd_index_params:
    sql_cmd_index_elem { ctx.list(&[$1]) }
    | sql_cmd_index_params COMMA sql_cmd_index_elem { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_insert_column_item:
    sql_col_id { $1 }
    ;

sql_cmd_insert_column_list:
    sql_cmd_insert_column_item { ctx.list(&[$1]) }
    | sql_cmd_insert_column_list COMMA sql_cmd_insert_column_item { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_merge_delete:
    DELETE_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_MERGE_ACTION,
            &[attr(Key::SQL_MERGE_ACTION_KIND, enum_node(@$, MergeAction::DELETE))],
        )
    }
    ;

sql_cmd_merge_do_nothing:
    DO NOTHING {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_MERGE_ACTION,
            &[attr(Key::SQL_MERGE_ACTION_KIND, enum_node(@$, MergeAction::DO_NOTHING))],
        )
    }
    ;

sql_cmd_merge_insert:
    INSERT VALUES sql_cmd_ctext_row {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_MERGE_ACTION,
            &[
                attr(Key::SQL_MERGE_ACTION_KIND, enum_node(@$, MergeAction::INSERT)),
                attr(Key::SQL_MERGE_ACTION_VALUES, ctx.array(@3, $3)),
            ],
        )
    }
    | INSERT LRB sql_cmd_insert_column_list RRB VALUES sql_cmd_ctext_row {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_MERGE_ACTION,
            &[
                attr(Key::SQL_MERGE_ACTION_KIND, enum_node(@$, MergeAction::INSERT)),
                attr(Key::SQL_MERGE_ACTION_COLUMNS, ctx.array(@3, $3)),
                attr(Key::SQL_MERGE_ACTION_VALUES, ctx.array(@6, $6)),
            ],
        )
    }
    ;

sql_cmd_merge_matched_action:
    sql_cmd_merge_update { $1 }
    | sql_cmd_merge_delete { $1 }
    | sql_cmd_merge_do_nothing { $1 }
    ;

sql_cmd_merge_not_matched_action:
    sql_cmd_merge_insert { $1 }
    | sql_cmd_merge_do_nothing { $1 }
    ;

sql_cmd_merge_update:
    UPDATE SET sql_cmd_set_clause_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_MERGE_ACTION,
            &[
                attr(Key::SQL_MERGE_ACTION_KIND, enum_node(@$, MergeAction::UPDATE)),
                attr(Key::SQL_MERGE_ACTION_TARGET, ctx.array(@3, $3)),
            ],
        )
    }
    ;

sql_cmd_merge_when_clause:
    WHEN MATCHED sql_cmd_opt_merge_condition THEN sql_cmd_merge_matched_action {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_MERGE_WHEN_CLAUSE,
            &[
                attr(Key::SQL_MERGE_WHEN_CLAUSE_KIND, enum_node(@$, MergeMatch::MATCHED)),
                attr(Key::SQL_MERGE_WHEN_CLAUSE_CONDITION, $3),
                attr(Key::SQL_MERGE_WHEN_CLAUSE_ACTION, $5),
            ],
        )
    }
    | WHEN NOT MATCHED BY SOURCE sql_cmd_opt_merge_condition THEN sql_cmd_merge_matched_action {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_MERGE_WHEN_CLAUSE,
            &[
                attr(Key::SQL_MERGE_WHEN_CLAUSE_KIND, enum_node(@$, MergeMatch::NOT_MATCHED_BY_SOURCE)),
                attr(Key::SQL_MERGE_WHEN_CLAUSE_CONDITION, $6),
                attr(Key::SQL_MERGE_WHEN_CLAUSE_ACTION, $8),
            ],
        )
    }
    | WHEN NOT MATCHED sql_cmd_opt_merge_condition THEN sql_cmd_merge_not_matched_action {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_MERGE_WHEN_CLAUSE,
            &[
                attr(Key::SQL_MERGE_WHEN_CLAUSE_KIND, enum_node(@$, MergeMatch::NOT_MATCHED_BY_TARGET)),
                attr(Key::SQL_MERGE_WHEN_CLAUSE_CONDITION, $4),
                attr(Key::SQL_MERGE_WHEN_CLAUSE_ACTION, $6),
            ],
        )
    }
    | WHEN NOT MATCHED BY TARGET sql_cmd_opt_merge_condition THEN sql_cmd_merge_not_matched_action {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_MERGE_WHEN_CLAUSE,
            &[
                attr(Key::SQL_MERGE_WHEN_CLAUSE_KIND, enum_node(@$, MergeMatch::NOT_MATCHED_BY_TARGET)),
                attr(Key::SQL_MERGE_WHEN_CLAUSE_CONDITION, $6),
                attr(Key::SQL_MERGE_WHEN_CLAUSE_ACTION, $8),
            ],
        )
    }
    ;

sql_cmd_merge_when_list:
    sql_cmd_merge_when_clause { ctx.list(&[$1]) }
    | sql_cmd_merge_when_list sql_cmd_merge_when_clause { ctx.push_back($1,$2); $1 }
    ;

sql_cmd_multiple_set_clause:
    LRB sql_cmd_set_target_list RRB EQUALS sql_cmd_ctext_row {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ASSIGNMENT,
            &[
                attr(Key::SQL_ASSIGNMENT_MULTIPLE, bool_node(@$, true)),
                attr(Key::SQL_ASSIGNMENT_COLUMNS, ctx.array(@2, $2)),
                attr(Key::SQL_ASSIGNMENT_VALUE, ctx.array(@5, $5)),
            ],
        )
    }
    | LRB sql_cmd_set_target_list RRB EQUALS ROW sql_cmd_ctext_row {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ASSIGNMENT,
            &[
                attr(Key::SQL_ASSIGNMENT_MULTIPLE, bool_node(@$, true)),
                attr(Key::SQL_ASSIGNMENT_COLUMNS, ctx.array(@2, $2)),
                attr(Key::SQL_ASSIGNMENT_VALUE, ctx.array(@6, $6)),
            ],
        )
    }
    | LRB sql_cmd_set_target_list RRB EQUALS sql_select_parens_node {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ASSIGNMENT,
            &[
                attr(Key::SQL_ASSIGNMENT_MULTIPLE, bool_node(@$, true)),
                attr(Key::SQL_ASSIGNMENT_COLUMNS, ctx.array(@2, $2)),
                attr(Key::SQL_ASSIGNMENT_VALUE, $5),
            ],
        )
    }
    ;

sql_cmd_nestable_external_location_descriptor:
    sql_string_literal { $1 }
    | IDENT LRB RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FUNCTION_CALL,
            &[attr(
                Key::SQL_FUNCTION_CALL_NAME,
                ctx.object(
                    @$,
                    NodeType::OBJECT_SQL_FUNCTION_NAME,
                    &[attr(Key::SQL_FUNCTION_NAME_NAME, name_from_identifier(@1, $1))],
                ),
            )],
        )
    }
    | IDENT LRB sql_func_arg_list RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FUNCTION_CALL,
            &[
                attr(
                    Key::SQL_FUNCTION_CALL_NAME,
                    ctx.object(
                        @$,
                        NodeType::OBJECT_SQL_FUNCTION_NAME,
                        &[attr(Key::SQL_FUNCTION_NAME_NAME, name_from_identifier(@1, $1))],
                    ),
                ),
                attr(Key::SQL_FUNCTION_CALL_ARGS, ctx.array(@3, $3)),
            ],
        )
    }
    | PROGRAM sql_string_literal { ctx.object(@$,NodeType::OBJECT_SQL_PROGRAM_CALL,&[attr(Key::SQL_PROGRAM_CALL_COMMAND,$2)]) }
    ;

sql_cmd_old_aggr_definition:
    LRB sql_cmd_old_aggr_list RRB { $2 }
    ;

sql_cmd_old_aggr_elem:
    IDENT EQUALS sql_cmd_def_arg {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DEFINITION,
            &[
                attr(Key::SQL_DEFINITION_NAME, name_from_identifier(@1, $1)),
                attr(Key::SQL_DEFINITION_ARG, $3),
            ],
        )
    }
    ;

sql_cmd_old_aggr_list:
    sql_cmd_old_aggr_elem { ctx.list(&[$1]) }
    | sql_cmd_old_aggr_list COMMA sql_cmd_old_aggr_elem { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_opt__sequence_option_list:
    sql_cmd_sequence_option_list { $1 }
    | %empty { ctx.list(NO_NODES) }
    ;

sql_cmd_opt_as:
    AS { null() }
    | %empty { null() }
    ;

sql_cmd_opt_attach_database_options:
    WITH LRB sql_cmd_attachdb_opt_items RRB { $3 }
    | %empty { ctx.list(NO_NODES) }
    ;

sql_cmd_opt_binary:
    BINARY {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY_OPTION,
            &[attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::BINARY))],
        )
    }
    | %empty { null() }
    ;

sql_cmd_opt_class:
    sql_any_name { $1 }
    | %empty { ctx.list(NO_NODES) }
    ;

sql_cmd_opt_collate:
    COLLATE sql_any_name { $2 }
    | %empty { ctx.list(NO_NODES) }
    ;

sql_cmd_opt_column:
    COLUMN { bool_node(@$,true) }
    | %empty { null() }
    ;

sql_cmd_opt_concurrently:
    CONCURRENTLY { bool_node(@$,true) }
    | %empty { null() }
    ;

sql_cmd_opt_db_locality:
    LOCAL { enum_node(@$, DatabaseLocality::LOCAL) }
    | %empty { enum_node(@$, DatabaseLocality::GLOBAL) }
    ;

sql_cmd_opt_drop_behavior:
    CASCADE { enum_node(@$, DropBehavior::CASCADE) }
    | RESTRICT { enum_node(@$, DropBehavior::RESTRICT) }
    | %empty { null() }
    ;

sql_cmd_opt_encoding:
    sql_string_literal { $1 }
    | DEFAULT { null() }
    | %empty { null() }
    ;

sql_cmd_opt_enum_val_list:
    sql_cmd_enum_val_list { $1 }
    | %empty { ctx.list(NO_NODES) }
    ;

sql_cmd_opt_equal:
    EQUALS { null() }
    | %empty { null() }
    ;

sql_cmd_opt_external_stream_options:
    LRB sql_cmd_opt_with sql_cmd_copy_options RRB { $3 }
    | WITH LRB sql_cmd_copy_named_opt_list RRB { $3 }
    | %empty { ctx.list(NO_NODES) }
    ;

sql_cmd_opt_from_in:
    FROM { null() }
    | IN_P { null() }
    | %empty { null() }
    ;

sql_cmd_opt_grant_admin_option:
    WITH ADMIN OPTION { bool_node(@$,true) }
    | %empty { null() }
    ;

sql_cmd_opt_grant_grant_option:
    WITH GRANT OPTION { bool_node(@$,true) }
    | %empty { null() }
    ;

sql_cmd_opt_granted_by:
    GRANTED BY sql_qualified_name { $3 }
    | %empty { null() }
    ;

sql_cmd_opt_hold:
    %empty { null() }
    | WITH HOLD { bool_node(@$, true) }
    | WITHOUT HOLD { bool_node(@$, false) }
    ;

sql_cmd_opt_in_database:
    %empty { null() }
    | IN_P DATABASE sql_cmd_database_name { $3 }
    ;

sql_cmd_opt_index_name:
    sql_cmd_index_name { $1 }
    | %empty { null() }
    ;

sql_cmd_opt_merge_condition:
    AND sql_expression_node { $2 }
    | %empty { null() }
    ;

sql_cmd_opt_name_list:
    LRB sql_name_list RRB { $2 }
    | %empty { ctx.list(NO_NODES) }
    ;

sql_cmd_opt_oids:
    WITH OIDS { ctx.object(@$,NodeType::OBJECT_SQL_COPY_OPTION,&[attr(Key::SQL_COPY_OPTION_KIND, enum_node(@$, CopyOption::OIDS))]) }
    | %empty { null() }
    ;

sql_cmd_opt_procedural:
    PROCEDURAL { null() }
    | %empty { null() }
    ;

sql_cmd_opt_reloptions:
    WITH sql_cmd_reloptions { $2 }
    | %empty { ctx.list(NO_NODES) }
    ;

sql_cmd_opt_restart_seqs:
    CONTINUE_P IDENTITY_P { null() }
    | RESTART IDENTITY_P { bool_node(@$,true) }
    | %empty { null() }
    ;

sql_cmd_opt_table:
    TABLE { null() }
    | %empty { null() }
    ;

sql_cmd_opt_table_arg_pruning:
    %empty { null() }
    | KEEP WHEN EMPTY { bool_node(@$,false) }
    | PRUNE WHEN EMPTY { bool_node(@$,true) }
    ;

sql_cmd_opt_table_arg_semantics:
    %empty { null() }
    | WITH ROW SEMANTICS {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_TABLE_ARG_SEMANTICS,
            &[attr(Key::SQL_TABLE_ARG_SEMANTICS_SET, bool_node(@$, false))],
        )
    }
    | WITH SET SEMANTICS sql_cmd_opt_table_arg_pruning {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_TABLE_ARG_SEMANTICS,
            &[
                attr(Key::SQL_TABLE_ARG_SEMANTICS_SET, bool_node(@$, true)),
                attr(Key::SQL_TABLE_ARG_SEMANTICS_PRUNING, $4),
            ],
        )
    }
    ;

sql_cmd_opt_table_func_column_list:
    sql_cmd_table_func_column_list { $1 }
    | %empty { ctx.list(NO_NODES) }
    ;

sql_cmd_opt_table_pass_through:
    %empty { null() }
    | PASS THROUGH { bool_node(@$,true) }
    | NO PASS THROUGH { bool_node(@$,false) }
    ;

sql_cmd_opt_unique:
    UNIQUE { bool_node(@$,true) }
    | %empty { null() }
    ;

sql_cmd_opt_unload_defragment:
    WITH DEFRAGMENTATION { bool_node(@$, true) }
    | %empty { null() }
    ;

sql_cmd_opt_using:
    USING { null() }
    | %empty { null() }
    ;

sql_cmd_opt_verbose:
    VERBOSE { bool_node(@$,true) }
    | %empty { null() }
    ;

sql_cmd_opt_with:
    WITH { null() }
    | WITH_LA { null() }
    | %empty { null() }
    ;

sql_cmd_postgres_copy_generic_opt_elem:
    sql_col_label sql_cmd_copy_generic_opt_arg {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_COPY_OPTION,
            &[
                attr(Key::SQL_COPY_OPTION_NAME, $1),
                attr(Key::SQL_COPY_OPTION_VALUE, $2),
            ],
        )
    }
    ;

sql_cmd_postgres_copy_generic_opt_list:
    sql_cmd_postgres_copy_generic_opt_elem { ctx.list(&[$1]) }
    | sql_cmd_postgres_copy_generic_opt_list COMMA sql_cmd_postgres_copy_generic_opt_elem { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_prep_type_clause:
    LRB sql_cmd_prep_type_list RRB { $2 }
    | %empty { ctx.list(NO_NODES) }
    ;

sql_cmd_prep_type_list:
    sql_cmd_prep_type_list_item { ctx.list(&[$1]) }
    | sql_cmd_prep_type_list COMMA sql_cmd_prep_type_list_item { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_prep_type_list_item:
    sql_typename { $1 }
    | sql_param_name sql_typename {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_NAMED_ARG_EXPR,
            &[attr(Key::SQL_NAMED_ARG_EXPR_NAME, $1), attr(Key::SQL_NAMED_ARG_EXPR_VALUE, $2)],
        )
    }
    ;

sql_cmd_privilege:
    SELECT sql_opt_column_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_ACCESS_PRIVILEGE,
            &[
                attr(Key::SQL_GRANT_ACCESS_PRIVILEGE_KIND, enum_node(@$, Privilege::SELECT)),
                attr(Key::SQL_GRANT_ACCESS_PRIVILEGE_COLUMNS, ctx.array(@2, $2)),
            ],
        )
    }
    | REFERENCES sql_opt_column_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_ACCESS_PRIVILEGE,
            &[
                attr(Key::SQL_GRANT_ACCESS_PRIVILEGE_KIND, enum_node(@$, Privilege::REFERENCES)),
                attr(Key::SQL_GRANT_ACCESS_PRIVILEGE_COLUMNS, ctx.array(@2, $2)),
            ],
        )
    }
    | CREATE_P sql_opt_column_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_ACCESS_PRIVILEGE,
            &[
                attr(Key::SQL_GRANT_ACCESS_PRIVILEGE_KIND, enum_node(@$, Privilege::CREATE)),
                attr(Key::SQL_GRANT_ACCESS_PRIVILEGE_COLUMNS, ctx.array(@2, $2)),
            ],
        )
    }
    | sql_qualified_name sql_opt_column_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_ACCESS_PRIVILEGE,
            &[
                attr(Key::SQL_GRANT_ACCESS_PRIVILEGE_NAME, $1),
                attr(Key::SQL_GRANT_ACCESS_PRIVILEGE_COLUMNS, ctx.array(@2, $2)),
            ],
        )
    }
    ;

sql_cmd_privilege_list:
    sql_cmd_privilege { ctx.list(&[$1]) }
    | sql_cmd_privilege_list COMMA sql_cmd_privilege { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_privilege_target:
    sql_qualified_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_TARGET,
            &[
                attr(Key::SQL_GRANT_TARGET_KIND, enum_node(@$, GrantTargetType::RELATION)),
                attr(Key::SQL_GRANT_TARGET_OBJECTS, ctx.array(@1, $1)),
            ],
        )
    }
    | TABLE sql_qualified_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_TARGET,
            &[
                attr(Key::SQL_GRANT_TARGET_KIND, enum_node(@$, GrantTargetType::RELATION)),
                attr(Key::SQL_GRANT_TARGET_OBJECTS, ctx.array(@2, $2)),
            ],
        )
    }
    | SEQUENCE sql_qualified_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_TARGET,
            &[
                attr(Key::SQL_GRANT_TARGET_KIND, enum_node(@$, GrantTargetType::SEQUENCE)),
                attr(Key::SQL_GRANT_TARGET_OBJECTS, ctx.array(@2, $2)),
            ],
        )
    }
    | FOREIGN DATA_P WRAPPER sql_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_TARGET,
            &[
                attr(Key::SQL_GRANT_TARGET_KIND, enum_node(@$, GrantTargetType::FOREIGN_DATA_WRAPPER)),
                attr(Key::SQL_GRANT_TARGET_OBJECTS, ctx.array(@4, $4)),
            ],
        )
    }
    | FOREIGN SERVER sql_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_TARGET,
            &[
                attr(Key::SQL_GRANT_TARGET_KIND, enum_node(@$, GrantTargetType::FOREIGN_SERVER)),
                attr(Key::SQL_GRANT_TARGET_OBJECTS, ctx.array(@3, $3)),
            ],
        )
    }
    | FUNCTION sql_cmd_function_with_argtypes_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_TARGET,
            &[
                attr(Key::SQL_GRANT_TARGET_KIND, enum_node(@$, GrantTargetType::FUNCTION)),
                attr(Key::SQL_GRANT_TARGET_OBJECTS, ctx.array(@2, $2)),
            ],
        )
    }
    | DATABASE sql_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_TARGET,
            &[
                attr(Key::SQL_GRANT_TARGET_KIND, enum_node(@$, GrantTargetType::DATABASE)),
                attr(Key::SQL_GRANT_TARGET_OBJECTS, ctx.array(@2, $2)),
            ],
        )
    }
    | DOMAIN_P sql_cmd_any_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_TARGET,
            &[
                attr(Key::SQL_GRANT_TARGET_KIND, enum_node(@$, GrantTargetType::DOMAIN)),
                attr(Key::SQL_GRANT_TARGET_OBJECTS, ctx.array(@2, $2)),
            ],
        )
    }
    | LANGUAGE sql_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_TARGET,
            &[
                attr(Key::SQL_GRANT_TARGET_KIND, enum_node(@$, GrantTargetType::LANGUAGE)),
                attr(Key::SQL_GRANT_TARGET_OBJECTS, ctx.array(@2, $2)),
            ],
        )
    }
    | LARGE_P OBJECT_P sql_cmd_numeric_only_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_TARGET,
            &[
                attr(Key::SQL_GRANT_TARGET_KIND, enum_node(@$, GrantTargetType::LARGE_OBJECT)),
                attr(Key::SQL_GRANT_TARGET_OBJECTS, ctx.array(@3, $3)),
            ],
        )
    }
    | SCHEMA sql_qualified_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_TARGET,
            &[
                attr(Key::SQL_GRANT_TARGET_KIND, enum_node(@$, GrantTargetType::SCHEMA)),
                attr(Key::SQL_GRANT_TARGET_OBJECTS, ctx.array(@2, $2)),
            ],
        )
    }
    | TABLESPACE sql_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_TARGET,
            &[
                attr(Key::SQL_GRANT_TARGET_KIND, enum_node(@$, GrantTargetType::TABLESPACE)),
                attr(Key::SQL_GRANT_TARGET_OBJECTS, ctx.array(@2, $2)),
            ],
        )
    }
    | TYPE_P sql_cmd_any_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_TARGET,
            &[
                attr(Key::SQL_GRANT_TARGET_KIND, enum_node(@$, GrantTargetType::TYPE)),
                attr(Key::SQL_GRANT_TARGET_OBJECTS, ctx.array(@2, $2)),
            ],
        )
    }
    | ALL TABLES IN_P SCHEMA sql_qualified_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_TARGET,
            &[
                attr(Key::SQL_GRANT_TARGET_KIND, enum_node(@$, GrantTargetType::RELATION)),
                attr(Key::SQL_GRANT_TARGET_ALL_IN_SCHEMA, bool_node(@$, true)),
                attr(Key::SQL_GRANT_TARGET_OBJECTS, ctx.array(@5, $5)),
            ],
        )
    }
    | ALL SEQUENCES IN_P SCHEMA sql_qualified_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_TARGET,
            &[
                attr(Key::SQL_GRANT_TARGET_KIND, enum_node(@$, GrantTargetType::SEQUENCE)),
                attr(Key::SQL_GRANT_TARGET_ALL_IN_SCHEMA, bool_node(@$, true)),
                attr(Key::SQL_GRANT_TARGET_OBJECTS, ctx.array(@5, $5)),
            ],
        )
    }
    | ALL FUNCTIONS IN_P SCHEMA sql_qualified_name_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_TARGET,
            &[
                attr(Key::SQL_GRANT_TARGET_KIND, enum_node(@$, GrantTargetType::FUNCTION)),
                attr(Key::SQL_GRANT_TARGET_ALL_IN_SCHEMA, bool_node(@$, true)),
                attr(Key::SQL_GRANT_TARGET_OBJECTS, ctx.array(@5, $5)),
            ],
        )
    }
    ;

sql_cmd_privileges:
    sql_cmd_privilege_list { ctx.array(@$, $1) }
    | ALL {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_ACCESS_PRIVILEGE,
            &[attr(Key::SQL_GRANT_ACCESS_PRIVILEGE_KIND, enum_node(@$, Privilege::ALL))],
        )
    }
    | ALL PRIVILEGES {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_ACCESS_PRIVILEGE,
            &[attr(Key::SQL_GRANT_ACCESS_PRIVILEGE_KIND, enum_node(@$, Privilege::ALL))],
        )
    }
    | ALL LRB sql_column_list RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_ACCESS_PRIVILEGE,
            &[
                attr(Key::SQL_GRANT_ACCESS_PRIVILEGE_KIND, enum_node(@$, Privilege::ALL)),
                attr(Key::SQL_GRANT_ACCESS_PRIVILEGE_COLUMNS, ctx.array(@3, $3)),
            ],
        )
    }
    | ALL PRIVILEGES LRB sql_column_list RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GRANT_ACCESS_PRIVILEGE,
            &[
                attr(Key::SQL_GRANT_ACCESS_PRIVILEGE_KIND, enum_node(@$, Privilege::ALL)),
                attr(Key::SQL_GRANT_ACCESS_PRIVILEGE_COLUMNS, ctx.array(@4, $4)),
            ],
        )
    }
    ;

sql_cmd_relation_expr_list:
    sql_relation_expr { ctx.list(&[ctx.object(@1,NodeType::OBJECT_SQL_TABLEREF,$1)]) }
    | sql_cmd_relation_expr_list COMMA sql_relation_expr { ctx.push_back($1,ctx.object(@3,NodeType::OBJECT_SQL_TABLEREF,$3)); $1 }
    ;

sql_cmd_relation_expr_opt_alias:
sql_relation_expr %prec UMINUS { ctx.object(@$,NodeType::OBJECT_SQL_TABLEREF,$1) }
 | sql_relation_expr sql_col_id { ctx.object(@$,NodeType::OBJECT_SQL_TABLEREF,ctx.concat2($1,&[attr(Key::SQL_TABLEREF_ALIAS,$2)])) }
 | sql_relation_expr AS sql_col_id { ctx.object(@$,NodeType::OBJECT_SQL_TABLEREF,ctx.concat2($1,&[attr(Key::SQL_TABLEREF_ALIAS,$3)])) }
    ;
sql_cmd_reloption_elem:
    sql_col_label EQUALS sql_cmd_def_arg { ctx.object(@$,NodeType::OBJECT_SQL_DEFINITION,&[attr(Key::SQL_DEFINITION_NAME,$1),attr(Key::SQL_DEFINITION_ARG,$3)]) }
    | sql_col_label { ctx.object(@$,NodeType::OBJECT_SQL_DEFINITION,&[attr(Key::SQL_DEFINITION_NAME,$1)]) }
    | sql_col_label DOT sql_col_label EQUALS sql_cmd_def_arg {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DEFINITION,
            &[
                attr(Key::SQL_DEFINITION_NAME, $1),
                attr(Key::SQL_DEFINITION_NAME2, $3),
                attr(Key::SQL_DEFINITION_ARG, $5),
            ],
        )
    }
    | sql_col_label DOT sql_col_label {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DEFINITION,
            &[attr(Key::SQL_DEFINITION_NAME, $1), attr(Key::SQL_DEFINITION_NAME2, $3)],
        )
    }
    ;

sql_cmd_reloption_list:
    sql_cmd_reloption_elem { ctx.list(&[$1]) }
    | sql_cmd_reloption_list COMMA sql_cmd_reloption_elem { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_reloptions:
    LRB sql_cmd_reloption_list RRB { $2 }
    ;

sql_cmd_reserved_keyword:
    ALL { ctx.name_from_keyword(@1,$1) }
    | ANALYSE { ctx.name_from_keyword(@1,$1) }
    | ANALYZE { ctx.name_from_keyword(@1,$1) }
    | AND { ctx.name_from_keyword(@1,$1) }
    | ANY { ctx.name_from_keyword(@1,$1) }
    | ARRAY { ctx.name_from_keyword(@1,$1) }
    | AS { ctx.name_from_keyword(@1,$1) }
    | ASC_P { ctx.name_from_keyword(@1,$1) }
    | ASSUMED { ctx.name_from_keyword(@1,$1) }
    | ASYMMETRIC { ctx.name_from_keyword(@1,$1) }
    | BOTH { ctx.name_from_keyword(@1,$1) }
    | CASE { ctx.name_from_keyword(@1,$1) }
    | CAST { ctx.name_from_keyword(@1,$1) }
    | CHECK_P { ctx.name_from_keyword(@1,$1) }
    | COLLATE { ctx.name_from_keyword(@1,$1) }
    | COLUMN { ctx.name_from_keyword(@1,$1) }
    | CONSTRAINT { ctx.name_from_keyword(@1,$1) }
    | CREATE_P { ctx.name_from_keyword(@1,$1) }
    | CURRENT_CATALOG { ctx.name_from_keyword(@1,$1) }
    | CURRENT_DATE { ctx.name_from_keyword(@1,$1) }
    | CURRENT_ROLE { ctx.name_from_keyword(@1,$1) }
    | CURRENT_TIME { ctx.name_from_keyword(@1,$1) }
    | CURRENT_TIMESTAMP { ctx.name_from_keyword(@1,$1) }
    | CURRENT_USER { ctx.name_from_keyword(@1,$1) }
    | DEFAULT { ctx.name_from_keyword(@1,$1) }
    | DEFERRABLE { ctx.name_from_keyword(@1,$1) }
    | DESC_P { ctx.name_from_keyword(@1,$1) }
    | DISTINCT { ctx.name_from_keyword(@1,$1) }
    | DO { ctx.name_from_keyword(@1,$1) }
    | ELSE { ctx.name_from_keyword(@1,$1) }
    | END_P { ctx.name_from_keyword(@1,$1) }
    | EXCEPT { ctx.name_from_keyword(@1,$1) }
    | FALSE_P { ctx.name_from_keyword(@1,$1) }
    | FETCH { ctx.name_from_keyword(@1,$1) }
    | FOR { ctx.name_from_keyword(@1,$1) }
    | FOREIGN { ctx.name_from_keyword(@1,$1) }
    | FROM { ctx.name_from_keyword(@1,$1) }
    | GRANT { ctx.name_from_keyword(@1,$1) }
    | GRAPH_TABLE { ctx.name_from_keyword(@1,$1) }
    | GROUP_P { ctx.name_from_keyword(@1,$1) }
    | HAVING { ctx.name_from_keyword(@1,$1) }
    | INITIALLY { ctx.name_from_keyword(@1,$1) }
    | INTERSECT { ctx.name_from_keyword(@1,$1) }
    | INTO { ctx.name_from_keyword(@1,$1) }
    | IN_P { ctx.name_from_keyword(@1,$1) }
    | LAMBDA { ctx.name_from_keyword(@1,$1) }
    | LATERAL_P { ctx.name_from_keyword(@1,$1) }
    | LEADING { ctx.name_from_keyword(@1,$1) }
    | LIMIT { ctx.name_from_keyword(@1,$1) }
    | LOCALTIME { ctx.name_from_keyword(@1,$1) }
    | LOCALTIMESTAMP { ctx.name_from_keyword(@1,$1) }
    | NOT { ctx.name_from_keyword(@1,$1) }
    | NULL_P { ctx.name_from_keyword(@1,$1) }
    | OFFSET { ctx.name_from_keyword(@1,$1) }
    | ON { ctx.name_from_keyword(@1,$1) }
    | ONLY { ctx.name_from_keyword(@1,$1) }
    | OMIT { ctx.name_from_keyword(@1,$1) }
    | OR { ctx.name_from_keyword(@1,$1) }
    | ORDER { ctx.name_from_keyword(@1,$1) }
    | PLACING { ctx.name_from_keyword(@1,$1) }
    | PRIMARY { ctx.name_from_keyword(@1,$1) }
    | REFERENCES { ctx.name_from_keyword(@1,$1) }
    | RETURNING { ctx.name_from_keyword(@1,$1) }
    | SELECT { ctx.name_from_keyword(@1,$1) }
    | SESSION_USER { ctx.name_from_keyword(@1,$1) }
    | SOME { ctx.name_from_keyword(@1,$1) }
    | SYMMETRIC { ctx.name_from_keyword(@1,$1) }
    | TABLE { ctx.name_from_keyword(@1,$1) }
    | THEN { ctx.name_from_keyword(@1,$1) }
    | TO { ctx.name_from_keyword(@1,$1) }
    | TRAILING { ctx.name_from_keyword(@1,$1) }
    | TRUE_P { ctx.name_from_keyword(@1,$1) }
    | UNION { ctx.name_from_keyword(@1,$1) }
    | UNIQUE { ctx.name_from_keyword(@1,$1) }
    | USER { ctx.name_from_keyword(@1,$1) }
    | USING { ctx.name_from_keyword(@1,$1) }
    | VARIADIC { ctx.name_from_keyword(@1,$1) }
    | WHEN { ctx.name_from_keyword(@1,$1) }
    | WHERE { ctx.name_from_keyword(@1,$1) }
    | WINDOW { ctx.name_from_keyword(@1,$1) }
    | WITH { ctx.name_from_keyword(@1,$1) }
    ;

sql_cmd_reset_rest:
    sql_cmd_generic_reset { $1 }
    | TIME ZONE { ctx.object(@$,NodeType::OBJECT_SQL_RESET,&[attr(Key::SQL_RESET_PARAMETER, enum_node(@$, SessionParameter::TIME_ZONE))]) }
    | TRANSACTION ISOLATION LEVEL {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RESET,
            &[attr(Key::SQL_RESET_PARAMETER, enum_node(@$, SessionParameter::TRANSACTION_ISOLATION))],
        )
    }
    | SESSION AUTHORIZATION {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RESET,
            &[attr(Key::SQL_RESET_PARAMETER, enum_node(@$, SessionParameter::SESSION_AUTHORIZATION))],
        )
    }
    ;

sql_cmd_role_list:
    sql_cmd_role_id { ctx.list(&[$1]) }
    | sql_cmd_role_list COMMA sql_cmd_role_id { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_set_clause:
    sql_cmd_single_set_clause { $1 }
    | sql_cmd_multiple_set_clause { $1 }
    ;

sql_cmd_set_clause_list:
    sql_cmd_set_clause { ctx.list(&[$1]) }
    | sql_cmd_set_clause_list COMMA sql_cmd_set_clause { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_set_rest:
    TRANSACTION sql_transaction_mode_list {
        ctx.list(&[attr(Key::SQL_SET_PARAMETER, enum_node(@$, SessionParameter::TRANSACTION)), attr(Key::SQL_SET_ARGS, ctx.array(@2, $2))])
    }
    | SESSION CHARACTERISTICS AS TRANSACTION sql_transaction_mode_list {
        ctx.list(&[attr(Key::SQL_SET_PARAMETER, enum_node(@$, SessionParameter::SESSION_CHARACTERISTICS)), attr(Key::SQL_SET_ARGS, ctx.array(@5, $5))])
    }
    | sql_cmd_set_rest_more { $1 }
    ;

sql_cmd_set_rest_more:
    sql_cmd_generic_set { $1 }
    | sql_cmd_var_name FROM CURRENT_P {
        ctx.list(&[attr(Key::SQL_SET_FROM_CURRENT, bool_node(@$, true)), attr(Key::SQL_SET_NAME, ctx.array(@1, $1))])
    }
    | TIME ZONE sql_cmd_zone_value { ctx.list(&[attr(Key::SQL_SET_PARAMETER, enum_node(@$, SessionParameter::TIME_ZONE)), attr(Key::SQL_SET_ARGS, $3)]) }
    | CATALOG_P sql_string_literal { ctx.list(&[attr(Key::SQL_SET_PARAMETER, enum_node(@$, SessionParameter::CATALOG)), attr(Key::SQL_SET_ARGS, $2)]) }
    | SCHEMA sql_string_literal { ctx.list(&[attr(Key::SQL_SET_PARAMETER, enum_node(@$, SessionParameter::SCHEMA)), attr(Key::SQL_SET_ARGS, $2)]) }
    | NAMES sql_cmd_opt_encoding { ctx.list(&[attr(Key::SQL_SET_PARAMETER, enum_node(@$, SessionParameter::CLIENT_ENCODING)), attr(Key::SQL_SET_ARGS, $2)]) }
    | ROLE sql_word_or_string { ctx.list(&[attr(Key::SQL_SET_PARAMETER, enum_node(@$, SessionParameter::ROLE)), attr(Key::SQL_SET_ARGS, $2)]) }
    | SESSION AUTHORIZATION sql_word_or_string { ctx.list(&[attr(Key::SQL_SET_PARAMETER, enum_node(@$, SessionParameter::SESSION_AUTHORIZATION)), attr(Key::SQL_SET_ARGS, $3)]) }
    | SESSION AUTHORIZATION DEFAULT { ctx.list(&[attr(Key::SQL_SET_PARAMETER, enum_node(@$, SessionParameter::SESSION_AUTHORIZATION)), attr(Key::SQL_SET_DEFAULT, bool_node(@3, true))]) }
    | TRANSACTION SNAPSHOT sql_string_literal { ctx.list(&[attr(Key::SQL_SET_PARAMETER, enum_node(@$, SessionParameter::TRANSACTION_SNAPSHOT)), attr(Key::SQL_SET_ARGS, $3)]) }
    ;

sql_cmd_set_target:
    sql_col_id { $1 }
    ;

sql_cmd_set_target_list:
    sql_cmd_set_target { ctx.list(&[$1]) }
    | sql_cmd_set_target_list COMMA sql_cmd_set_target { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_single_set_clause:
    sql_cmd_set_target EQUALS sql_cmd_ctext_expr {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ASSIGNMENT,
            &[
                attr(Key::SQL_ASSIGNMENT_COLUMNS, $1),
                attr(Key::SQL_ASSIGNMENT_VALUE, $3),
            ],
        )
    }
    ;

sql_cmd_source_descriptor:
    sql_cmd_nestable_external_location_descriptor { $1 }
    | ARRAY LSB RSB { ctx.object_ex(@$,NodeType::OBJECT_SQL_ARRAY_EXPRESSION,NO_NODES,false,false) }
    | ARRAY LSB sql_cmd_array_external_location_descriptor_list RSB { ctx.object(@$,NodeType::OBJECT_SQL_ARRAY_EXPRESSION,&[attr(Key::SQL_ARRAY_EXPRESSION_ARGS,ctx.array(@3,$3))]) }
    ;

sql_cmd_table_column_type:
    sql_type_function_name sql_attrs MODULO TYPE_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_TYPE_TABLE_COLUMN,
            &[
                attr(Key::SQL_TYPE_TABLE_COLUMN_NAME, $1),
                attr(Key::SQL_TYPE_TABLE_COLUMN_ATTRIBUTES, ctx.array(@2, $2)),
            ],
        )
    }
    ;

sql_cmd_table_func_column:
    sql_param_name sql_typename sql_opt_not_null {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_FUNCTION_PARAM,
            &[
                attr(Key::SQL_FUNCTION_PARAM_NAME, $1),
                attr(Key::SQL_FUNCTION_PARAM_TYPE, $2),
                attr(Key::SQL_FUNCTION_PARAM_NOT_NULL, $3),
            ],
        )
    }
    ;

sql_cmd_table_func_column_list:
    sql_cmd_table_func_column { ctx.list(&[$1]) }
    | sql_cmd_table_func_column_list COMMA sql_cmd_table_func_column { ctx.push_back($1,$3); $1 }
    ;


sql_cmd_var_list:
    sql_cmd_var_value { ctx.list(&[$1]) }
    | sql_cmd_var_list COMMA sql_cmd_var_value { ctx.push_back($1,$3); $1 }
    ;

sql_cmd_var_name:
vararg_key_path { $1 }
    ;
sql_cmd_var_value:
    sql_setting_value { $1 }
    | sql_numeric_only { $1 }
    ;

sql_cmd_where_or_current_clause:
    WHERE sql_expression_node { $2 }
    | WHERE CURRENT_P OF sql_cmd_cursor_name { ctx.object(@$,NodeType::OBJECT_SQL_CURRENT_OF,&[attr(Key::SQL_CURRENT_OF_NAME,$4)]) }
    | %empty { null() }
    ;

sql_cmd_zone_value:
    sql_string_literal {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ZONE_VALUE,
            &[
                attr(Key::SQL_ZONE_VALUE_KIND, enum_node(@$, ZoneValueType::LITERAL)),
                attr(Key::SQL_ZONE_VALUE_ARG, $1),
            ],
        )
    }
    | IDENT {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ZONE_VALUE,
            &[
                attr(Key::SQL_ZONE_VALUE_KIND, enum_node(@$, ZoneValueType::LITERAL)),
                attr(Key::SQL_ZONE_VALUE_ARG, name_from_identifier(@1, $1)),
            ],
        )
    }
    | sql_const_interval sql_string_literal sql_opt_interval {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ZONE_VALUE,
            &[
                attr(Key::SQL_ZONE_VALUE_KIND, enum_node(@$, ZoneValueType::INTERVAL)),
                attr(Key::SQL_ZONE_VALUE_ARG, $2),
                attr(Key::SQL_ZONE_VALUE_MOD, $3),
            ],
        )
    }
    | sql_const_interval LRB sql_integer_literal RRB sql_string_literal {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ZONE_VALUE,
            &[
                attr(Key::SQL_ZONE_VALUE_KIND, enum_node(@$, ZoneValueType::INTERVAL)),
                attr(Key::SQL_ZONE_VALUE_MOD, $3),
                attr(Key::SQL_ZONE_VALUE_ARG, $5),
            ],
        )
    }
    | sql_numeric_only {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ZONE_VALUE,
            &[
                attr(Key::SQL_ZONE_VALUE_KIND, enum_node(@$, ZoneValueType::NUMERIC)),
                attr(Key::SQL_ZONE_VALUE_ARG, $1),
            ],
        )
    }
    | DEFAULT { null() }
    | LOCAL { null() }
    ;


sql_config_name: sql_col_id { ctx.list(&[$1]) } | sql_config_name DOT sql_col_id { ctx.push_back($1,$3); $1 };

sql_cmd_func_arg: sql_function_param_fields { ctx.object(@$,NodeType::OBJECT_SQL_FUNCTION_PARAM,$1) };
