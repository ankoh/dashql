sql_insert_stmt:
    INSERT sql_insert_bulk INTO sql_insert_target sql_insert_rest sql_insert_on_conflict sql_insert_returning_clause {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_INSERT,
            ctx.concat2(
                $5,
                &[
                    attr(Key::SQL_INSERT_TARGET, $4),
                    attr(Key::SQL_INSERT_ON_CONFLICT, $6),
                    attr(Key::SQL_INSERT_RETURNING, $7),
                    attr(Key::SQL_INSERT_BULK, $2),
                ],
            ),
        )
    }
  | sql_with_clause INSERT sql_insert_bulk INTO sql_insert_target sql_insert_rest sql_insert_on_conflict sql_insert_returning_clause {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_INSERT,
            ctx.concat3(
                $1,
                $6,
                &[
                    attr(Key::SQL_INSERT_TARGET, $5),
                    attr(Key::SQL_INSERT_ON_CONFLICT, $7),
                    attr(Key::SQL_INSERT_RETURNING, $8),
                    attr(Key::SQL_INSERT_BULK, $3),
                ],
            ),
        )
    }
    ;

// The table that an INSERT writes, a table name with an optional alias or a table parameter
sql_insert_target:
    sql_qualified_name  { ctx.object(@1, NodeType::OBJECT_SQL_TABLEREF, &[attr(Key::SQL_TABLEREF_NAME, $1)]) }
  | sql_qualified_name AS sql_col_id {
      ctx.object(@$, NodeType::OBJECT_SQL_TABLEREF, &[attr(Key::SQL_TABLEREF_NAME, $1), attr(Key::SQL_TABLEREF_ALIAS, $3)])
  }
  | sql_table_param_ref { ctx.object(@1, NodeType::OBJECT_SQL_TABLEREF, &[attr(Key::SQL_TABLEREF_TABLE, $1)]) }
    ;

sql_insert_rest:
    sql_select_stmt { ctx.list(&[attr(Key::SQL_INSERT_SOURCE, ctx.object(@1, NodeType::OBJECT_SQL_SELECT, $1))]) }
  | LRB sql_name_list RRB sql_select_stmt {
      ctx.list(
          &[
              attr(Key::SQL_INSERT_COLUMNS, ctx.array(loc(&[@1, @2, @3]), $2)),
              attr(Key::SQL_INSERT_SOURCE, ctx.object(@4, NodeType::OBJECT_SQL_SELECT, $4)),
          ],
      )
  }
  | DEFAULT VALUES { ctx.list(&[attr(Key::SQL_INSERT_DEFAULT_VALUES, bool_node(@$, true))]) }
  // The end of the input or an error after the target still reduces the INSERT, so that the target of an unfinished
  // statement stays a table ref, `insert into sch.` or `insert into sch. values (1)` (`sch.values`)
  | sql_eof_or_error { ctx.list(&[]) }
    ;

// The end of the input or an error, after the target of an unfinished INSERT or UPDATE
sql_eof_or_error: EOF | error
    ;

// ON CONFLICT [ (columns) [WHERE predicate] | ON CONSTRAINT name ] DO NOTHING | DO UPDATE SET ... [WHERE condition]
sql_insert_on_conflict:
    ON CONFLICT sql_insert_conflict_target DO NOTHING {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_INSERT_ON_CONFLICT,
            ctx.concat2(
                $3,
                &[attr(Key::SQL_INSERT_ON_CONFLICT_ACTION, enum_node(loc(&[@4, @5]), InsertConflictAction::DO_NOTHING))],
            ),
        )
    }
  | ON CONFLICT sql_insert_conflict_target DO UPDATE SET sql_cmd_set_clause_list sql_where_clause {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_INSERT_ON_CONFLICT,
            ctx.concat2(
                $3,
                &[
                    attr(Key::SQL_INSERT_ON_CONFLICT_ACTION, enum_node(loc(&[@4, @5]), InsertConflictAction::DO_UPDATE)),
                    attr(Key::SQL_INSERT_ON_CONFLICT_ASSIGNMENTS, ctx.array(@7, $7)),
                    attr(Key::SQL_INSERT_ON_CONFLICT_WHERE, $8),
                ],
            ),
        )
    }
  | %empty { null() }
    ;

// The unique index or the constraint that the conflict is about, both optional for DO NOTHING
sql_insert_conflict_target:
    LRB sql_cmd_index_params RRB sql_where_clause {
        ctx.list(
            &[
                attr(Key::SQL_INSERT_ON_CONFLICT_TARGET, ctx.array(loc(&[@1, @2, @3]), $2)),
                attr(Key::SQL_INSERT_ON_CONFLICT_TARGET_WHERE, $4),
            ],
        )
    }
  | ON CONSTRAINT sql_name { ctx.list(&[attr(Key::SQL_INSERT_ON_CONFLICT_CONSTRAINT, $3)]) }
  | %empty { ctx.list(NO_NODES) }
    ;

sql_insert_returning_clause:
    RETURNING sql_target_list { ctx.array(@2, $2) }
  | %empty                    { null() }
    ;

sql_insert_bulk: BULK { bool_node(@$,true) } | %empty { null() };
