// A complete SELECT statement looks like this.
//
// The rule returns either a single PGSelectStmt node or a tree of them,
// representing a set-operation tree.
//
// There is an ambiguity when a sub-SELECT is within an a_expr and there
// are excess parentheses: do the parentheses belong to the sub-SELECT or
// to the surrounding a_expr?  We don't really care, but bison wants to know.
// To resolve the ambiguity, we are careful to define the grammar so that
// the decision is staved off as long as possible: as long as we can keep
// absorbing parentheses into the sub-SELECT, we will do so, and only when
// it's no longer possible to do that will we decide that parens belong to
// the expression.    For example, in "SELECT (((SELECT 2)) + 3)" the extra
// parentheses are treated as part of the sub-select.  The necessity of doing
// it that way is shown by "SELECT (((SELECT 2)) UNION SELECT 2)".    Had we
// parsed "((SELECT 2))" as an a_expr, it'd be too late to go back to the
// SELECT viewpoint when we see the UNION.
//
// This approach is implemented by defining a nonterminal select_with_parens,
// which represents a SELECT with at least one outer layer of parentheses,
// and being careful to use select_with_parens, never '(' PGSelectStmt ')',
// in the expression grammar.  We will then have shift-reduce conflicts
// which we can resolve in favor of always treating '(' <select> ')' as
// a select_with_parens.  To resolve the conflicts, the productions that
// conflict with the select_with_parens productions are manually given
// precedences lower than the precedence of ')', thereby ensuring that we
// shift ')' (and then reduce to select_with_parens) rather than trying to
// reduce the inner <select> nonterminal to something else.  We use UMINUS
// precedence for this, which is a fairly arbitrary choice.
//
// To be able to define select_with_parens itself without ambiguity, we need
// a nonterminal select_no_parens that represents a SELECT structure with no
// outermost parentheses.  This is a little bit tedious, but it works.
//
// In non-expression contexts, we use PGSelectStmt which can represent a SELECT
// with or without outer parentheses.

sql_select_stmt:
    sql_select_no_parens    %prec UMINUS { $$ = move($1); }
  | sql_select_with_parens  %prec UMINUS { $$ = move($1); }
    ;

sql_select_with_parens:
    '(' sql_select_no_parens ')'    { $$ = move($2); }
  | '(' sql_select_with_parens ')'  { $$ = move($2); }
        ;

// This rule parses the equivalent of the standard's <query expression>.
// The duplicative productions are annoying, but hard to get rid of without
// creating shift/reduce conflicts.
//
//    The locking clause (FOR UPDATE etc) may be before or after LIMIT/OFFSET.
//    In <=7.2.X, LIMIT/OFFSET had to be after FOR UPDATE
//    We now support both orderings, but prefer LIMIT/OFFSET before the locking
// clause.
//    2002-08-28 bjm

sql_select_no_parens:
    sql_simple_select { $$ = move($1); }
  | sql_select_clause sql_sort_clause {
        $$ = concat(move($1), {
            Key::SQL_SELECT_ORDER << $2
        });
    }
  | sql_select_clause sql_opt_sort_clause sql_for_locking_clause sql_opt_select_limit {
        $$ = concat(move($1), move($4), {
            Key::SQL_SELECT_ORDER << $2,
            Key::SQL_SELECT_ROW_LOCKING << ctx.Add(@3, move($3)),
        });
    }
  | sql_select_clause sql_opt_sort_clause sql_select_limit sql_opt_for_locking_clause {
        $$ = concat(move($1), move($3), {
            Key::SQL_SELECT_ORDER << $2,
            Key::SQL_SELECT_ROW_LOCKING << ctx.Add(@4, move($4)),
        });
    }
  | sql_with_clause sql_select_clause { $$ = concat(move($1), move($2)); }
  | sql_with_clause sql_select_clause sql_sort_clause {
        $$ = concat(move($1), move($2), {
            Key::SQL_SELECT_ORDER << $3,
        });
    }
  | sql_with_clause sql_select_clause sql_opt_sort_clause sql_for_locking_clause sql_opt_select_limit {
        $$ = concat(move($1), move($2), move($5), {
            Key::SQL_SELECT_ORDER << $3,
            Key::SQL_SELECT_ROW_LOCKING << ctx.Add(@4, move($4)),
        });
    }
  | sql_with_clause sql_select_clause sql_opt_sort_clause sql_select_limit sql_opt_for_locking_clause {
        $$ = concat(move($1), move($2), move($4), {
            Key::SQL_SELECT_ORDER << $3,
            Key::SQL_SELECT_ROW_LOCKING << ctx.Add(@5, std::move($5)),
        });
    }
    ;

sql_select_clause:
    sql_simple_select       { $$ = $1; }
  | sql_select_with_parens  { $$ = $1; }
    ;

// This rule parses SELECT statements that can appear within set operations,
// including UNION, INTERSECT and EXCEPT.  '(' and ')' can be used to specify
// the ordering of the set operations.    Without '(' and ')' we want the
// operations to be ordered per the precedence specs at the head of this file.
//
// As with select_no_parens, simple_select cannot have outer parentheses,
// but can have parenthesized subclauses.
//
// Note that sort clauses cannot be included at this level --- SQL requires
//        SELECT foo UNION SELECT bar ORDER BY baz
// to be parsed as
//        (SELECT foo UNION SELECT bar) ORDER BY baz
// not
//        SELECT foo UNION (SELECT bar ORDER BY baz)
// Likewise for WITH, FOR UPDATE and LIMIT.  Therefore, those clauses are
// described as part of the select_no_parens production, not simple_select.
// This does not limit functionality, because you can reintroduce these
// clauses inside parentheses.
//
// NOTE: only the leftmost component PGSelectStmt should have INTO.
// However, this is not checked by the grammar; parse analysis must check it.

sql_simple_select:
    SELECT sql_opt_all_clause sql_opt_target_list
        sql_into_clause sql_from_clause sql_where_clause
        sql_group_clause sql_having_clause sql_window_clause sql_sample_clause {
            $$ = {
                Key::SQL_SELECT_ALL << $2,
                Key::SQL_SELECT_TARGETS << ctx.Add(@3, move($3)),
                Key::SQL_SELECT_INTO << $4,
                Key::SQL_SELECT_FROM << ctx.Add(@5, move($5)),
                Key::SQL_SELECT_WHERE << $6,
                Key::SQL_SELECT_GROUPS << ctx.Add(@7, move($7)),
                Key::SQL_SELECT_HAVING << $8,
                Key::SQL_SELECT_WINDOWS << ctx.Add(@9, move($9)),
                Key::SQL_SELECT_SAMPLE << $10,
            };
        }
  | SELECT sql_distinct_clause sql_target_list
        sql_into_clause sql_from_clause sql_where_clause
        sql_group_clause sql_having_clause sql_window_clause sql_sample_clause {
            $$ = {
                Key::SQL_SELECT_DISTINCT << $2,
                Key::SQL_SELECT_TARGETS << ctx.Add(@3, move($3)),
                Key::SQL_SELECT_INTO << $4,
                Key::SQL_SELECT_FROM << ctx.Add(@5, move($5)),
                Key::SQL_SELECT_WHERE << $6,
                Key::SQL_SELECT_GROUPS << ctx.Add(@7, move($7)),
                Key::SQL_SELECT_HAVING << $8,
                Key::SQL_SELECT_WINDOWS << ctx.Add(@9, move($9)),
                Key::SQL_SELECT_SAMPLE << $10,
            };
        }
  | sql_values_clause {
        $$ = { Key::SQL_SELECT_VALUES << ctx.Add(@1, move($1)) };
    }
  | TABLE sql_relation_expr {
        $$ = { Key::SQL_SELECT_TABLE << ctx.Add(@$, sx::NodeType::OBJECT_SQL_TABLE_REF, move($2)) };
    }
  | sql_select_clause UNION sql_all_or_distinct sql_select_clause {
        auto l = ctx.Add(@1, sx::NodeType::OBJECT_SQL_SELECT, move($1));
        auto r = ctx.Add(@4, sx::NodeType::OBJECT_SQL_SELECT, move($4));
        $$ = {
            Key::SQL_COMBINE_OPERATION << Enum(@2, sx::CombineOperation::UNION),
            Key::SQL_COMBINE_MODIFIER << $3,
            Key::SQL_COMBINE_INPUT << ctx.Add(@$, NodeVector{l, r}),
        };
    }
  | sql_select_clause INTERSECT sql_all_or_distinct sql_select_clause {
        auto l = ctx.Add(@1, sx::NodeType::OBJECT_SQL_SELECT, move($1));
        auto r = ctx.Add(@4, sx::NodeType::OBJECT_SQL_SELECT, move($4));
        $$ = {
            Key::SQL_COMBINE_OPERATION << Enum(@2, sx::CombineOperation::INTERSECT),
            Key::SQL_COMBINE_MODIFIER << $3,
            Key::SQL_COMBINE_INPUT << ctx.Add(@$, NodeVector{l, r}),
        };
    }
  | sql_select_clause EXCEPT sql_all_or_distinct sql_select_clause {
        auto l = ctx.Add(@1, sx::NodeType::OBJECT_SQL_SELECT, move($1));
        auto r = ctx.Add(@4, sx::NodeType::OBJECT_SQL_SELECT, move($4));
        $$ = {
            Key::SQL_COMBINE_OPERATION << Enum(@2, sx::CombineOperation::EXCEPT),
            Key::SQL_COMBINE_MODIFIER << $3,
            Key::SQL_COMBINE_INPUT << ctx.Add(@$, NodeVector{l, r}),
        };
    }
    ;

// SQL standard WITH clause looks like:
//
// WITH [ RECURSIVE ] <query name> [ (<column>,...) ]
//        AS (query) [ SEARCH or CYCLE clause ]
//
// We don't currently support the SEARCH or CYCLE clause.
//
// Recognizing WITH_LA here allows a CTE to be named TIME or ORDINALITY.

sql_with_clause:
    WITH sql_cte_list       { $$ = { Key::SQL_SELECT_WITH_CTES << ctx.Add(@2, move($2)) }; }
  | WITH_LA sql_cte_list    { $$ = { Key::SQL_SELECT_WITH_CTES << ctx.Add(@2, move($2)) }; }
  | WITH RECURSIVE sql_cte_list {
        $$ = {
            Key::SQL_SELECT_WITH_RECURSIVE << Bool(@2, true),
            Key::SQL_SELECT_WITH_CTES << ctx.Add(@3, move($3)),
        };
    }
    ;

sql_cte_list:
    sql_common_table_expr                   { $$ = { $1 }; }
  | sql_cte_list ',' sql_common_table_expr  { $1.push_back($3); $$ = move($1); }
    ;

sql_common_table_expr:
    sql_name sql_opt_name_list AS '(' sql_preparable_stmt ')' {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CTE, {
            Key::SQL_CTE_NAME << String(@1),
            Key::SQL_CTE_COLUMNS << ctx.Add(@2, move($2)),
            Key::SQL_CTE_STATEMENT << $5,
        });
    }
    ;

sql_into_clause:
    INTO sql_opt_temp_table_name    { $$ = $2; }
  | %empty                          { $$ = Null(); }
    ;

// XXX PreparableStmt: select | insert | update | delete
sql_preparable_stmt:
    sql_select_stmt                 { $$ = ctx.Add(@1, sx::NodeType::OBJECT_SQL_SELECT, move($1)); }
    ;

// Redundancy here is needed to avoid shift/reduce conflicts,
// since TEMP is not a reserved word.  See also OptTemp.
sql_opt_temp_table_name:
    TEMPORARY sql_opt_table sql_qualified_name          { $$ = Into(ctx, @$, Enum(@1, sx::TempType::DEFAULT), std::move($3)); }
  | TEMP sql_opt_table sql_qualified_name               { $$ = Into(ctx, @$, Enum(@1, sx::TempType::DEFAULT), std::move($3)); }
  | LOCAL TEMPORARY sql_opt_table sql_qualified_name    { $$ = Into(ctx, @$, Enum(@1, sx::TempType::LOCAL), std::move($4)); }
  | LOCAL TEMP sql_opt_table sql_qualified_name         { $$ = Into(ctx, @$, Enum(@1, sx::TempType::LOCAL), std::move($4)); }
  | GLOBAL TEMPORARY sql_opt_table sql_qualified_name   { $$ = Into(ctx, @$, Enum(@1, sx::TempType::GLOBAL), std::move($4)); }
  | GLOBAL TEMP sql_opt_table sql_qualified_name        { $$ = Into(ctx, @$, Enum(@1, sx::TempType::GLOBAL), std::move($4)); }
  | UNLOGGED sql_opt_table sql_qualified_name           { $$ = Into(ctx, @$, Enum(@1, sx::TempType::UNLOGGED), std::move($3)); }
  | TABLE sql_qualified_name                            { $$ = Into(ctx, @$, Enum(@1, sx::TempType::DEFAULT), std::move($2)); }
  | sql_qualified_name                                  { $$ = Into(ctx, @$, Enum(@1, sx::TempType::DEFAULT), std::move($1)); }
    ;

sql_opt_table:
    TABLE       { /* $@ */ }
  | %empty      { /* $@ */ }
    ;

sql_all_or_distinct:
    ALL         { $$ = Enum(@1, sx::CombineModifier::ALL); }
  | DISTINCT    { $$ = Enum(@1, sx::CombineModifier::DISTINCT); }
  | %empty      { $$ = Null(); }
    ;

// We use (NIL) as a placeholder to indicate that all target expressions
// should be placed in the DISTINCT list during parsetree analysis.

sql_distinct_clause:
    DISTINCT                            { $$ = Bool(@1, true); }
  | DISTINCT ON '(' sql_expr_list ')'   { $$ = ctx.Add(@$, move($4)); }
    ;

sql_opt_all_clause:
    ALL                 { $$ = Bool(@1, true); }
  | %empty              { $$ = Null(); }
    ;

sql_opt_sort_clause:
    sql_sort_clause     { $$ = $1; }
  | %empty              { $$ = Null(); }
    ;

sql_sort_clause:
    ORDER BY sql_sortby_list        { $$ = ctx.Add(@$, move($3)); }
    ;

sql_sortby_list:
    sql_sortby                      { $$ = { $1 }; }
  | sql_sortby_list ',' sql_sortby  { $1.push_back($3); $$ = move($1); }
    ;

sql_sortby:
    sql_a_expr USING sql_qual_all_op sql_opt_nulls_order {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_ORDER, {
            Key::SQL_ORDER_VALUE << $1,
            Key::SQL_ORDER_NULLRULE << $4,
        });
    }
  | sql_a_expr sql_opt_asc_desc sql_opt_nulls_order {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_ORDER, {
            Key::SQL_ORDER_VALUE << $1,
            Key::SQL_ORDER_DIRECTION << $2,
            Key::SQL_ORDER_NULLRULE << $3,
        });
    }
    ;

sql_opt_asc_desc:
    ASC_P   { $$ = Enum(@$, sx::OrderDirection::ASCENDING); }
  | DESC_P  { $$ = Enum(@$, sx::OrderDirection::DESCENDING); }
  | %empty  { $$ = Null(); }
    ;

sql_opt_nulls_order:
    NULLS_LA FIRST_P    { $$ = Enum(@$, sx::OrderNullRule::NULLS_FIRST); }
  | NULLS_LA LAST_P     { $$ = Enum(@$, sx::OrderNullRule::NULLS_LAST); }
  | %empty              { $$ = Null(); }
    ;

sql_select_limit:
    sql_limit_clause sql_offset_clause  { $$ = concat(move($1), move($2)); }
  | sql_offset_clause sql_limit_clause  { $$ = concat(move($1), move($2)); }
  | sql_limit_clause                    { $$ = move($1); }
  | sql_offset_clause                   { $$ = move($1); }
    ;

sql_opt_select_limit:
    sql_select_limit  { $$ = std::move($1); }
  | %empty            { $$ = {}; }
    ;

sql_limit_clause:
    LIMIT sql_select_limit_value { $$ = { Key::SQL_SELECT_LIMIT << $2 }; }
  | LIMIT sql_select_limit_value ',' sql_select_offset_value {
        $$ = {
            Key::SQL_SELECT_LIMIT << $2,
            Key::SQL_SELECT_OFFSET << $4,
        };
    }
    // SQL:2008 syntax
    // to avoid shift/reduce conflicts, handle the optional value with
    //   a separate production rather than an opt_ expression.  The fact
    //   that ONLY is fully reserved means that this way, we defer any
    //   decision about what rule reduces ROW or ROWS to the point where
    //   we can see the ONLY token in the lookahead slot.
    //  
  | FETCH sql_first_or_next sql_select_fetch_first_value sql_row_or_rows ONLY {
        $$ = {
            Key::SQL_SELECT_LIMIT << $3,
        };
    }
  | FETCH sql_first_or_next sql_row_or_rows ONLY {
        $$ = {
            Key::SQL_SELECT_LIMIT << UI32(@3, 1),
        };
    }
    ;

sql_offset_clause:
    OFFSET sql_select_offset_value {
        $$ = { Key::SQL_SELECT_OFFSET << $2 };
    }
  | OFFSET sql_select_fetch_first_value sql_row_or_rows {
        $$ = { Key::SQL_SELECT_OFFSET << $2 };
    }
    ;

sql_select_limit_value:
    sql_a_expr  { $$ = $1; }
  | ALL         { $$ = Null(); }
    ;

sql_select_offset_value:
    sql_a_expr  { $$ = $1; }
    ;

// Allowing full expressions without parentheses causes various parsing
// problems with the trailing ROW/ROWS key words.  SQL spec only calls for
// <simple value specification>, which is either a literal or a parameter (but
// an <SQL parameter reference> could be an identifier, bringing up conflicts
// with ROW/ROWS). We solve this by leveraging the presence of ONLY (see above)
// to determine whether the expression is missing rather than trying to make it
// optional in this rule.
//
// c_expr covers almost all the spec-required cases (and more), but it doesn't
// cover signed numeric literals, which are allowed by the spec. So we include
// those here explicitly. We need FCONST as well as ICONST because values that
// don't fit in the platform's "long", but do fit in bigint, should still be
// accepted here. (This is possible in 64-bit Windows as well as all 32-bit
// builds.)

sql_select_fetch_first_value:
    sql_c_expr            { $$ = std::move($1); }
  | '+' sql_i_or_f_const  { $$ = String(@2); }
  | '-' sql_i_or_f_const  { $$ = Negate(ctx, @$, @1, String(@2)); }

        ;

sql_i_or_f_const:
    ICONST  { /* @$ */ }
  | FCONST  { /* @$ */ }
    ;

// noise words
sql_row_or_rows:
    ROW     { /* @$ */ }
  | ROWS    { /* @$ */ }
    ;

sql_first_or_next:
    FIRST_P { /* @$ */ }
  | NEXT    { /* @$ */ }
    ;


// ---------------------------------------------------------------------------
// Group clause

// This syntax for group_clause tries to follow the spec quite closely.
// However, the spec allows only column references, not expressions,
// which introduces an ambiguity between implicit row constructors
// (a,b) and lists of column references.
//
// We handle this by using the a_expr production for what the spec calls
// <ordinary grouping set>, which in the spec represents either one column
// reference or a parenthesized list of column references. Then, we check the
// top node of the a_expr to see if it's an implicit PGRowExpr, and if so, just
// grab and use the list, discarding the node. (this is done in parse analysis,
// not here)
//
// (we abuse the row_format field of PGRowExpr to distinguish implicit and
// explicit row constructors; it's debatable if anyone sanely wants to use them
// in a group clause, but if they have a reason to, we make it possible.)
//
// Each item in the group_clause list is either an expression tree or a
// PGGroupingSet node of some type.

sql_group_clause:
    GROUP_P BY sql_group_by_list    { $$ = move($3); }
  | %empty                          { $$ = {}; }
    ;

sql_group_by_list:
    sql_group_by_item                         { $$ = { $1 }; }
  | sql_group_by_list ',' sql_group_by_item   { $1.push_back($3); $$ = move($1); }
    ;

sql_group_by_item:
    sql_a_expr              { $$ = std::move($1); }
  | sql_empty_grouping_set  { $$ = {}; }
    ;

sql_empty_grouping_set:
    '(' ')'                 { /* @$ */ }
    ;

// These hacks rely on setting precedence of CUBE and ROLLUP below that of '(',
// so that they shift in these rules rather than reducing the conflicting
// unreserved_keyword rule.

sql_having_clause:
    HAVING sql_a_expr   { $$ = $2; }
  | %empty              { $$ = Null(); }
    ;

sql_for_locking_clause:
    sql_for_locking_items   { $$ = std::move($1); }
  | FOR READ_P ONLY         {
        $$ = {
            ctx.Add(@$, sx::NodeType::OBJECT_SQL_ROW_LOCKING, {
                Key::SQL_ROW_LOCKING_STRENGTH << Enum(@1, sx::RowLockingStrength::READ_ONLY),
            })
        };
    }
    ;

sql_opt_for_locking_clause:
    sql_for_locking_clause  { $$ = { ctx.Add(@1, std::move($1)) }; }
  | %empty                  { $$ = {}; }
    ;

sql_for_locking_items:
    sql_for_locking_item                          { $$ = { std::move($1) }; }
  | sql_for_locking_items sql_for_locking_item    { $1.push_back(std::move($2)); $$ = std::move($1); }
    ;

sql_for_locking_item:
    sql_for_locking_strength sql_locked_rels_list sql_opt_nowait_or_skip {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_ROW_LOCKING, {
            Key::SQL_ROW_LOCKING_BLOCK_BEHAVIOR << $3,
            Key::SQL_ROW_LOCKING_OF << ctx.Add(@2, std::move($2)),
            Key::SQL_ROW_LOCKING_STRENGTH << $1,
        });
    }
    ;

sql_for_locking_strength:
    FOR UPDATE          { $$ = Enum(@$, sx::RowLockingStrength::UPDATE); }
  | FOR NO KEY UPDATE   { $$ = Enum(@$, sx::RowLockingStrength::NO_KEY_UPDATE); }
  | FOR SHARE           { $$ = Enum(@$, sx::RowLockingStrength::SHARE); }
  | FOR KEY SHARE       { $$ = Enum(@$, sx::RowLockingStrength::KEY_SHARE); }
    ;

sql_locked_rels_list:
    OF sql_qualified_name_list  { $$ = std::move($2); }
  | %empty                      { $$ = {}; }
    ;


sql_opt_nowait_or_skip:
    NOWAIT        { $$ = Enum(@$, sx::RowLockingBlockBehavior::NOWAIT); }
  | SKIP LOCKED   { $$ = Enum(@$, sx::RowLockingBlockBehavior::SKIP_LOCKED); }
  | %empty        { $$ = Null(); }
    ;

// We should allow ROW '(' expr_list ')' too, but that seems to require
// making VALUES a fully reserved word, which will probably break more apps
// than allowing the noise-word is worth.

sql_values_clause:
    VALUES '(' sql_expr_list ')'                  { $$ = { ctx.Add(@3, move($3)) }; }
  | sql_values_clause ',' '(' sql_expr_list ')'   { $1.push_back(ctx.Add(@4, move($4))); $$ = move($1); }
    ;


// Clauses common to all Optimizable Stmts:
// from_clause      - allow list of both JOIN expressions and table names
// where_clause     - qualifications for joins or restrictions

sql_from_clause:
    FROM sql_from_list  { $$ = move($2); }
  | %empty              { $$ = {}; }
    ;

sql_from_list:
    sql_table_ref                       { $$ = { $1 }; }
  | sql_from_list ',' sql_table_ref     { $1.push_back($3); $$ = move($1); }
    ;

// table_ref is where an alias clause can be attached.
// XXX Andre
sql_table_ref:
    sql_relation_expr sql_opt_alias_clause sql_opt_tablesample_clause {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_TABLE_REF, concat(move($1), {
            Key::SQL_TABLE_ALIAS << $2,
            Key::SQL_TABLE_SAMPLE << $3,
        }));
    }
  | sql_func_table sql_func_alias_clause sql_opt_tablesample_clause {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_FUNCTION_TABLE, concat(move($1), {
            Key::SQL_TABLE_ALIAS << $2,
            Key::SQL_TABLE_SAMPLE << $3,
        }));
    }
  | sql_select_with_parens sql_opt_alias_clause sql_opt_tablesample_clause {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_FUNCTION_TABLE, concat(move($1), {
            Key::SQL_TABLE_ALIAS << $2,
            Key::SQL_TABLE_SAMPLE << $3,
        }));
    }
  | LATERAL_P sql_func_table sql_func_alias_clause {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_LATERAL_FUNCTION_TABLE, concat(std::move($2), {
            Key::SQL_TABLE_ALIAS << $3,
        }));
    }
  | LATERAL_P sql_select_with_parens sql_opt_alias_clause {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_LATERAL_JOIN, concat(std::move($2), {
            Key::SQL_TABLE_ALIAS << $3,
        }));
    }
  | sql_joined_table { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_JOINED_TABLE, std::move($1)); }
  | '(' sql_joined_table ')' sql_alias_clause {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_JOINED_TABLE, concat(std::move($2), {
            Key::SQL_TABLE_ALIAS << $4,
        }));
    }
    ;


// It may seem silly to separate joined_table from table_ref, but there is
// method in SQL's madness: if you don't do it this way you get reduce-
// reduce conflicts, because it's not clear to the parser generator whether
// to expect alias_clause after ')' or not.  For the same reason we must
// treat 'JOIN' and 'join_type JOIN' separately, rather than allowing
// join_type to expand to empty; if we try it, the parser generator can't
// figure out when to reduce an empty join_type right after table_ref.
//
// Note that a CROSS JOIN is the same as an unqualified
// INNER JOIN, and an INNER JOIN/ON has the same shape
// but a qualification expression to limit membership.
// A NATURAL JOIN implicitly matches column names between
// tables and the shape is determined by which columns are
// in common. We'll collect columns during the later transformations.

sql_joined_table:
    '(' sql_joined_table ')' { $$ = std::move($2); }
  | sql_table_ref CROSS JOIN sql_table_ref {
        $$ = {
            Key::SQL_JOIN_TYPE << Enum(Loc({@2, @3}), sx::JoinType::NONE),
            Key::SQL_JOIN_INPUT << ctx.Add(@$, { std::move($1), std::move($4) }),
        };
    }
  | sql_table_ref sql_join_type JOIN sql_table_ref sql_join_qual {
        $$ = concat(std::move($5), {
            Key::SQL_JOIN_TYPE << Enum(Loc({@2, @3}), $2),
            Key::SQL_JOIN_INPUT << ctx.Add(@$, { std::move($1), std::move($4) }),
        });
    }
  | sql_table_ref JOIN sql_table_ref sql_join_qual {
        $$ = concat(std::move($4), {
            Key::SQL_JOIN_TYPE << Enum(@2, sx::JoinType::INNER),
            Key::SQL_JOIN_INPUT << ctx.Add(@$, { std::move($1), std::move($3) }),
        });
   }
  | sql_table_ref NATURAL sql_join_type JOIN sql_table_ref {
        $$ = {
            Key::SQL_JOIN_TYPE << Enum(Loc({@2, @3}), Merge(sx::JoinType::NATURAL_, $3)),
            Key::SQL_JOIN_INPUT << ctx.Add(@$, { std::move($1), std::move($5) }),
        };
    }
  | sql_table_ref NATURAL JOIN sql_table_ref {
        $$ = {
            Key::SQL_JOIN_TYPE << Enum(Loc({@2, @3}), sx::JoinType::NATURAL_INNER),
            Key::SQL_JOIN_INPUT << ctx.Add(@$, { std::move($1), std::move($4) }),
        };
    }
    ;

sql_alias_clause:
    AS sql_col_id '(' sql_name_list ')' {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_ALIAS, {
            Key::SQL_ALIAS_NAME << String(@2),
            Key::SQL_ALIAS_COLUMN_NAMES << ctx.Add(@4, move($4)),
        });
    }
  | AS sql_col_id_or_string { $$ = String(@2); }
  | sql_col_id '(' sql_name_list ')' {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_ALIAS, {
            Key::SQL_ALIAS_NAME << String(@1),
            Key::SQL_ALIAS_COLUMN_NAMES << ctx.Add(@3, move($3)),
        });
    }
  | sql_col_id { $$ = String(@1); }
    ;

sql_opt_alias_clause:
    sql_alias_clause    { $$ = $1; }
  | %empty              { $$ = Null(); }
    ;

// func_alias_clause can include both an PGAlias and a coldeflist, so we make it
// return a 2-element list that gets disassembled by calling production.
sql_func_alias_clause:
    sql_alias_clause { $$ = $1; }
  | AS '(' sql_table_func_element_list ')' {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_ALIAS, {
            Key::SQL_ALIAS_COLUMN_DEFINITIONS << ctx.Add(@3, move($3)),
        });
    }
  | AS sql_col_id '(' sql_table_func_element_list ')' {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_ALIAS, {
            Key::SQL_ALIAS_NAME << String(@2),
            Key::SQL_ALIAS_COLUMN_DEFINITIONS << ctx.Add(@4, move($4)),
        });
    }
  | sql_col_id '(' sql_table_func_element_list ')' ')' {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_ALIAS, {
            Key::SQL_ALIAS_NAME << String(@1),
            Key::SQL_ALIAS_COLUMN_DEFINITIONS << ctx.Add(@3, move($3)),
        });
    }
  | %empty { $$ = Null(); }
    ;

sql_join_type:
    FULL sql_join_outer     { $$ = Merge(sx::JoinType::FULL, $2); }
  | LEFT sql_join_outer     { $$ = Merge(sx::JoinType::LEFT, $2); }
  | RIGHT sql_join_outer    { $$ = Merge(sx::JoinType::RIGHT, $2); }
  | INNER_P                 { $$ = sx::JoinType::INNER; }
    ;

/* OUTER is just noise... */
sql_join_outer:
    OUTER_P                 { $$ = sx::JoinType::OUTER_; }
  | %empty                  { $$ = sx::JoinType::NONE; }
    ;

// JOIN qualification clauses
// Possibilities are:
//    USING ( column list ) allows only unqualified column names,
//                          which must match between tables.
//    ON expr allows more general qualifications.
//
// We return USING as a PGList node, while an ON-expr will not be a List.

sql_join_qual:
    USING '(' sql_name_list ')'   { $$ = { Key::SQL_JOIN_USING << ctx.Add(Loc({@2, @3, @4}), std::move($3)) }; }
  | ON sql_a_expr                 { $$ = { Key::SQL_JOIN_ON << std::move($2) }; }
    ;

sql_relation_expr:
    sql_qualified_name              { $$ = { Key::SQL_TABLE_NAME << std::move($1), Key::SQL_TABLE_INHERIT << Bool(@$, true) }; }
  | sql_qualified_name '*'          { $$ = { Key::SQL_TABLE_NAME << std::move($1), Key::SQL_TABLE_INHERIT << Bool(@2, true) }; }
  | ONLY sql_qualified_name         { $$ = { Key::SQL_TABLE_NAME << std::move($2), Key::SQL_TABLE_INHERIT << Bool(@1, false) }; }
  | ONLY '(' sql_qualified_name ')' { $$ = { Key::SQL_TABLE_NAME << std::move($3), Key::SQL_TABLE_INHERIT << Bool(@1, false) }; }
    ;

// Given "UPDATE foo set set ...", we have to decide without looking any
// further ahead whether the first "set" is an alias or the UPDATE's SET
// keyword.  Since "set" is allowed as a column name both interpretations
// are feasible.  We resolve the shift/reduce conflict by giving the first
// production a higher precedence than the SET token
// has, causing the parser to prefer to reduce, in effect assuming that the
// SET is not an alias.


sql_sample_count:
	  FCONST '%'        { $$ = String(@1); }
	| ICONST '%'        { $$ = String(@1); }
	| FCONST PERCENT    { $$ = String(@1); }
	| ICONST PERCENT    { $$ = String(@1); }
	| ICONST            { $$ = String(@1); }
	| ICONST ROWS       { $$ = String(@1); }
	  ;

sql_sample_clause:
    USING SAMPLE sql_tablesample_entry  { $$ = ctx.Add(@$, std::move($3)); }
  | %empty                              { $$ = Null(); }

sql_opt_sample_func:
    sql_col_id                          { /* @$ */ }
  | %empty                              { /* @$ */ }
		;

sql_tablesample_entry:
	  sql_opt_sample_func '(' sql_sample_count ')' sql_opt_repeatable_clause {
        $$ = {
            Key::SQL_SAMPLE_FUNCTION << String(@1),
            Key::SQL_SAMPLE_COUNT << std::move($3),
            Key::SQL_SAMPLE_REPEAT << std::move($5),
        };
    }
	| sql_sample_count {
        $$ = {
            Key::SQL_SAMPLE_COUNT << std::move($1),
        };
    }
	| sql_sample_count '(' sql_col_id ')' {
        $$ = {
            Key::SQL_SAMPLE_COUNT << std::move($1),
            Key::SQL_SAMPLE_FUNCTION << String(@3),
        };
    }
	| sql_sample_count '(' sql_col_id ',' ICONST ')' {
        $$ = {
            Key::SQL_SAMPLE_COUNT << std::move($1),
            Key::SQL_SAMPLE_FUNCTION << String(@3),
            Key::SQL_SAMPLE_SEED << String(@5),
        };
    }
	  ;

sql_tablesample_clause:
    TABLESAMPLE sql_tablesample_entry {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_TABLE_SAMPLE, std::move($2));
    }
		;

sql_opt_tablesample_clause:
		sql_tablesample_clause      { $$ = std::move($1); }
  | %empty                      { $$ = Null(); }
		;

sql_opt_repeatable_clause:
    REPEATABLE '(' ICONST ')'   { $$ = String(@3); }
  | %empty                      { $$ = Null(); }
		;

// func_table represents a function invocation in a FROM list. It can be
// a plain function call, like "foo(...)", or a ROWS FROM expression with
// one or more function calls, "ROWS FROM (foo(...), bar(...))",
// optionally with WITH ORDINALITY attached.
// In the ROWS FROM syntax, a column list can be given for each
// function, for example:
//     ROWS FROM (foo() AS (foo_res_a text, foo_res_b text),
//                bar() AS (bar_res_a text, bar_res_b text))
// It's also possible to attach a column list to the PGRangeFunction
// as a whole, but that's handled by the table_ref production.

sql_func_table:
    sql_func_expr_windowless sql_opt_ordinality {
        $$ = concat(move($1), {
            Key::SQL_FUNCTION_TABLE_WITH_ORDINALITY << std::move($2),
        });
    }
  | ROWS FROM '(' sql_rowsfrom_list ')' sql_opt_ordinality  {
        $$ = {
            Key::SQL_FUNCTION_TABLE_WITH_ORDINALITY << std::move($6),
            Key::SQL_FUNCTION_TABLE_ROWS_FROM << ctx.Add(@4, std::move($4)),
        };
    }
    ;

sql_rowsfrom_item:
    sql_func_expr_windowless sql_opt_col_def_list {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_ROWSFROM_ITEM, {
            Key::SQL_ROWSFROM_ITEM_FUNCTION << ctx.Add(@1, sx::NodeType::OBJECT_SQL_FUNCTION_EXPRESSION, std::move($1)),
            Key::SQL_ROWSFROM_ITEM_COLUMNS << std::move($2),
        });
    }
    ;

sql_rowsfrom_list:
    sql_rowsfrom_item                         { $$ = { std::move($1) }; }
  | sql_rowsfrom_list ',' sql_rowsfrom_item   { $1.push_back(std::move($3)); $$ = std::move($1); }
    ;

sql_opt_col_def_list:
    AS '(' sql_table_func_element_list ')'    { $$ = ctx.Add(@$, std::move($3)); }
  | %empty                                    { $$ = Null(); }
    ;

sql_opt_ordinality:
    WITH_LA ORDINALITY    { $$ = Bool(@$, true);  }
  | %empty                { $$ = Bool(@$, false); }
    ;


sql_where_clause:
    WHERE sql_a_expr      { $$ = $2; }
  | %empty                { $$ = Null(); }
    ;

/* variant for UPDATE and DELETE */
sql_table_func_element_list:
    sql_table_func_element                                  { $$ = { std::move($1) }; }
  | sql_table_func_element_list ',' sql_table_func_element  { $1.push_back(std::move($3)); $$ = std::move($1); }
    ;

sql_table_func_element:
    sql_col_id sql_typename sql_opt_collate_clause {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_FUNCTION_TABLE_ELEMENT, {
            Key::SQL_FUNCTION_TABLE_ELEMENT_NAME << String(@1),
            Key::SQL_FUNCTION_TABLE_ELEMENT_TYPE << std::move($2),
            Key::SQL_FUNCTION_TABLE_ELEMENT_COLLATE << std::move($3),
        });
    }
    ;

sql_opt_collate_clause:
    COLLATE sql_any_name  { $$ = ctx.Add(@$, std::move($2)); }
  | %empty                { $$ = Null(); }
    ;


// Type syntax
//  SQL introduces a large amount of type-specific syntax.
//  Define individual clauses to handle these cases, and use
//   the generic case to handle regular type-extensible Postgres syntax.
//  - thomas 1997-10-10

sql_typename:
    sql_simple_typename sql_opt_array_bounds {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_TYPENAME, {
            Key::SQL_TYPENAME_TYPE << $1,
            Key::SQL_TYPENAME_ARRAY << ctx.Add(@2, move($2)),
        });
    }
  | SETOF sql_simple_typename sql_opt_array_bounds {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_TYPENAME, {
            Key::SQL_TYPENAME_TYPE << $2,
            Key::SQL_TYPENAME_ARRAY << ctx.Add(@3, move($3)),
            Key::SQL_TYPENAME_SETOF << Bool(@1, true),
        });
    }
    // SQL standard syntax, currently only one-dimensional
  | sql_simple_typename ARRAY '[' ICONST ']' {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_TYPENAME, {
            Key::SQL_TYPENAME_TYPE << $1,
            Key::SQL_TYPENAME_ARRAY << ctx.Add(Loc({@2, @3, @4, @5}), {String(@4)}),
        });
    }
  | SETOF sql_simple_typename ARRAY '[' ICONST ']' {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_TYPENAME, {
            Key::SQL_TYPENAME_TYPE << $2,
            Key::SQL_TYPENAME_ARRAY << ctx.Add(Loc({@3, @4, @5, @6}), {String(@4)}),
            Key::SQL_TYPENAME_SETOF << Bool(@1, true),
        });
    }
  | sql_simple_typename ARRAY {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_TYPENAME, {
            Key::SQL_TYPENAME_TYPE << $1,
            Key::SQL_TYPENAME_ARRAY << ctx.Add(@2, {}, false),
        });
    }
  | SETOF sql_simple_typename ARRAY {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_TYPENAME, {
            Key::SQL_TYPENAME_TYPE << $2,
            Key::SQL_TYPENAME_ARRAY << ctx.Add(@3, {}, false),
            Key::SQL_TYPENAME_SETOF << Bool(@1, true),
        });
    }
    ;

sql_opt_array_bounds:
    sql_opt_array_bounds '[' ']'            { $1.push_back(String(Loc({@2, @3}))); $$ = move($1); }
  | sql_opt_array_bounds '[' ICONST ']'     { $1.push_back(String(Loc({@2, @3, @4}))); $$ = move($1); }
  | %empty                                  { $$ = {}; }
    ;

sql_simple_typename:
    sql_generic_type                    { $$ = $1; }
  | sql_numeric                         { $$ = $1; }
  | sql_bit                             { $$ = $1; }
  | sql_const_character                 { $$ = $1; }
  | sql_const_datetime                  { $$ = $1; }
  | sql_const_interval sql_opt_interval { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_INTERVAL_TYPE, std::move($2), false); }
  | sql_const_interval '(' ICONST ')'   { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_INTERVAL_TYPE, {
        Key::SQL_INTERVAL_PRECISION << String(@3),
    }); }
    ;

// We have a separate ConstTypename to allow defaulting fixed-length
// types such as CHAR() and BIT() to an unspecified length.
// SQL9x requires that these default to a length of one, but this
// makes no sense for constructs like CHAR 'hi' and BIT '0101',
// where there is an obvious better choice to make.
// Note that ConstInterval is not included here since it must
// be pushed up higher in the rules to accommodate the postfix
// options (e.g. INTERVAL '1' YEAR). Likewise, we have to handle
// the generic-type-name case in AExprConst to avoid premature
// reduce/reduce conflicts against function names.

sql_const_typename:
    sql_numeric         { $$ = $1; }
  | sql_const_bit       { $$ = $1; }
  | sql_character       { $$ = $1; }
  | sql_const_datetime  { $$ = $1; }
    ;

// GenericType covers all type names that don't have special syntax mandated
// by the standard, including qualified names.  We also allow type modifiers.
// To avoid parsing conflicts against function invocations, the modifiers
// have to be shown as expr_list here, but parse analysis will only accept
// constants for them.

sql_generic_type:
    sql_type_function_name sql_opt_type_modifiers {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_GENERIC_TYPE, {
            Key::SQL_GENERIC_TYPE_NAME << String(@1),
            Key::SQL_GENERIC_TYPE_MODIFIERS << ctx.Add(@2, std::move($2))
        });
    }
    ;

sql_opt_type_modifiers:
    '(' sql_expr_list ')'   { $$ = $2; }
  | %empty                  { $$ = {}; }
    ;

// SQL numeric data types

sql_numeric:
    INT_P       { $$ = Enum(@1, sx::NumericType::INT4); }
  | INTEGER     { $$ = Enum(@1, sx::NumericType::INT4); }
  | SMALLINT    { $$ = Enum(@1, sx::NumericType::INT2); }
  | BIGINT      { $$ = Enum(@1, sx::NumericType::INT8); }
  | REAL        { $$ = Enum(@1, sx::NumericType::FLOAT4); }
  | FLOAT_P sql_opt_float   { $$ = Enum(@$, $2); }
  | DOUBLE_P PRECISION      { $$ = Enum(@$, sx::NumericType::FLOAT4); }
  | DECIMAL_P sql_opt_type_modifiers {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_NUMERIC_TYPE, {
            Key::SQL_NUMERIC_TYPE << Enum(@1, sx::NumericType::NUMERIC),
            Key::SQL_NUMERIC_TYPE_MODIFIERS << ctx.Add(@2, move($2))
        });
    }
  | DEC sql_opt_type_modifiers {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_NUMERIC_TYPE, {
            Key::SQL_NUMERIC_TYPE << Enum(@1, sx::NumericType::NUMERIC),
            Key::SQL_NUMERIC_TYPE_MODIFIERS << ctx.Add(@2, move($2))
        });
    }
  | NUMERIC sql_opt_type_modifiers {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_NUMERIC_TYPE, {
            Key::SQL_NUMERIC_TYPE << Enum(@1, sx::NumericType::NUMERIC),
            Key::SQL_NUMERIC_TYPE_MODIFIERS << ctx.Add(@2, move($2))
        });
    }
  | BOOLEAN_P   { $$ = Enum(@1, sx::NumericType::BOOL); }
    ;

sql_opt_float:
    '(' ICONST ')'  { $$ = ReadFloatType(ctx, @2); }
  | %empty          { $$ = sx::NumericType::FLOAT4; }
    ;

// SQL bit-field data types
// The following implements BIT() and BIT VARYING().

sql_bit:
    sql_bit_with_length     { $$ = std::move($1); }
  | sql_bit_without_length  { $$ = std::move($1); }
    ;

// ConstBit is like Bit except "BIT" defaults to unspecified length
// See notes for ConstCharacter, which addresses same issue for "CHAR"
// Andre: XXX Relevant for DashQL?

sql_const_bit:
    sql_bit_with_length     { $$ = std::move($1); }
  | sql_bit_without_length  { $$ = std::move($1); }
    ;

sql_bit_with_length:
    BIT sql_opt_varying '(' sql_a_expr ')' {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_BIT_TYPE, {
            Key::SQL_BIT_TYPE_VARYING << Bool(@2, $2),
            Key::SQL_BIT_TYPE_LENGTH << std::move($4),
        });
    }
    ;

sql_bit_without_length:
    BIT sql_opt_varying {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_BIT_TYPE, {
            Key::SQL_BIT_TYPE_VARYING << Bool(@2, $2)
        });
    }
    ;


// SQL character data types
// The following implements CHAR() and VARCHAR().

sql_character:
    sql_character_with_length     { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CHARACTER_TYPE, move($1)); }
  | sql_character_without_length  { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CHARACTER_TYPE, move($1)); }
    ;

sql_const_character:
    sql_character_with_length     { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CHARACTER_TYPE, move($1)); }
  | sql_character_without_length  { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CHARACTER_TYPE, move($1)); }
    ;

sql_character_with_length:
    sql_character_without_length '(' ICONST ')'  { $1.push_back(Key::SQL_CHARACTER_TYPE_LENGTH << String(@3)); $$ = move($1); }
    ;

sql_character_without_length:
    CHARACTER sql_opt_varying           { $$ = NodeVector{ Key::SQL_CHARACTER_TYPE << Enum(@$, $2 ? sx::CharacterType::VARCHAR : sx::CharacterType::BLANK_PADDED_CHAR) }; }
  | CHAR_P sql_opt_varying              { $$ = NodeVector{ Key::SQL_CHARACTER_TYPE << Enum(@$, $2 ? sx::CharacterType::VARCHAR : sx::CharacterType::BLANK_PADDED_CHAR) }; }
  | VARCHAR                             { $$ = NodeVector{ Key::SQL_CHARACTER_TYPE << Enum(@$, sx::CharacterType::VARCHAR) }; }
  | NATIONAL CHARACTER sql_opt_varying  { $$ = NodeVector{ Key::SQL_CHARACTER_TYPE << Enum(@$, $3 ? sx::CharacterType::VARCHAR : sx::CharacterType::BLANK_PADDED_CHAR) }; }
  | NATIONAL CHAR_P sql_opt_varying     { $$ = NodeVector{ Key::SQL_CHARACTER_TYPE << Enum(@$, $3 ? sx::CharacterType::VARCHAR : sx::CharacterType::BLANK_PADDED_CHAR) }; }
  | NCHAR sql_opt_varying               { $$ = NodeVector{ Key::SQL_CHARACTER_TYPE << Enum(@$, $2 ? sx::CharacterType::VARCHAR : sx::CharacterType::BLANK_PADDED_CHAR) }; }
    ;

sql_opt_varying:
    VARYING       { $$ = true; }
  | %empty        { $$ = false; }
    ;

// SQL date/time types

sql_const_datetime:
    TIMESTAMP '(' ICONST ')' sql_opt_timezone {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_TIMESTAMP_TYPE, {
            Key::SQL_TIME_TYPE_PRECISION << String(@3),
            Key::SQL_TIME_TYPE_WITH_TIMEZONE << std::move($5),
        });
    }
  | TIMESTAMP sql_opt_timezone {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_TIMESTAMP_TYPE, {
            Key::SQL_TIME_TYPE_WITH_TIMEZONE << std::move($2),
        });
    }
  | TIME '(' ICONST ')' sql_opt_timezone {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_TIME_TYPE, {
            Key::SQL_TIME_TYPE_PRECISION << String(@3),
            Key::SQL_TIME_TYPE_WITH_TIMEZONE << std::move($5),
        });
   }
  | TIME sql_opt_timezone {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_TIME_TYPE, {
            Key::SQL_TIME_TYPE_WITH_TIMEZONE << std::move($2),
        });
   }
    ;

sql_const_interval:
    INTERVAL          { /* @$ */ }
    ;

sql_opt_timezone:
    WITH_LA TIME ZONE { $$ = Bool(@$, true); }
  | WITHOUT TIME ZONE { $$ = Bool(@$, false); }
  | %empty            { $$ = Null(); }
    ;

sql_opt_interval:
    YEAR_P    { $$ = { Key::SQL_INTERVAL_TYPE << Enum(@$, sx::IntervalType::YEAR) }; }
  | MONTH_P   { $$ = { Key::SQL_INTERVAL_TYPE << Enum(@$, sx::IntervalType::MONTH) }; }
  | DAY_P     { $$ = { Key::SQL_INTERVAL_TYPE << Enum(@$, sx::IntervalType::DAY) }; }
  | HOUR_P    { $$ = { Key::SQL_INTERVAL_TYPE << Enum(@$, sx::IntervalType::HOUR) }; }
  | MINUTE_P  { $$ = { Key::SQL_INTERVAL_TYPE << Enum(@$, sx::IntervalType::MINUTE) }; }
  | sql_interval_second {
        $$ = {
            Key::SQL_INTERVAL_TYPE << Enum(@$, sx::IntervalType::SECOND),
            Key::SQL_INTERVAL_PRECISION << std::move($1)
        };
  }
  | YEAR_P TO MONTH_P     { $$ = { Key::SQL_INTERVAL_TYPE << Enum(@$, sx::IntervalType::YEAR_TO_MONTH) }; }
  | DAY_P TO HOUR_P       { $$ = { Key::SQL_INTERVAL_TYPE << Enum(@$, sx::IntervalType::DAY_TO_HOUR) }; }
  | DAY_P TO MINUTE_P     { $$ = { Key::SQL_INTERVAL_TYPE << Enum(@$, sx::IntervalType::DAY_TO_MINUTE) }; }
  | DAY_P TO sql_interval_second {
        $$ = {
            Key::SQL_INTERVAL_TYPE << Enum(@$, sx::IntervalType::DAY_TO_SECOND),
            Key::SQL_INTERVAL_PRECISION << std::move($3)
        };
  }
  | HOUR_P TO MINUTE_P    { $$ = { Key::SQL_INTERVAL_TYPE << Enum(@$, sx::IntervalType::HOUR_TO_MINUTE) }; }
  | HOUR_P TO sql_interval_second {
        $$ = {
            Key::SQL_INTERVAL_TYPE << Enum(@$, sx::IntervalType::HOUR_TO_SECOND),
            Key::SQL_INTERVAL_PRECISION << std::move($3)
        };
  }
  | MINUTE_P TO sql_interval_second {
        $$ = {
            Key::SQL_INTERVAL_TYPE << Enum(@$, sx::IntervalType::MINUTE_TO_SECOND),
            Key::SQL_INTERVAL_PRECISION << std::move($3)
        };
  }
  | %empty  { $$ = { }; }
    ;

sql_interval_second:
    SECOND_P                { $$ = Null(); }
  | SECOND_P '(' ICONST ')' { $$ = String(@3); }
    ;


// ---------------------------------------------------------------------------
// Expression grammar

// General expressions
// This is the heart of the expression syntax.
//
// We have two expression types: a_expr is the unrestricted kind, and
// b_expr is a subset that must be used in some places to avoid shift/reduce
// conflicts.  For example, we can't do BETWEEN as "BETWEEN a_expr AND a_expr"
// because that use of AND conflicts with AND as a boolean operator.  So,
// b_expr is used in BETWEEN and we remove boolean keywords from b_expr.
//
// Note that '(' a_expr ')' is a b_expr, so an unrestricted expression can
// always be used by surrounding it with parens.
//
// c_expr is all the productions that are common to a_expr and b_expr;
// it's factored out just to eliminate redundant coding.
//
// Be careful of productions involving more than one terminal token.
// By default, bison will assign such productions the precedence of their
// last terminal, but in nearly all cases you want it to be the precedence
// of the first terminal instead; otherwise you will not get the behavior
// you expect!  So we use %prec annotations freely to set precedences.

sql_a_expr:
    sql_c_expr                                                  { $$ = $1; }
  | sql_a_expr TYPECAST sql_typename                            { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::TYPECAST), $1, $3); }
  | sql_a_expr COLLATE sql_any_name                             { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::COLLATE), $1, ctx.Add(@3, std::move($3))); }
  | sql_a_expr AT TIME ZONE sql_a_expr      %prec AT            { $$ = Expr(ctx, @$, Enum(Loc({@2, @3, @4}), ExprFunc::AT_TIMEZONE), $1, $5); }

  // These operators must be called out explicitly in order to make use
  // of bison's automatic operator-precedence handling.  All other
  // operator names are handled by the generic productions using "Op",
  // below; and all those operators will have the same precedence.
  // 
  // If you add more explicitly-known operators, be sure to add them
  // also to b_expr and to the ExpressionOperator list below.

  | '+' sql_a_expr %prec UMINUS { $$ = $2; }
  | '-' sql_a_expr %prec UMINUS { $$ = Negate(ctx, @$, @1, $2); }
  | sql_a_expr '+' sql_a_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::PLUS), $1, $3); }
  | sql_a_expr '-' sql_a_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::MINUS), $1, $3); }
  | sql_a_expr '*' sql_a_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::MULTIPLY), $1, $3); }
  | sql_a_expr '/' sql_a_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::DIVIDE), $1, $3); }
  | sql_a_expr '%' sql_a_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::MODULUS), $1, $3); }
  | sql_a_expr '^' sql_a_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::XOR), $1, $3); }
  | sql_a_expr '<' sql_a_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::LESS_THAN), $1, $3); }
  | sql_a_expr '>' sql_a_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::GREATER_THAN), $1, $3); }
  | sql_a_expr '=' sql_a_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::EQUAL), $1, $3); }
  | sql_a_expr LESS_EQUALS sql_a_expr       { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::LESS_EQUAL), $1, $3); }
  | sql_a_expr GREATER_EQUALS sql_a_expr    { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::GREATER_EQUAL), $1, $3); }
  | sql_a_expr NOT_EQUALS sql_a_expr        { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::NOT_EQUAL), $1, $3); }
  | sql_a_expr sql_qual_op sql_a_expr   %prec Op          { $$ = Expr(ctx, @$, $2, $1, $3); }
  | sql_qual_op sql_a_expr              %prec Op          { $$ = Expr(ctx, @$, $1, $2); }
  | sql_a_expr sql_qual_op              %prec POSTFIXOP   { $$ = Expr(ctx, @$, $2, $1, PostFix); }
  | sql_a_expr AND sql_a_expr               { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::AND), $1, $3); }
  | sql_a_expr OR sql_a_expr                { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::OR), $1, $3); }
  | NOT sql_a_expr                          { $$ = Expr(ctx, @$, Enum(@1, ExprFunc::NOT), $2); }
  | NOT_LA sql_a_expr   %prec NOT           { $$ = Expr(ctx, @$, Enum(@1, ExprFunc::NOT), $2); }
  | sql_a_expr GLOB sql_a_expr  %prec GLOB  { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::GLOB), $1, $3); }
  | sql_a_expr LIKE sql_a_expr                                              { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::LIKE), $1, $3); }
  | sql_a_expr LIKE sql_a_expr ESCAPE sql_a_expr            %prec LIKE      { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::LIKE), $1, $3, $5); }
  | sql_a_expr NOT_LA LIKE sql_a_expr                       %prec NOT_LA    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3}), ExprFunc::NOT_LIKE), $1, $4); }
  | sql_a_expr NOT_LA LIKE sql_a_expr ESCAPE sql_a_expr     %prec NOT_LA    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3}), ExprFunc::NOT_LIKE), $1, $4, $6); }
  | sql_a_expr ILIKE sql_a_expr                                             { $$ = Expr(ctx, @$, Enum(@3, ExprFunc::ILIKE), $1, $3); }
  | sql_a_expr ILIKE sql_a_expr ESCAPE sql_a_expr           %prec ILIKE     { $$ = Expr(ctx, @$, Enum(@3, ExprFunc::ILIKE), $1, $3, $5); }
  | sql_a_expr NOT_LA ILIKE sql_a_expr                      %prec NOT_LA    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3}), ExprFunc::NOT_ILIKE), $1, $4); }
  | sql_a_expr NOT_LA ILIKE sql_a_expr ESCAPE sql_a_expr    %prec NOT_LA    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3}), ExprFunc::NOT_ILIKE), $1, $4, $6); }
  | sql_a_expr SIMILAR TO sql_a_expr                        %prec SIMILAR   { $$ = Expr(ctx, @$, Enum(Loc({@2, @3}), ExprFunc::SIMILAR_TO), $1, $4); }
  | sql_a_expr SIMILAR TO sql_a_expr ESCAPE sql_a_expr      %prec SIMILAR   { $$ = Expr(ctx, @$, Enum(Loc({@2, @3}), ExprFunc::SIMILAR_TO), $1, $4, $6); }
  | sql_a_expr NOT_LA SIMILAR TO sql_a_expr                 %prec NOT_LA    { $$ = Expr(ctx, @$, Enum(Loc({@3, @4}), ExprFunc::NOT_SIMILAR_TO), $1, $5); }
  | sql_a_expr NOT_LA SIMILAR TO sql_a_expr ESCAPE sql_a_expr     %prec NOT_LA  { $$ = Expr(ctx, @$, Enum(Loc({@3, @4}), ExprFunc::NOT_SIMILAR_TO), $1, $5, $7); }

  | sql_a_expr IS NULL_P        %prec IS    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3}), ExprFunc::IS_NULL), $1); }
  | sql_a_expr ISNULL                       { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::IS_NULL), $1); }
  | sql_a_expr IS NOT NULL_P    %prec IS    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3, @4}), ExprFunc::NOT_NULL), $1); }
  | sql_a_expr NOT NULL_P                   { $$ = Expr(ctx, @$, Enum(Loc({@2, @3}), ExprFunc::NOT_NULL), $1); }
  | sql_a_expr NOTNULL                      { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::NOT_NULL), $1); }

  | sql_row OVERLAPS sql_row { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::OVERLAPS), ctx.Add(@1, std::move($1), false), ctx.Add(@3, std::move($3), false)); }
  | sql_a_expr IS TRUE_P                            %prec IS    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3}), ExprFunc::IS_TRUE), $1); }
  | sql_a_expr IS NOT TRUE_P                        %prec IS    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3, @4}), ExprFunc::IS_NOT_TRUE), $1); }
  | sql_a_expr IS FALSE_P                           %prec IS    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3}), ExprFunc::IS_FALSE), $1); }
  | sql_a_expr IS NOT FALSE_P                       %prec IS    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3, @4}), ExprFunc::IS_NOT_FALSE), $1); }
  | sql_a_expr IS UNKNOWN                           %prec IS    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3}), ExprFunc::IS_UNKNOWN), $1); }
  | sql_a_expr IS NOT UNKNOWN                       %prec IS    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3, @4}), ExprFunc::IS_NOT_UNKNOWN), $1); }
  | sql_a_expr IS DISTINCT FROM sql_a_expr          %prec IS    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3, @4}), ExprFunc::IS_DISTINCT_FROM), $1, $5); }
  | sql_a_expr IS NOT DISTINCT FROM sql_a_expr      %prec IS    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3, @4, @5}), ExprFunc::IS_NOT_DISTINCT_FROM), $1, $6); }
  | sql_a_expr IS OF '(' sql_type_list ')'          %prec IS    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3}), ExprFunc::IS_OF), $1, ctx.Add(@5, move($5))); }
  | sql_a_expr IS NOT OF '(' sql_type_list ')'      %prec IS    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3, @4}), ExprFunc::IS_NOT_OF), $1, ctx.Add(@6, move($6))); }

  | sql_a_expr BETWEEN sql_opt_asymmetric sql_b_expr AND sql_a_expr         %prec BETWEEN   { $$ = Expr(ctx, @$, Enum(Loc({@2, @3}), $3 ? ExprFunc::BETWEEN_ASYMMETRIC : ExprFunc::BETWEEN_SYMMETRIC), $1, $4, $6); }
  | sql_a_expr NOT_LA BETWEEN sql_opt_asymmetric sql_b_expr AND sql_a_expr  %prec NOT_LA    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3, @4}), $4 ? ExprFunc::NOT_BETWEEN_ASYMMETRIC : ExprFunc::NOT_BETWEEN_SYMMETRIC), $1, $5, $7); }
  | sql_a_expr BETWEEN SYMMETRIC sql_b_expr AND sql_a_expr                  %prec BETWEEN   { $$ = Expr(ctx, @$, Enum(Loc({@2, @3}), ExprFunc::BETWEEN_SYMMETRIC), $1, $4, $6); }
  | sql_a_expr NOT_LA BETWEEN SYMMETRIC sql_b_expr AND sql_a_expr           %prec NOT_LA    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3, @4}), ExprFunc::NOT_BETWEEN_SYMMETRIC), $1, $5, $7); }
  | sql_a_expr IN_P sql_in_expr                                                             { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::IN), $1, $3); }
  | sql_a_expr NOT_LA IN_P sql_in_expr                                %prec NOT_LA          { $$ = Expr(ctx, @$, Enum(Loc({@2, @3}), ExprFunc::NOT_IN), $1, $4); }
  | sql_a_expr sql_subquery_op sql_subquery_quantifier sql_select_with_parens    %prec Op {
        auto op = ctx.Add(Loc({@2, @3}), sx::NodeType::OBJECT_SQL_SUBQUERY_OPERATOR, {
            Key::SQL_SUBQUERY_OPERATOR << std::move($2),
            Key::SQL_SUBQUERY_QUANTIFIER << std::move($3),
        });
        auto a2 = ctx.Add(@4, sx::NodeType::OBJECT_SQL_SELECT_EXPRESSION, std::move($4));
        $$ = Expr(ctx, @$, std::move(op), std::move($1), std::move(a2));
    }
  | sql_a_expr sql_subquery_op sql_subquery_quantifier '(' sql_a_expr ')'        %prec Op {
        auto op = ctx.Add(Loc({@2, @3}), sx::NodeType::OBJECT_SQL_SUBQUERY_OPERATOR, {
            Key::SQL_SUBQUERY_OPERATOR << std::move($2),
            Key::SQL_SUBQUERY_QUANTIFIER << std::move($3),
        });
        $$ = Expr(ctx, @$, std::move(op), std::move($1), std::move($5));
    }
  | DEFAULT { $$ = Expr(ctx, @$, Enum(@1, ExprFunc::DEFAULT)); }
    ;

// Restricted expressions
//
// b_expr is a subset of the complete expression syntax defined by a_expr.
//
// Presently, AND, NOT, IS, and IN are the a_expr keywords that would
// cause trouble in the places where b_expr is used.  For simplicity, we
// just eliminate all the boolean-keyword-operator productions from b_expr.

sql_b_expr:
    sql_c_expr                                        { $$ = std::move($1); }
  | sql_b_expr TYPECAST sql_typename                  { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::TYPECAST), $1, $3); }
  | '+' sql_b_expr                      %prec UMINUS  { $$ = $2; }
  | '-' sql_b_expr                      %prec UMINUS  { $$ = Negate(ctx, @$, @1, $2); }
  | sql_b_expr '+' sql_b_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::PLUS), $1, $3); }
  | sql_b_expr '-' sql_b_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::MINUS), $1, $3); }
  | sql_b_expr '*' sql_b_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::MULTIPLY), $1, $3); }
  | sql_b_expr '/' sql_b_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::DIVIDE), $1, $3); }
  | sql_b_expr '%' sql_b_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::MODULUS), $1, $3); }
  | sql_b_expr '^' sql_b_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::XOR), $1, $3); }
  | sql_b_expr '<' sql_b_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::LESS_THAN), $1, $3); }
  | sql_b_expr '>' sql_b_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::GREATER_THAN), $1, $3); }
  | sql_b_expr '=' sql_b_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::EQUAL), $1, $3); }
  | sql_b_expr LESS_EQUALS sql_b_expr      { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::LESS_EQUAL), $1, $3); }
  | sql_b_expr GREATER_EQUALS sql_b_expr   { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::GREATER_EQUAL), $1, $3); }
  | sql_b_expr NOT_EQUALS sql_b_expr       { $$ = Expr(ctx, @$, Enum(@2, ExprFunc::NOT_EQUAL), $1, $3); }
  | sql_b_expr sql_qual_op sql_b_expr   %prec Op          { $$ = Expr(ctx, @$, $2, $1, $3); }
  | sql_qual_op sql_b_expr              %prec Op          { $$ = Expr(ctx, @$, $1, $2); }
  | sql_b_expr sql_qual_op              %prec POSTFIXOP   { $$ = Expr(ctx, @$, $2, $1, PostFix); }
  | sql_b_expr IS DISTINCT FROM sql_b_expr          %prec IS    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3, @4}), ExprFunc::IS_DISTINCT_FROM), $1, $5); }
  | sql_b_expr IS NOT DISTINCT FROM sql_b_expr      %prec IS    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3, @4, @5}), ExprFunc::IS_NOT_DISTINCT_FROM), $1, $6); }
  | sql_b_expr IS OF '(' sql_type_list ')'          %prec IS    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3}), ExprFunc::IS_OF), $1, ctx.Add(@5, move($5))); }
  | sql_b_expr IS NOT OF '(' sql_type_list ')'      %prec IS    { $$ = Expr(ctx, @$, Enum(Loc({@2, @3, @4}), ExprFunc::IS_NOT_OF), $1, ctx.Add(@6, move($6))); }
    ;

// Productions that can be used in both a_expr and b_expr.
//
// Note: productions that refer recursively to a_expr or b_expr mostly
// cannot appear here.    However, it's OK to refer to a_exprs that occur
// inside parentheses, such as function arguments; that cannot introduce
// ambiguity to the b_expr syntax.

sql_c_expr:
    sql_columnref     { $$ = $1; }
  | sql_a_expr_const  { $$ = $1; }
  | '?' sql_opt_indirection {
      $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_PARAMETER_REF, {
          Key::SQL_PARAMETER_NAME << String(@1),
          Key::SQL_PARAMETER_INDIRECTION << ctx.Add(@2, std::move($2))
      });
  }
  | PARAM sql_opt_indirection {
      $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_PARAMETER_REF, {
          Key::SQL_PARAMETER_NAME << String(@1),
          Key::SQL_PARAMETER_INDIRECTION << ctx.Add(@2, std::move($2)),
      });
  }
  | '(' sql_a_expr ')' sql_opt_indirection {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_INDIRECTION, {
            Key::SQL_INDIRECTION_VALUE << std::move($2),
            Key::SQL_INDIRECTION_PATH << ctx.Add(@4, std::move($4)),
        });
    }
  | sql_case_expr                             { $$ = $1; }
  | sql_func_expr                             { $$ = $1; }
  | sql_select_with_parens      %prec UMINUS  { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_SELECT_EXPRESSION, std::move($1)); }
  | sql_select_with_parens sql_indirection {
      $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_SELECT_EXPRESSION, concat(std::move($1), {
          Key::SQL_RESULT_INDIRECTION << ctx.Add(@2, std::move($2))
      }));
    }
  | EXISTS sql_select_with_parens { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_EXISTS_EXPRESSION, std::move($2)); }
    ;

sql_func_application:
    sql_func_name '(' ')' { $$ = { Key::SQL_FUNCTION_NAME << String(@1) }; }
  | sql_func_name '(' sql_func_arg_list sql_opt_sort_clause ')' {
        $$ = {
            Key::SQL_FUNCTION_NAME << String(@1),
            Key::SQL_FUNCTION_ARGUMENTS << ctx.Add(@3, move($3)),
            Key::SQL_FUNCTION_ORDER << $4,
        };
    }
  | sql_func_name '(' VARIADIC sql_func_arg_expr sql_opt_sort_clause ')' {
        $$ = {
            Key::SQL_FUNCTION_NAME << String(@1),
            Key::SQL_FUNCTION_VARIADIC << $4,
            Key::SQL_FUNCTION_ORDER << $5,
        };
    }
  | sql_func_name '(' sql_func_arg_list ',' VARIADIC sql_func_arg_expr sql_opt_sort_clause ')' {
        $$ = {
            Key::SQL_FUNCTION_NAME << String(@1),
            Key::SQL_FUNCTION_ARGUMENTS << ctx.Add(@3, move($3)),
            Key::SQL_FUNCTION_VARIADIC << $6,
            Key::SQL_FUNCTION_ORDER << $7,
        };
    }
  | sql_func_name '(' ALL sql_func_arg_list sql_opt_sort_clause ')' {
        $$ = {
            Key::SQL_FUNCTION_NAME << String(@1),
            Key::SQL_FUNCTION_ALL << Bool(@3, true),
            Key::SQL_FUNCTION_ARGUMENTS << ctx.Add(@4, move($4)),
            Key::SQL_FUNCTION_ORDER << $5,
        };
    }
  | sql_func_name '(' DISTINCT sql_func_arg_list sql_opt_sort_clause ')' {
        $$ = {
            Key::SQL_FUNCTION_NAME << String(@1),
            Key::SQL_FUNCTION_DISTINCT << Bool(@3, true),
            Key::SQL_FUNCTION_ARGUMENTS << ctx.Add(@4, move($4)),
            Key::SQL_FUNCTION_ORDER << $5,
        };
    }
  | sql_func_name '(' '*' ')' {
        $$ = {
            Key::SQL_FUNCTION_NAME << String(@1),
            Key::SQL_FUNCTION_ARGUMENTS << ctx.Add(@3, { String(@3) }),
        };
    }
    ;


// func_expr and its cousin func_expr_windowless are split out from c_expr just
// so that we have classifications for "everything that is a function call or
// looks like one".  This isn't very important, but it saves us having to
// document which variants are legal in places like "FROM function()" or the
// backwards-compatible functional-index syntax for CREATE INDEX.
// (Note that many of the special SQL functions wouldn't actually make any
// sense as functional index entries, but we ignore that consideration here.)

sql_func_expr:
    sql_func_application sql_within_group_clause sql_filter_clause sql_over_clause {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_FUNCTION_EXPRESSION, concat(std::move($1), {
              Key::SQL_FUNCTION_WITHIN_GROUP << std::move($2),
              Key::SQL_FUNCTION_FILTER << std::move($3),
              Key::SQL_FUNCTION_OVER << std::move($4),
        }));
    }
  | sql_func_expr_common_subexpr { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_FUNCTION_EXPRESSION, std::move($1)); }
        ;

// As func_expr but does not accept WINDOW functions directly
// (but they can still be contained in arguments for functions etc).
// Use this when window expressions are not allowed, where needed to
// disambiguate the grammar (e.g. in CREATE INDEX).

sql_func_expr_windowless:
    sql_func_application            { $$ = std::move($1); }
  | sql_func_expr_common_subexpr    { $$ = std::move($1); }
    ;

// Special expressions that are considered to be functions.

sql_func_expr_common_subexpr:
    COLLATION FOR '(' sql_a_expr ')' {
        $$ = {
            Key::SQL_FUNCTION_NAME << Enum(Loc({@1, @2}), sx::KnownFunction::COLLATION_FOR),
            Key::SQL_FUNCTION_ARGUMENTS << ctx.Add(Loc({@1, @2, @3}), { std::move(std::move($4)) })
        };
    }
  | CURRENT_DATE        { $$ = { Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::CURRENT_DATE) }; }
  | CURRENT_TIME        { $$ = { Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::CURRENT_TIME) }; }
  | CURRENT_TIMESTAMP   { $$ = { Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::CURRENT_TIMESTAMP) }; }
  | LOCALTIME           { $$ = { Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::LOCALTIME) }; }
  | LOCALTIMESTAMP      { $$ = { Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::LOCALTIMESTAMP) }; }
  | CURRENT_TIME '(' ICONST ')' {
        $$ = {
            Key::SQL_FUNCTION_NAME << Enum(Loc({@1, @2}), sx::KnownFunction::CURRENT_DATE),
            Key::SQL_FUNCTION_ARGUMENTS << ctx.Add(Loc({@2, @3, @4}), { String(@3) })
        };
    }
  | CURRENT_TIMESTAMP '(' ICONST ')' {
        $$ = {
            Key::SQL_FUNCTION_NAME << Enum(Loc({@1, @2}), sx::KnownFunction::CURRENT_TIMESTAMP),
            Key::SQL_FUNCTION_ARGUMENTS << ctx.Add(Loc({@2, @3, @4}), { String(@3) })
        };
    }
  | LOCALTIME '(' ICONST ')' {
        $$ = {
            Key::SQL_FUNCTION_NAME << Enum(Loc({@1, @2}), sx::KnownFunction::LOCALTIME),
            Key::SQL_FUNCTION_ARGUMENTS << ctx.Add(Loc({@2, @3, @4}), { String(@3) })
        };
    }
  | LOCALTIMESTAMP '(' ICONST ')' {
        $$ = {
            Key::SQL_FUNCTION_NAME << Enum(Loc({@1, @2}), sx::KnownFunction::LOCALTIMESTAMP),
            Key::SQL_FUNCTION_ARGUMENTS << ctx.Add(Loc({@2, @3, @4}), { String(@3) })
        };
    }
  | CURRENT_ROLE    { $$ = { Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::CURRENT_ROLE) }; }
  | CURRENT_USER    { $$ = { Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::CURRENT_USER) }; }
  | SESSION_USER    { $$ = { Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::SESSION_USER) }; }
  | USER            { $$ = { Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::USER) }; }
  | CURRENT_CATALOG { $$ = { Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::CURRENT_CATALOG) }; }
  | CURRENT_SCHEMA  { $$ = { Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::CURRENT_SCHEMA) }; }
  | CAST '(' sql_a_expr AS sql_typename ')' {
        $$ = {
            Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::CAST),
            Key::SQL_FUNCTION_ARGUMENTS << ctx.Add(Loc({@2, @3, @4, @5, @6}), { std::move($3), std::move($5) })
        };
    }
  | EXTRACT '(' sql_extract_list ')' {
        $$ = concat(std::move($3), {
            Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::EXTRACT),
        });
    }
  | OVERLAY '(' sql_overlay_list ')' {
        $$ = concat(std::move($3), {
            Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::OVERLAY),
        });
    }
  | POSITION '(' sql_position_list ')' {
        $$ = concat(std::move($3), {
            Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::POSITION),
        });
    }
  | SUBSTRING '(' sql_substr_list ')' {
        $$ = concat(std::move($3), {
            Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::SUBSTRING),
        });
    }
  | TRIM '(' BOTH sql_trim_list ')' {
        $$ = concat(std::move($4), {
            Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::TRIM),
            Key::SQL_FUNCTION_TRIM_DIRECTION << Enum(@3, sx::TrimDirection::BOTH)
        });
    }
  | TRIM '(' LEADING sql_trim_list ')' {
        $$ = concat(std::move($4), {
            Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::TRIM),
            Key::SQL_FUNCTION_TRIM_DIRECTION << Enum(@3, sx::TrimDirection::LEADING)
        });
    }
  | TRIM '(' TRAILING sql_trim_list ')' {
        $$ = concat(std::move($4), {
            Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::TRIM),
            Key::SQL_FUNCTION_TRIM_DIRECTION << Enum(@3, sx::TrimDirection::TRAILING)
        });
    }
  | TRIM '(' sql_trim_list ')' {
        $$ = concat(std::move($3), { Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::TRIM) });
    }
  | TREAT '(' sql_a_expr AS sql_typename ')' {
        $$ = {
            Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::TREAT),
            Key::SQL_FUNCTION_ARGUMENTS << ctx.Add(Loc({@2, @3, @4, @5, @6}), { std::move($3), std::move($5) })
        };
    }
  | NULLIF '(' sql_a_expr ',' sql_a_expr ')' {
        $$ = {
            Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::NULLIF),
            Key::SQL_FUNCTION_ARGUMENTS << ctx.Add(Loc({@2, @3, @4, @5, @6}), { std::move($3), std::move($5) })
        };
    }
  | COALESCE '(' sql_expr_list ')' {
        $$ = {
            Key::SQL_FUNCTION_NAME << Enum(@1, sx::KnownFunction::NULLIF),
            Key::SQL_FUNCTION_ARGUMENTS << ctx.Add(Loc({@2, @3, @4}), std::move($3)),
        };
    }
    ;

// We allow several variants for SQL and other compatibility. */
//
// Aggregate decoration clauses

sql_within_group_clause:
    WITHIN GROUP_P '(' sql_sort_clause ')'  { $$ = std::move($4); }
  | %empty                                  { $$ = Null(); }
    ;

sql_filter_clause:
    FILTER '(' WHERE sql_a_expr ')'   { $$ = std::move($4); }
  | %empty                            { $$ = Null(); }
    ;


// Window Definitions

sql_window_clause:
    WINDOW sql_window_definition_list   { $$ = move($2); }
  | %empty                              { $$ = {}; }
    ;

sql_window_definition_list:
    sql_window_definition                                   { $$ = { $1 }; }
  | sql_window_definition_list ',' sql_window_definition    { $1.push_back($3); $$ = move($1); }
    ;

sql_window_definition:
    sql_col_id AS sql_window_specification {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_WINDOW_DEF, {
            Key::SQL_WINDOW_DEF_NAME << String(@1),
            Key::SQL_WINDOW_DEF_FRAME << $3,
        });
    }
    ;

sql_over_clause:
    OVER sql_window_specification   { $$ = $2; }
  | OVER sql_col_id                 { $$ = String(@2); }
  | %empty                          { $$ = Null(); }
    ;

sql_window_specification:
    '(' sql_opt_existing_window_name sql_opt_partition_clause sql_opt_sort_clause sql_opt_frame_clause ')' {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_WINDOW_FRAME, concat(move($2), move($3), move($5)));
    }
    ;

// If we see PARTITION, RANGE, or ROWS as the first token after the '('
// of a window_specification, we want the assumption to be that there is
// no existing_window_name; but those keywords are unreserved and so could
// be ColIds.  We fix this by making them have the same precedence as IDENT
// and giving the empty production here a slightly higher precedence, so
// that the shift/reduce conflict is resolved in favor of reducing the rule.
// These keywords are thus precluded from being an existing_window_name but
// are not reserved for any other purpose.

sql_opt_existing_window_name:
    sql_col_id                  { $$ = { Key::SQL_WINDOW_FRAME_NAME << String(@1) }; }
  | %empty          %prec Op    { $$ = {};}
    ;

sql_opt_partition_clause:
    PARTITION BY sql_expr_list  { $$ = { Key::SQL_WINDOW_FRAME_PARTITION << ctx.Add(@3, move($3)) }; }
  | %empty                      { $$ = {}; }
    ;

// For frame clauses, we return a PGWindowDef, but only some fields are used:
// frameOptions, startOffset, and endOffset.
//
// This is only a subset of the full SQL:2008 frame_clause grammar.
// We don't support <window frame exclusion> yet.

sql_opt_frame_clause:
    RANGE sql_frame_extent { $$ = {
        Key::SQL_WINDOW_FRAME_MODE << Enum(@1, sx::WindowRangeMode::RANGE),
        Key::SQL_WINDOW_FRAME_BOUNDS << ctx.Add(@2, move($2)), }; }
  | ROWS sql_frame_extent { $$ = {
        Key::SQL_WINDOW_FRAME_MODE << Enum(@1, sx::WindowRangeMode::ROWS),
        Key::SQL_WINDOW_FRAME_BOUNDS << ctx.Add(@2, move($2)), }; }
  | %empty { $$ = {}; }
    ;

sql_frame_extent:
    sql_frame_bound                                 { $$ = { $1 }; }
  | BETWEEN sql_frame_bound AND sql_frame_bound     { $$ = { $2, $4 }; }
    ;

sql_frame_bound:
    UNBOUNDED PRECEDING {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_WINDOW_BOUND, {
            Key::SQL_WINDOW_BOUND_MODE << Enum(@1, sx::WindowBoundMode::UNBOUNDED),
            Key::SQL_WINDOW_BOUND_DIRECTION << Enum(@1, sx::WindowBoundDirection::PRECEDING)
        });}
  | UNBOUNDED FOLLOWING {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_WINDOW_BOUND, {
            Key::SQL_WINDOW_BOUND_MODE << Enum(@1, sx::WindowBoundMode::UNBOUNDED),
            Key::SQL_WINDOW_BOUND_DIRECTION << Enum(@1, sx::WindowBoundDirection::FOLLOWING)
        });}
  | CURRENT_P ROW {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_WINDOW_BOUND, {
            Key::SQL_WINDOW_BOUND_MODE << Enum(@1, sx::WindowBoundMode::CURRENT_ROW),
        });}
  | sql_a_expr PRECEDING {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_WINDOW_BOUND, {
            Key::SQL_WINDOW_BOUND_MODE << Enum(@1, sx::WindowBoundMode::VALUE),
            Key::SQL_WINDOW_BOUND_DIRECTION << Enum(@1, sx::WindowBoundDirection::PRECEDING),
            Key::SQL_WINDOW_BOUND_VALUE << $1,
        });}
  | sql_a_expr FOLLOWING {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_WINDOW_BOUND, {
            Key::SQL_WINDOW_BOUND_MODE << Enum(@1, sx::WindowBoundMode::VALUE),
            Key::SQL_WINDOW_BOUND_DIRECTION << Enum(@1, sx::WindowBoundDirection::FOLLOWING),
            Key::SQL_WINDOW_BOUND_VALUE << $1,
        });}
    ;


// Supporting nonterminals for expressions.

// Explicit row production.
//
// SQL99 allows an optional ROW keyword, so we can now do single-element rows
// without conflicting with the parenthesized a_expr production.  Without the
// ROW keyword, there must be more than one a_expr inside the parens.

sql_row:
    ROW '(' sql_expr_list ')'             { $$ = std::move($3); }
  | ROW '(' ')'                           { $$ = {}; }
  | '(' sql_expr_list ',' sql_a_expr ')'  { $2.push_back(std::move($4)); $$ = std::move($2); }
    ;

sql_subquery_quantifier:
    ANY             { $$ = Enum(@1, sx::SubqueryQuantifier::ANY); }
  | SOME            { $$ = Enum(@1, sx::SubqueryQuantifier::SOME); }
  | ALL             { $$ = Enum(@1, sx::SubqueryQuantifier::ALL); }
    ;

sql_all_op:
    Op              { $$ = String(@1); }
  | sql_math_op     { $$ = $1; }
    ;

sql_math_op:
    '+'             { $$ = Enum(@1, sx::ExpressionOperator::PLUS); }
  | '-'             { $$ = Enum(@1, sx::ExpressionOperator::MINUS); }
  | '*'             { $$ = Enum(@1, sx::ExpressionOperator::MULTIPLY); }
  | '/'             { $$ = Enum(@1, sx::ExpressionOperator::DIVIDE); }
  | '%'             { $$ = Enum(@1, sx::ExpressionOperator::MODULUS); }
  | '^'             { $$ = Enum(@1, sx::ExpressionOperator::XOR); }
  | '<'             { $$ = Enum(@1, sx::ExpressionOperator::LESS_THAN); }
  | '>'             { $$ = Enum(@1, sx::ExpressionOperator::GREATER_THAN); }
  | '='             { $$ = Enum(@1, sx::ExpressionOperator::EQUAL); }
  | LESS_EQUALS     { $$ = Enum(@1, sx::ExpressionOperator::LESS_EQUAL); }
  | GREATER_EQUALS  { $$ = Enum(@1, sx::ExpressionOperator::GREATER_EQUAL); }
  | NOT_EQUALS      { $$ = Enum(@1, sx::ExpressionOperator::NOT_EQUAL); }
    ; 

sql_qual_op:
    Op                                  { $$ = String(@1); }
  | OPERATOR '(' sql_any_operator ')'   { $$ = ctx.Add(@$, std::move($3)); }
    ;

sql_qual_all_op:
    sql_all_op                          { $$ = std::move($1); }
  | OPERATOR '(' sql_any_operator ')'   { $$ = ctx.Add(@$, std::move($3)); }
    ;

// cannot put SIMILAR TO into sql_subquery_op, because SIMILAR TO is a hack.
// the regular expression is preprocessed by a function (similar_escape),
// and the ~ operator for posix regular expressions is used.
//        x SIMILAR TO y     ->    x ~ similar_escape(y)
// this transformation is made on the fly by the parser upwards.
// however the PGSubLink structure which handles any/some/all stuff
// is not ready for such a thing.

sql_subquery_op:
    sql_all_op      { $$ = std::move($1); }
  | LIKE            { $$ = Enum(@1, sx::ExpressionOperator::LIKE); }
  | NOT_LA LIKE     { $$ = Enum(@1, sx::ExpressionOperator::NOT_LIKE); }
  | GLOB            { $$ = Enum(@1, sx::ExpressionOperator::GLOB); }
  | NOT_LA GLOB     { $$ = Enum(@1, sx::ExpressionOperator::NOT_GLOB); }
  | ILIKE           { $$ = Enum(@1, sx::ExpressionOperator::ILIKE); }
  | NOT_LA ILIKE    { $$ = Enum(@1, sx::ExpressionOperator::NOT_ILIKE); }
  | OPERATOR '(' sql_any_operator ')'   { $$ = ctx.Add(@$, std::move($3)); }
    ;

sql_any_operator:
    sql_all_op                        { $$ = { std::move($1) }; }
  | sql_col_id '.' sql_any_operator   {
      $3.insert($3.begin(), String(@1));
      $$ = std::move($3);
    }
    ;

sql_expr_list:
    sql_a_expr                      { $$ = { $1 }; }
  | sql_expr_list ',' sql_a_expr    { $1.push_back($3); $$ = move($1); }
    ;

sql_func_arg_list:
    sql_func_arg_expr                           { $$ = { $1 }; }
  | sql_func_arg_list ',' sql_func_arg_expr     { $1.push_back($3); $$ = move($1); }
    ;

sql_func_arg_expr:
    sql_a_expr { $$ = $1; }
  | sql_param_name COLON_EQUALS sql_a_expr {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_FUNCTION_ARG, {
            Key::SQL_FUNCTION_ARG_NAME << String(@1),
            Key::SQL_FUNCTION_ARG_VALUE << $3,
        });
    }
  | sql_param_name EQUALS_GREATER sql_a_expr {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_FUNCTION_ARG, {
            Key::SQL_FUNCTION_ARG_NAME << String(@1),
            Key::SQL_FUNCTION_ARG_VALUE << $3,
        });
    }
    ;

sql_type_list:
    sql_typename                    { $$ = { $1 }; }
  | sql_type_list ',' sql_typename  { $1.push_back($3); $$ = move($1); }
    ;

sql_extract_list:
    sql_extract_arg FROM sql_a_expr {
        $$ = {
            Key::SQL_FUNCTION_EXTRACT_TARGET << std::move($1),
            Key::SQL_FUNCTION_EXTRACT_INPUT << std::move($3),
        };
    }
  | %empty  { $$ = {}; }
    ;

// Allow delimited string Sconst in extract_arg as an SQL extension.
// - thomas 2001-04-12
sql_extract_arg:
    IDENT       { $$ = String(@1); }
  | YEAR_P      { $$ = Enum(@1, sx::ExtractTarget::YEAR); }
  | MONTH_P     { $$ = Enum(@1, sx::ExtractTarget::MONTH); }
  | DAY_P       { $$ = Enum(@1, sx::ExtractTarget::DAY); }
  | HOUR_P      { $$ = Enum(@1, sx::ExtractTarget::HOUR); }
  | MINUTE_P    { $$ = Enum(@1, sx::ExtractTarget::MINUTE); }
  | SECOND_P    { $$ = Enum(@1, sx::ExtractTarget::SECOND); }
  | SCONST      { $$ = String(@1); }
    ;

// OVERLAY() arguments
// SQL99 defines the OVERLAY() function:
//  - overlay(text placing text from int for int)
//  - overlay(text placing text from int)
// and similarly for binary strings

sql_overlay_list:
    sql_a_expr sql_overlay_placing sql_substr_from sql_substr_for {
        $$ = {
            Key::SQL_FUNCTION_OVERLAY_INPUT << std::move($1),
            Key::SQL_FUNCTION_OVERLAY_PLACING << std::move($2),
            Key::SQL_FUNCTION_OVERLAY_FROM << std::move($3),
            Key::SQL_FUNCTION_OVERLAY_FOR << std::move($4),
        };
    }
  | sql_a_expr sql_overlay_placing sql_substr_from {
        $$ = {
            Key::SQL_FUNCTION_OVERLAY_INPUT << std::move($1),
            Key::SQL_FUNCTION_OVERLAY_PLACING << std::move($2),
            Key::SQL_FUNCTION_OVERLAY_FROM << std::move($3),
        };
    }
    ;

sql_overlay_placing:
    PLACING sql_a_expr { $$ = std::move($2); }
    ;

// position_list uses b_expr not a_expr to avoid conflict with general IN

sql_position_list:
    sql_b_expr IN_P sql_b_expr {
        $$ = {
            Key::SQL_FUNCTION_POSITION_SEARCH << std::move($1),
            Key::SQL_FUNCTION_POSITION_INPUT << std::move($3),
        };
    }
  | %empty { $$ = {}; }
    ;

// SUBSTRING() arguments
// SQL9x defines a specific syntax for arguments to SUBSTRING():
//  - substring(text from int for int)
//  - substring(text from int) get entire string from starting point "int"
//  - substring(text for int) get first "int" characters of string
//  - substring(text from pattern) get entire string matching pattern
//  - substring(text from pattern for escape) same with specified escape char
// We also want to support generic substring functions which accept
// the usual generic list of arguments. So we will accept both styles
// here, and convert the SQL9x style to the generic list for further
// processing. - thomas 2000-11-28

sql_substr_list:
    sql_a_expr sql_substr_from sql_substr_for {
        $$ = {
            Key::SQL_FUNCTION_SUBSTRING_INPUT << std::move($1),
            Key::SQL_FUNCTION_SUBSTRING_FROM << std::move($2),
            Key::SQL_FUNCTION_SUBSTRING_FOR << std::move($3),
        };
    }
  | sql_a_expr sql_substr_for sql_substr_from {
        $$ = {
            Key::SQL_FUNCTION_SUBSTRING_INPUT << std::move($1),
            Key::SQL_FUNCTION_SUBSTRING_FOR << std::move($2),
            Key::SQL_FUNCTION_SUBSTRING_FROM << std::move($3),
        };
    }
  | sql_a_expr sql_substr_from {
        $$ = {
            Key::SQL_FUNCTION_SUBSTRING_INPUT << std::move($1),
            Key::SQL_FUNCTION_SUBSTRING_FROM << std::move($2),
        };
   }
  | sql_a_expr sql_substr_for {
        $$ = {
            Key::SQL_FUNCTION_SUBSTRING_INPUT << std::move($1),
            Key::SQL_FUNCTION_SUBSTRING_FOR << std::move($2),
        };
   }
  | sql_expr_list   { $$ = { Key::SQL_FUNCTION_ARGUMENTS << ctx.Add(@1, std::move($1)) }; }
  | %empty          { $$ = {}; }
    ;

sql_substr_from:
    FROM sql_a_expr   { $$ = std::move($2); }
    ;

sql_substr_for:
    FOR sql_a_expr    { $$ = std::move($2); }
    ;

sql_trim_list:
    sql_a_expr FROM sql_expr_list {
        $$ = {
            Key::SQL_FUNCTION_TRIM_CHARACTERS << std::move($1),
            Key::SQL_FUNCTION_TRIM_INPUT << ctx.Add(Loc({@2, @3}), std::move($3))
        };
    }
  | FROM sql_expr_list  { $$ = { Key::SQL_FUNCTION_TRIM_INPUT << ctx.Add(Loc({@1, @2}), std::move($2)) }; }
  | sql_expr_list       { $$ = { Key::SQL_FUNCTION_TRIM_INPUT << ctx.Add(@$, std::move($1)) }; }
    ;

sql_in_expr:
    sql_select_with_parens  { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_SELECT_EXPRESSION, std::move($1)); }
  | '(' sql_expr_list ')'   { $$ = ctx.Add(@$, std::move($2)); }
    ;

// Define SQL-style CASE clause.
//  - Full specification
//    CASE WHEN a = b THEN c ... ELSE d END
//  - Implicit argument
//    CASE a WHEN b THEN c ... ELSE d END

sql_case_expr:
    CASE sql_case_arg sql_when_clause_list sql_case_default END_P {
      $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CASE, {
        Key::SQL_CASE_ARGUMENT << std::move($2),
        Key::SQL_CASE_CLAUSES << ctx.Add(@3, std::move($3)),
        Key::SQL_CASE_DEFAULT << std::move($4)
      });
    }
    ;

sql_when_clause_list:
    // There must be at least one
    sql_when_clause                       { $$ = { std::move($1) }; }
  | sql_when_clause_list sql_when_clause  { $1.push_back(std::move($2)); $$ = std::move($1); }
    ;

sql_when_clause:
    WHEN sql_a_expr THEN sql_a_expr {
      $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CASE_CLAUSE, {
        Key::SQL_CASE_CLAUSE_WHEN << std::move($2),
        Key::SQL_CASE_CLAUSE_THEN << std::move($4)
      });
    }
    ;

sql_case_default:
    ELSE sql_a_expr   { $$ = std::move($2); }
  | %empty            { $$ = Null(); }
    ;

sql_case_arg:
    sql_a_expr        { $$ = std::move($1); }
  | %empty            { $$ = Null(); }
    ;

sql_columnref:
    sql_col_id                  { $$ = ColumnRef(ctx, @$, {String(@1)}); }
  | sql_col_id sql_indirection  { $2.insert($2.begin(), String(@1)); $$ = ColumnRef(ctx, @$, move($2)); }
    ;

sql_indirection_el:
    '.' sql_attr_name       { $$ = String(@2); }
  | '.' '*'                 { $$ = String(@2); }
  | '[' sql_a_expr ']'      { $$ = IndirectionIndex(ctx, @$, $2); }
  | '[' sql_opt_slice_bound ':' sql_opt_slice_bound ']'     { $$ = IndirectionIndex(ctx, @$, $2, $4); }
    ;

sql_opt_slice_bound:
    sql_a_expr              { $$ = $1; }
  | %empty                  { $$ = Null(); }
    ;

sql_indirection:
    sql_indirection_el                      { $$ = { $1 }; }
  | sql_indirection sql_indirection_el      { $1.push_back($2); $$ = move($1); }
    ;

sql_opt_indirection:
    %empty                                  { $$ = {}; }
  | sql_opt_indirection sql_indirection_el  { $1.push_back($2); $$ = move($1); }
    ;

sql_opt_asymmetric:
    ASYMMETRIC      { $$ = true; }
  | %empty          { $$ = false; }
    ;


// ---------------------------------------------------------------------------
// Target list for SELECT

sql_opt_target_list:
    sql_target_list   { $$ = $1; }
  | %empty            { $$ = {}; }
    ;

sql_target_list:
    sql_target_el                       { $$ = { $1 }; }
  | sql_target_list ',' sql_target_el   { $1.push_back($3); $$ = move($1); }
    ;

sql_target_el:
    sql_a_expr AS sql_col_label_or_string {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_RESULT_TARGET, {
            Key::SQL_RESULT_TARGET_VALUE << $1,
            Key::SQL_RESULT_TARGET_NAME << String(@3),
        });
    }

    // We support omitting AS only for column labels that aren't
    // any known keyword.  There is an ambiguity against postfix
    // operators: is "a ! b" an infix expression, or a postfix
    // expression and a column label?  We prefer to resolve this
    // as an infix expression, which we accomplish by assigning
    // IDENT a precedence higher than POSTFIXOP.

  | sql_a_expr IDENT {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_RESULT_TARGET, {
            Key::SQL_RESULT_TARGET_VALUE << $1,
            Key::SQL_RESULT_TARGET_NAME << String(@2),
        });
    }
  | sql_a_expr  { $$ = $1; }
  | '*'         { $$ = {}; }
    ;


// ---------------------------------------------------------------------------
// Names and constants

sql_qualified_name_list:
    sql_qualified_name                              { $$ = { std::move($1) }; }
  | sql_qualified_name_list ',' sql_qualified_name  { $1.push_back(std::move($3)); $$ = std::move($1); }
    ;

// The production for a qualified relation name has to exactly match the
// production for a qualified func_name, because in a FROM clause we cannot
// tell which we are parsing until we see what comes after it ('(' for a
// func_name, something else for a relation). Therefore we allow 'indirection'
// which may contain subscripts, and reject that case in the C code.

sql_qualified_name:
    sql_col_id                      { $$ = QualifiedName(ctx, @$, { String(@1) }); };
  | sql_col_id sql_indirection      { $2.insert($2.begin(), String(@1)); $$ = QualifiedName(ctx, @$, move($2)); };
    ;

sql_name_list:
    sql_name                        { $$ = {}; $$.push_back(String(@1)); }
  | sql_name_list ',' sql_name      { $1.push_back(String(@3)); $$ = move($1); }
    ;

sql_name: sql_col_id;
sql_attr_name: sql_col_label;

// The production for a qualified func_name has to exactly match the
// production for a qualified columnref, because we cannot tell which we
// are parsing until we see what comes after it ('(' or Sconst for a func_name,
// anything else for a columnref).  Therefore we allow 'indirection' which
// may contain subscripts, and reject that case in the C code.  (If we
// ever implement SQL99-like methods, such syntax may actually become legal!)

sql_func_name:
    sql_type_function_name      { $$ = { String(@1) }; }
  | sql_col_id sql_indirection  { $2.insert($2.begin(), String(@1)); $$ = move($2); }
    ;

// Constants
sql_a_expr_const:
    ICONST  { $$ = Const(ctx, @1, sx::AConstType::INTEGER); }
  | FCONST  { $$ = Const(ctx, @1, sx::AConstType::FLOAT); }
  | SCONST  { $$ = Const(ctx, @1, sx::AConstType::STRING); }
  | BCONST  { $$ = Const(ctx, @1, sx::AConstType::BITSTRING); }
  | XCONST  { $$ = Const(ctx, @1, sx::AConstType::BITSTRING); }
  | sql_const_typename SCONST {
      $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CONST_CAST, {
        Key::SQL_CONST_CAST_TYPE << std::move($1),
        Key::SQL_CONST_CAST_VALUE << String(@2),
      });
    }
  | sql_func_name SCONST {
      $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CONST_CAST, {
        Key::SQL_CONST_CAST_TYPE << Const(ctx, @1, sx::AConstType::FUNCTION),
        Key::SQL_CONST_CAST_FUNC_NAME << ctx.Add(@1, std::move($1)),
        Key::SQL_CONST_CAST_VALUE << String(@2),
      });
  }
  | sql_func_name '(' sql_func_arg_list sql_opt_sort_clause ')' SCONST {
      $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CONST_CAST, {
        Key::SQL_CONST_CAST_TYPE << Const(ctx, @1, sx::AConstType::FUNCTION),
        Key::SQL_CONST_CAST_FUNC_NAME << ctx.Add(@1, std::move($1)),
        Key::SQL_CONST_CAST_FUNC_ARGS_LIST << ctx.Add(@3, std::move($3)),
        Key::SQL_CONST_CAST_FUNC_ARGS_ORDER << std::move($4),
        Key::SQL_CONST_CAST_VALUE << String(@6),
      });
  }
  | sql_const_interval '(' sql_a_expr ')' SCONST {
      $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CONST_CAST, {
        Key::SQL_CONST_CAST_TYPE << Const(ctx, @1, sx::AConstType::INTERVAL),
        Key::SQL_CONST_CAST_VALUE << String(@5),
        Key::SQL_CONST_CAST_INTERVAL << std::move($3),
      });
    }
  | sql_const_interval SCONST sql_opt_interval {
      $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CONST_CAST, {
        Key::SQL_CONST_CAST_TYPE << Const(ctx, @1, sx::AConstType::INTERVAL),
        Key::SQL_CONST_CAST_VALUE << String(@2),
        Key::SQL_CONST_CAST_INTERVAL << ctx.Add(@3, sx::NodeType::OBJECT_SQL_INTERVAL_TYPE, std::move($3)),
      });
    }
  | sql_const_interval ICONST sql_opt_interval {
      $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CONST_CAST, {
        Key::SQL_CONST_CAST_TYPE << Const(ctx, @1, sx::AConstType::INTERVAL),
        Key::SQL_CONST_CAST_VALUE << String(@2),
        Key::SQL_CONST_CAST_INTERVAL << ctx.Add(@3, sx::NodeType::OBJECT_SQL_INTERVAL_TYPE, std::move($3)),
      });
    }
  | TRUE_P    { $$ = Bool(@1, true); }
  | FALSE_P   { $$ = Bool(@1, false); }
  | NULL_P    { $$ = String(@1); }
    ;

// Name classification hierarchy.
//
// IDENT is the lexeme returned by the lexer for identifiers that match
// no known keyword.  In most cases, we can accept certain keywords as
// names, not only IDENTs.    We prefer to accept as many such keyword}s
// as possible to minimize the impact of "reserved words" on programmers.
// So, we divide names into several possible classes.  The classification
// is chosen in part to make keywords acceptable as names wherever possible.

// Column identifier --- names that can be column, table, etc names.

sql_col_id:
    IDENT                       { /* @$ */ }
  | sql_unreserved_keywords     { /* @$ */ }
  | sql_column_name_keywords    { /* @$ */ }
    ;

sql_col_id_or_string:
    sql_col_id                  { /* @$ */ }
  | SCONST                      { /* @$ */ }
    ;

// Type/function identifier --- names that can be type or function names.

sql_type_function_name:
    IDENT                       { /* @$ */ }
  | sql_unreserved_keywords     { /* @$ */ }
  | sql_type_func_keywords      { /* @$ */ }
  | dashql_keywords             { /* @$ */ }
    ;

sql_any_name:
    sql_col_id                  { $$ = { String(@1) }; }
  | sql_col_id sql_attrs        { $2.insert($2.begin(), String(@1)); $$ = std::move($2); }
    ;

sql_attrs:
    '.' sql_attr_name           { $$ = { String(@2) }; }
  | sql_attrs '.' sql_attr_name { $1.push_back(String(@3)); $$ = std::move($1); }
    ;

sql_opt_name_list:
    '(' sql_name_list ')'       { $$ = move($2); }
  | %empty                      { $$ = {}; }
    ;

sql_param_name:
    sql_type_function_name      { /* @$ */ }
    ;

// Any not-fully-reserved word --- these names can be, eg, role names.

// Column label --- allowed labels in "AS" clauses.
// This presently includes *all* Postgres keywords.

sql_col_label:
    IDENT                       { /* @$ */ }
  | sql_unreserved_keywords     { /* @$ */ }
  | sql_column_name_keywords    { /* @$ */ }
  | sql_type_func_keywords      { /* @$ */ }
  | sql_reserved_keywords       { /* @$ */ }
  | dashql_keywords             { /* @$ */ }
    ;

sql_col_label_or_string:
    sql_col_label               { /* @$ */ }
  | SCONST                      { /* @$ */ }
    ;
