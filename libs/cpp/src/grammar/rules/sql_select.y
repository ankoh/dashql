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
    sql_select_no_parens        %prec UMINUS    { $$ = $1; }
  | sql_select_with_parens      %prec UMINUS    { $$ = {}; }
    ;

sql_select_with_parens:
    '(' sql_select_no_parens ')'
  | '(' sql_select_with_parens ')'
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
    sql_simple_select                       { $$ = $1; }
  | sql_select_clause sql_sort_clause       { $$ = {}; }
  | sql_select_clause sql_opt_sort_clause sql_for_locking_clause sql_opt_select_limit   { $$ = {}; }
  | sql_select_clause sql_opt_sort_clause sql_select_limit sql_opt_for_locking_clause   { $$ = {}; }
  | sql_with_clause sql_select_clause                                                   { $$ = {}; }
  | sql_with_clause sql_select_clause sql_sort_clause                                   { $$ = {}; }
  | sql_with_clause sql_select_clause sql_opt_sort_clause sql_for_locking_clause sql_opt_select_limit {
        $$ = {};
    }
  | sql_with_clause sql_select_clause sql_opt_sort_clause sql_select_limit sql_opt_for_locking_clause {
        $$ = {};
    }
    ;

sql_select_clause:
    sql_simple_select
  | sql_select_with_parens
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
        sql_group_clause sql_having_clause sql_window_clause {

            $$ = ctx.Add(@$, sx::NodeType::SQL_SELECT, {
                Key::SQL_SELECT_TARGETS << ctx.Add(@3, move($3)),
                Key::SQL_SELECT_INTO << $4,
                Key::SQL_SELECT_FROM << ctx.Add(@5, move($5)),
            });
        }
  | SELECT sql_distinct_clause sql_target_list
        sql_into_clause sql_from_clause sql_where_clause
        sql_group_clause sql_having_clause sql_window_clause {

            $$ = {};
        }
  | sql_values_clause           { $$ = {}; }
  | TABLE sql_relation_expr     { $$ = {}; }
  | sql_select_clause UNION sql_all_or_distinct sql_select_clause       { $$ = {}; }
  | sql_select_clause INTERSECT sql_all_or_distinct sql_select_clause   { $$ = {}; }
  | sql_select_clause EXCEPT sql_all_or_distinct sql_select_clause      { $$ = {}; }
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
    WITH sql_cte_list
  | WITH_LA sql_cte_list
  | WITH RECURSIVE sql_cte_list
    ;

sql_cte_list:
    sql_common_table_expr
  | sql_cte_list ',' sql_common_table_expr
    ;

sql_common_table_expr:
    sql_name sql_opt_name_list AS '(' sql_preparable_stmt ')'
    ;

sql_into_clause:
    INTO sql_opt_temp_table_name    { $$ = $2; }
  | %empty                          { $$ = std::nullopt; }
    ;

// XXX PreparableStmt: select | insert | update | delete
sql_preparable_stmt:
    sql_select_stmt
    ;

// Redundancy here is needed to avoid shift/reduce conflicts,
// since TEMP is not a reserved word.  See also OptTemp.
sql_opt_temp_table_name:
    TEMPORARY sql_opt_table sql_qualified_name          { $$ = ctx.AddInto(@$, ctx.RefEnum(@1, sxs::TempType::TEMP_DEFAULT), ctx.Add(@3, move($3))); }
  | TEMP sql_opt_table sql_qualified_name               { $$ = ctx.AddInto(@$, ctx.RefEnum(@1, sxs::TempType::TEMP_DEFAULT), ctx.Add(@3, move($3))); }
  | LOCAL TEMPORARY sql_opt_table sql_qualified_name    { $$ = ctx.AddInto(@$, ctx.RefEnum(@1, sxs::TempType::TEMP_LOCAL), ctx.Add(@4, move($4))); }
  | LOCAL TEMP sql_opt_table sql_qualified_name         { $$ = ctx.AddInto(@$, ctx.RefEnum(@1, sxs::TempType::TEMP_LOCAL), ctx.Add(@4, move($4))); }
  | GLOBAL TEMPORARY sql_opt_table sql_qualified_name   { $$ = ctx.AddInto(@$, ctx.RefEnum(@1, sxs::TempType::TEMP_GLOBAL), ctx.Add(@4, move($4))); }
  | GLOBAL TEMP sql_opt_table sql_qualified_name        { $$ = ctx.AddInto(@$, ctx.RefEnum(@1, sxs::TempType::TEMP_GLOBAL), ctx.Add(@4, move($4))); }
  | UNLOGGED sql_opt_table sql_qualified_name           { $$ = ctx.AddInto(@$, ctx.RefEnum(@1, sxs::TempType::TEMP_UNLOGGED), ctx.Add(@3, move($3))); }
  | TABLE sql_qualified_name                            { $$ = ctx.AddInto(@$, ctx.RefEnum(@1, sxs::TempType::TEMP_DEFAULT), ctx.Add(@2, move($2))); }
  | sql_qualified_name                                  { $$ = ctx.AddInto(@$, ctx.RefEnum(@1, sxs::TempType::TEMP_DEFAULT), ctx.Add(@1, move($1))); }
    ;

sql_opt_table:
    TABLE
  | %empty
    ;

sql_all_or_distinct:
    ALL
  | DISTINCT
  | %empty
    ;

// We use (NIL) as a placeholder to indicate that all target expressions
// should be placed in the DISTINCT list during parsetree analysis.

sql_distinct_clause:
    DISTINCT
  | DISTINCT ON '(' sql_expr_list ')'
    ;

sql_opt_all_clause:
    ALL
  | %empty
    ;

sql_opt_sort_clause:
    sql_sort_clause
  | %empty
    ;

sql_sort_clause:
    ORDER BY sql_sortby_list
    ;

sql_sortby_list:
    sql_sortby
  | sql_sortby_list ',' sql_sortby
    ;

sql_sortby:
    sql_a_expr USING sql_qual_all_op sql_opt_nulls_order
  | sql_a_expr sql_opt_asc_desc sql_opt_nulls_order
    ;

sql_opt_asc_desc:
    ASC_P | DESC_P | %empty
    ;

sql_opt_nulls_order:
    NULLS_LA FIRST_P
  | NULLS_LA LAST_P
  | %empty
    ;

sql_select_limit:
    sql_limit_clause sql_offset_clause
  | sql_offset_clause sql_limit_clause
  | sql_limit_clause
  | sql_offset_clause
    ;

sql_opt_select_limit:
    sql_select_limit
  | %empty
        ;

sql_limit_clause:
    LIMIT sql_select_limit_value
  | LIMIT sql_select_limit_value ',' sql_select_offset_value
    // SQL:2008 syntax
    // to avoid shift/reduce conflicts, handle the optional value with
    //   a separate production rather than an opt_ expression.  The fact
    //   that ONLY is fully reserved means that this way, we defer any
    //   decision about what rule reduces ROW or ROWS to the point where
    //   we can see the ONLY token in the lookahead slot.
    //  
  | FETCH sql_first_or_next sql_select_fetch_first_value sql_row_or_rows ONLY
  | FETCH sql_first_or_next sql_row_or_rows ONLY
    ;

sql_offset_clause:
    OFFSET sql_select_offset_value
    // SQL:2008 syntax
  | OFFSET sql_select_fetch_first_value sql_row_or_rows
    ;

sql_select_limit_value:
    sql_a_expr
  | ALL
    ;

sql_select_offset_value:
    sql_a_expr
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
    sql_c_expr
  | '+' sql_i_or_f_const
  | '-' sql_i_or_f_const

        ;

sql_i_or_f_const:
    ICONST
  | FCONST
    ;

// noise words
sql_row_or_rows:
    ROW
  | ROWS
    ;

sql_first_or_next:
    FIRST_P
  | NEXT
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
    GROUP_P BY sql_group_by_list
  | %empty
    ;

sql_group_by_list:
    sql_group_by_item
  | sql_group_by_list ',' sql_group_by_item
    ;

sql_group_by_item:
    sql_a_expr
  | sql_empty_grouping_set
    ;

sql_empty_grouping_set:
    '(' ')'
    ;

// These hacks rely on setting precedence of CUBE and ROLLUP below that of '(',
// so that they shift in these rules rather than reducing the conflicting
// unreserved_keyword rule.

sql_having_clause:
    HAVING sql_a_expr
  | %empty
    ;

sql_for_locking_clause:
    sql_for_locking_items
  | FOR READ_P ONLY
    ;

sql_opt_for_locking_clause:
    sql_for_locking_clause
  | %empty
    ;

sql_for_locking_items:
    sql_for_locking_item
  | sql_for_locking_items sql_for_locking_item
    ;

sql_for_locking_item:
    sql_for_locking_strength sql_locked_rels_list sql_opt_nowait_or_skip
    ;

sql_for_locking_strength:
    FOR UPDATE
  | FOR NO KEY UPDATE
  | FOR SHARE
  | FOR KEY SHARE
    ;

sql_locked_rels_list:
    OF sql_qualified_name_list
  | %empty
    ;


sql_opt_nowait_or_skip:
    NOWAIT
  | SKIP LOCKED
  | %empty
    ;

// We should allow ROW '(' expr_list ')' too, but that seems to require
// making VALUES a fully reserved word, which will probably break more apps
// than allowing the noise-word is worth.

sql_values_clause:
    VALUES '(' sql_expr_list ')'
  | sql_values_clause ',' '(' sql_expr_list ')'
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

sql_table_ref:
    sql_relation_expr sql_opt_alias_clause                          { $1.push_back(Key::SQL_TABLE_ALIAS << $2); $$ = ctx.Add(@$, sx::NodeType::SQL_TABLE_REF, move($1)); }
  | sql_relation_expr sql_opt_alias_clause sql_tablesample_clause   { $$ = {}; }
  | sql_func_table sql_func_alias_clause                            { $$ = {}; }
  | LATERAL_P sql_func_table sql_func_alias_clause                  { $$ = {}; }
  | sql_select_with_parens sql_opt_alias_clause                     { $$ = {}; }
  | LATERAL_P sql_select_with_parens sql_opt_alias_clause           { $$ = {}; }
  | sql_joined_table                                                { $$ = {}; }
  | '(' sql_joined_table ')' sql_alias_clause                       { $$ = {}; }
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
    '(' sql_joined_table ')'
  | sql_table_ref CROSS JOIN sql_table_ref
  | sql_table_ref sql_join_type JOIN sql_table_ref sql_join_qual
  | sql_table_ref JOIN sql_table_ref sql_join_qual
  | sql_table_ref NATURAL sql_join_type JOIN sql_table_ref
  | sql_table_ref NATURAL JOIN sql_table_ref
    ;

sql_alias_clause:
    AS sql_col_id '(' sql_name_list ')'     { $$ = ctx.AddAlias(@$, ctx.Ref(@2), ctx.Add(@4, move($4))); }
  | AS sql_col_id_or_string                 { $$ = ctx.Ref(@2); }
  | sql_col_id '(' sql_name_list ')'        { $$ = ctx.AddAlias(@$, ctx.Ref(@1), ctx.Add(@3, move($3))); }
  | sql_col_id                              { $$ = ctx.Ref(@1); }
    ;

sql_opt_alias_clause:
    sql_alias_clause    { $$ = $1; }
  | %empty              { $$ = std::nullopt; }
    ;

// func_alias_clause can include both an PGAlias and a coldeflist, so we make it
// return a 2-element list that gets disassembled by calling production.
sql_func_alias_clause:
    sql_alias_clause
  | AS '(' sql_table_func_element_list ')'
  | AS sql_col_id '(' sql_table_func_element_list ')' 
  | sql_col_id '(' sql_table_func_element_list ')' ')'
  | %empty
    ;

sql_join_type:
    FULL sql_join_outer
  | LEFT sql_join_outer
  | RIGHT sql_join_outer
  | INNER_P
    ;

/* OUTER is just noise... */
sql_join_outer:
    OUTER_P
  | %empty
    ;

// JOIN qualification clauses
// Possibilities are:
//    USING ( column list ) allows only unqualified column names,
//                          which must match between tables.
//    ON expr allows more general qualifications.
//
// We return USING as a PGList node, while an ON-expr will not be a List.

sql_join_qual:
    USING '(' sql_name_list ')'
  | ON sql_a_expr
    ;

sql_relation_expr:
    sql_qualified_name              { $$ = { Key::SQL_TABLE_NAME << ctx.Add(@1, move($1)), Key::SQL_TABLE_INHERIT << ctx.Ref(@$, true) }; }
  | sql_qualified_name '*'          { $$ = { Key::SQL_TABLE_NAME << ctx.Add(@1, move($1)), Key::SQL_TABLE_INHERIT << ctx.Ref(@2, true) }; }
  | ONLY sql_qualified_name         { $$ = { Key::SQL_TABLE_NAME << ctx.Add(@1, move($2)), Key::SQL_TABLE_INHERIT << ctx.Ref(@1, false) }; }
  | ONLY '(' sql_qualified_name ')' { $$ = { Key::SQL_TABLE_NAME << ctx.Add(@1, move($3)), Key::SQL_TABLE_INHERIT << ctx.Ref(@1, false) }; }
    ;

// Given "UPDATE foo set set ...", we have to decide without looking any
// further ahead whether the first "set" is an alias or the UPDATE's SET
// keyword.  Since "set" is allowed as a column name both interpretations
// are feasible.  We resolve the shift/reduce conflict by giving the first
// production a higher precedence than the SET token
// has, causing the parser to prefer to reduce, in effect assuming that the
// SET is not an alias.


// TABLESAMPLE decoration in a FROM item

sql_tablesample_clause:
    TABLESAMPLE sql_func_name '(' sql_expr_list ')' sql_opt_repeatable_clause
    ;

sql_opt_repeatable_clause:
    REPEATABLE '(' sql_a_expr ')'
  | %empty
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
    sql_func_expr_windowless sql_opt_ordinality
  | ROWS FROM '(' sql_rowsfrom_list ')' sql_opt_ordinality
    ;

sql_rowsfrom_item:
    sql_func_expr_windowless sql_opt_col_def_list
    ;

sql_rowsfrom_list:
    sql_rowsfrom_item
  | sql_rowsfrom_list ',' sql_rowsfrom_item
    ;

sql_opt_col_def_list:
    AS '(' sql_table_func_element_list ')'
  | %empty
    ;

sql_opt_ordinality:
    WITH_LA ORDINALITY
  | %empty
    ;


sql_where_clause:
    WHERE sql_a_expr
  | %empty
    ;

/* variant for UPDATE and DELETE */
sql_table_func_element_list:
    sql_table_func_element
  | sql_table_func_element_list ',' sql_table_func_element
    ;

sql_table_func_element:
    sql_col_id sql_typename sql_opt_collate_clause
    ;

sql_opt_collate_clause:
    COLLATE sql_any_name
  | %empty
    ;


// Type syntax
//  SQL introduces a large amount of type-specific syntax.
//  Define individual clauses to handle these cases, and use
//   the generic case to handle regular type-extensible Postgres syntax.
//  - thomas 1997-10-10

sql_typename:
    sql_simple_typename sql_opt_array_bounds
  | SETOF sql_simple_typename sql_opt_array_bounds
    // SQL standard syntax, currently only one-dimensional
  | sql_simple_typename ARRAY '[' ICONST ']'
  | SETOF sql_simple_typename ARRAY '[' ICONST ']'
  | sql_simple_typename ARRAY
  | SETOF sql_simple_typename ARRAY
    ;

sql_opt_array_bounds:
    sql_opt_array_bounds '[' ']'
  | sql_opt_array_bounds '[' ICONST ']'
  | %empty
    ;

sql_simple_typename:
    sql_generic_type
  | sql_numeric
  | sql_bit
  | sql_const_character
  | sql_const_datetime
  | sql_const_interval sql_opt_interval
  | sql_const_interval '(' ICONST ')'
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
    sql_numeric
  | sql_const_bit
  | sql_character
  | sql_const_datetime
    ;

// GenericType covers all type names that don't have special syntax mandated
// by the standard, including qualified names.  We also allow type modifiers.
// To avoid parsing conflicts against function invocations, the modifiers
// have to be shown as expr_list here, but parse analysis will only accept
// constants for them.

sql_generic_type:
    sql_type_function_name sql_opt_type_modifiers
  | sql_type_function_name sql_attrs sql_opt_type_modifiers
    ;

sql_opt_type_modifiers:
    '(' sql_expr_list ')'
  | %empty
    ;

// SQL numeric data types

sql_numeric:
    INT_P
  | INTEGER
  | SMALLINT
  | BIGINT
  | REAL
  | FLOAT_P sql_opt_float
  | DOUBLE_P PRECISION
  | DECIMAL_P sql_opt_type_modifiers
  | DEC sql_opt_type_modifiers
  | NUMERIC sql_opt_type_modifiers
  | BOOLEAN_P
    ;

sql_opt_float:
    '(' ICONST ')'
  | %empty
    ;

// SQL bit-field data types
// The following implements BIT() and BIT VARYING().

sql_bit:
    sql_bit_with_length
  | sql_bit_without_length
    ;

// ConstBit is like Bit except "BIT" defaults to unspecified length
// See notes for ConstCharacter, which addresses same issue for "CHAR"

sql_const_bit:
    sql_bit_with_length
  | sql_bit_without_length
    ;

sql_bit_with_length:
    BIT sql_opt_varying '(' sql_expr_list ')'
    ;

sql_bit_without_length:
    BIT sql_opt_varying
    ;


// SQL character data types
// The following implements CHAR() and VARCHAR().

sql_character:
    sql_character_with_length
  | sql_character_without_length
    ;

sql_const_character:
    sql_character_with_length
  | sql_character_without_length
    ;

sql_character_with_length:
    sql_character '(' ICONST ')'
    ;

sql_character_without_length:
    CHARACTER sql_opt_varying
  | CHAR_P sql_opt_varying
  | VARCHAR
  | NATIONAL CHARACTER sql_opt_varying
  | NATIONAL CHAR_P sql_opt_varying 
  | NCHAR sql_opt_varying
    ;

sql_opt_varying:
    VARYING
  | %empty
    ;

// SQL date/time types

sql_const_datetime:
    TIMESTAMP '(' ICONST ')' sql_opt_timezone
  | TIMESTAMP sql_opt_timezone
  | TIME '(' ICONST ')' sql_opt_timezone
  | TIME sql_opt_timezone
    ;

sql_const_interval:
    INTERVAL
    ;

sql_opt_timezone:
    WITH_LA TIME ZONE
  | WITHOUT TIME ZONE
  | %empty
    ;

sql_opt_interval:
    YEAR_P
  | MONTH_P
  | DAY_P
  | HOUR_P
  | MINUTE_P
  | sql_interval_second
  | YEAR_P TO MONTH_P
  | DAY_P TO HOUR_P
  | DAY_P TO MINUTE_P
  | DAY_P TO sql_interval_second
  | HOUR_P TO MINUTE_P
  | HOUR_P TO sql_interval_second
  | MINUTE_P TO sql_interval_second
  | %empty
    ;

sql_interval_second:
    SECOND_P
  | SECOND_P '(' ICONST ')'
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
  | sql_a_expr TYPECAST sql_typename                            { $$ = {}; }
  | sql_a_expr COLLATE sql_any_name                             { $$ = {}; }
  | sql_a_expr AT TIME ZONE sql_a_expr      %prec AT            { $$ = {}; }

  // These operators must be called out explicitly in order to make use
  // of bison's automatic operator-precedence handling.  All other
  // operator names are handled by the generic productions using "Op",
  // below; and all those operators will have the same precedence.
  // 
  // If you add more explicitly-known operators, be sure to add them
  // also to b_expr and to the MathOp list below.

  | '+' sql_a_expr                %prec UMINUS                  { $$ = {}; }
  | '-' sql_a_expr                %prec UMINUS                  { $$ = {}; }
  | sql_a_expr '+' sql_a_expr                                   { $$ = {}; }
  | sql_a_expr '-' sql_a_expr                                   { $$ = {}; }
  | sql_a_expr '*' sql_a_expr                                   { $$ = {}; }
  | sql_a_expr '/' sql_a_expr                                   { $$ = {}; }
  | sql_a_expr '%' sql_a_expr                                   { $$ = {}; }
  | sql_a_expr '^' sql_a_expr                                   { $$ = {}; }
  | sql_a_expr '<' sql_a_expr                                   { $$ = {}; }
  | sql_a_expr '>' sql_a_expr                                   { $$ = {}; }
  | sql_a_expr '=' sql_a_expr                                   { $$ = {}; }
  | sql_a_expr LESS_EQUALS sql_a_expr                           { $$ = {}; }
  | sql_a_expr GREATER_EQUALS sql_a_expr                        { $$ = {}; }
  | sql_a_expr NOT_EQUALS sql_a_expr                            { $$ = {}; }
  | sql_a_expr sql_qual_op sql_a_expr         %prec Op          { $$ = {}; }
  | sql_qual_op sql_a_expr                    %prec Op          { $$ = {}; }
  | sql_a_expr sql_qual_op                    %prec POSTFIXOP   { $$ = {}; }
  | sql_a_expr AND sql_a_expr                                   { $$ = {}; }
  | sql_a_expr OR sql_a_expr                                    { $$ = {}; }
  | NOT sql_a_expr                                              { $$ = {}; }
  | NOT_LA sql_a_expr                         %prec NOT         { $$ = {}; }
  | sql_a_expr GLOB sql_a_expr                %prec GLOB        { $$ = {}; }
  | sql_a_expr LIKE sql_a_expr                                  { $$ = {}; }
  | sql_a_expr LIKE sql_a_expr ESCAPE sql_a_expr            %prec LIKE          { $$ = {}; }
  | sql_a_expr NOT_LA LIKE sql_a_expr                       %prec NOT_LA        { $$ = {}; }
  | sql_a_expr NOT_LA LIKE sql_a_expr ESCAPE sql_a_expr     %prec NOT_LA        { $$ = {}; }
  | sql_a_expr ILIKE sql_a_expr                                                 { $$ = {}; }
  | sql_a_expr ILIKE sql_a_expr ESCAPE sql_a_expr           %prec ILIKE         { $$ = {}; }
  | sql_a_expr NOT_LA ILIKE sql_a_expr                      %prec NOT_LA        { $$ = {}; }
  | sql_a_expr NOT_LA ILIKE sql_a_expr ESCAPE sql_a_expr    %prec NOT_LA        { $$ = {}; }
  | sql_a_expr SIMILAR TO sql_a_expr                        %prec SIMILAR       { $$ = {}; }
  | sql_a_expr SIMILAR TO sql_a_expr ESCAPE sql_a_expr      %prec SIMILAR       { $$ = {}; }
  | sql_a_expr NOT_LA SIMILAR TO sql_a_expr                 %prec NOT_LA        { $$ = {}; }
  | sql_a_expr NOT_LA SIMILAR TO sql_a_expr ESCAPE sql_a_expr     %prec NOT_LA  { $$ = {}; }

  // PGNullTest clause
  //  Define SQL-style Null test clause.
  //  Allow two forms described in the standard:
  //     a IS NULL
  //     a IS NOT NULL
  //  Allow two SQL extensions
  //     a ISNULL
  //     a NOTNULL
  //  
  | sql_a_expr IS NULL_P                            %prec IS    { $$ = {}; }
  | sql_a_expr ISNULL                                           { $$ = {}; }
  | sql_a_expr IS NOT NULL_P                        %prec IS    { $$ = {}; }
  | sql_a_expr NOT NULL_P                                       { $$ = {}; }
  | sql_a_expr NOTNULL                                          { $$ = {}; }

  | sql_row OVERLAPS sql_row  { $$ = {}; }
  | sql_a_expr IS TRUE_P                            %prec IS    { $$ = {}; }
  | sql_a_expr IS NOT TRUE_P                        %prec IS    { $$ = {}; }
  | sql_a_expr IS FALSE_P                           %prec IS    { $$ = {}; }
  | sql_a_expr IS NOT FALSE_P                       %prec IS    { $$ = {}; }
  | sql_a_expr IS UNKNOWN                           %prec IS    { $$ = {}; }
  | sql_a_expr IS NOT UNKNOWN                       %prec IS    { $$ = {}; }
  | sql_a_expr IS DISTINCT FROM sql_a_expr          %prec IS    { $$ = {}; }
  | sql_a_expr IS NOT DISTINCT FROM sql_a_expr      %prec IS    { $$ = {}; }
  | sql_a_expr IS OF '(' sql_type_list ')'          %prec IS    { $$ = {}; }
  | sql_a_expr IS NOT OF '(' sql_type_list ')'      %prec IS    { $$ = {}; }

  | sql_a_expr BETWEEN sql_opt_asymmetric sql_b_expr AND sql_a_expr           %prec BETWEEN     { $$ = {}; }
  | sql_a_expr NOT_LA BETWEEN sql_opt_asymmetric sql_b_expr AND sql_a_expr    %prec NOT_LA      { $$ = {}; }
  | sql_a_expr BETWEEN SYMMETRIC sql_b_expr AND sql_a_expr                    %prec BETWEEN     { $$ = {}; }
  | sql_a_expr NOT_LA BETWEEN SYMMETRIC sql_b_expr AND sql_a_expr             %prec NOT_LA      { $$ = {}; }
  | sql_a_expr IN_P sql_in_expr                                                                 { $$ = {}; }
  | sql_a_expr NOT_LA IN_P sql_in_expr                                %prec NOT_LA              { $$ = {}; }
  | sql_a_expr sql_subquery_op sql_sub_type sql_select_with_parens    %prec Op                  { $$ = {}; }
  | sql_a_expr sql_subquery_op sql_sub_type '(' sql_a_expr ')'        %prec Op                  { $$ = {}; }
  | DEFAULT                                                                                     { $$ = {}; }
    ;

// Restricted expressions
//
// b_expr is a subset of the complete expression syntax defined by a_expr.
//
// Presently, AND, NOT, IS, and IN are the a_expr keywords that would
// cause trouble in the places where b_expr is used.  For simplicity, we
// just eliminate all the boolean-keyword-operator productions from b_expr.

sql_b_expr:
    sql_c_expr
  | sql_b_expr TYPECAST sql_typename
  | '+' sql_b_expr                      %prec UMINUS
  | '-' sql_b_expr                      %prec UMINUS
  | sql_b_expr '+' sql_b_expr
  | sql_b_expr '-' sql_b_expr
  | sql_b_expr '*' sql_b_expr
  | sql_b_expr '/' sql_b_expr
  | sql_b_expr '%' sql_b_expr
  | sql_b_expr '^' sql_b_expr
  | sql_b_expr '<' sql_b_expr
  | sql_b_expr '>' sql_b_expr
  | sql_b_expr '=' sql_b_expr
  | sql_b_expr LESS_EQUALS sql_b_expr
  | sql_b_expr GREATER_EQUALS sql_b_expr
  | sql_b_expr NOT_EQUALS sql_b_expr
  | sql_b_expr sql_qual_op sql_b_expr               %prec Op
  | sql_qual_op sql_b_expr                          %prec Op
  | sql_b_expr sql_qual_op                          %prec POSTFIXOP
  | sql_b_expr IS DISTINCT FROM sql_b_expr          %prec IS
  | sql_b_expr IS NOT DISTINCT FROM sql_b_expr      %prec IS
  | sql_b_expr IS OF '(' sql_type_list ')'          %prec IS
  | sql_b_expr IS NOT OF '(' sql_type_list ')'      %prec IS
    ;

// Productions that can be used in both a_expr and b_expr.
//
// Note: productions that refer recursively to a_expr or b_expr mostly
// cannot appear here.    However, it's OK to refer to a_exprs that occur
// inside parentheses, such as function arguments; that cannot introduce
// ambiguity to the b_expr syntax.

sql_c_expr:
    sql_columnref                                   { $$ = {}; }
  | sql_a_expr_const                                { $$ = $1; }
  | '?' sql_opt_indirection                         { $$ = {}; }
  | PARAM sql_opt_indirection                       { $$ = {}; }
  | '(' sql_a_expr ')' sql_opt_indirection          { $$ = {}; }
  | sql_case_expr                                   { $$ = {}; }
  | sql_func_expr                                   { $$ = {}; }
  | sql_select_with_parens      %prec UMINUS        { $$ = {}; }
  | sql_select_with_parens sql_indirection          { $$ = {}; }
  | EXISTS sql_select_with_parens                   { $$ = {}; }
    ;

sql_func_application:
    sql_func_name '(' ')'
  | sql_func_name '(' sql_func_arg_list sql_opt_sort_clause ')'
  | sql_func_name '(' VARIADIC sql_func_arg_expr sql_opt_sort_clause ')'
  | sql_func_name '(' sql_func_arg_list ',' VARIADIC sql_func_arg_expr sql_opt_sort_clause ')'
  | sql_func_name '(' ALL sql_func_arg_list sql_opt_sort_clause ')'
  | sql_func_name '(' DISTINCT sql_func_arg_list sql_opt_sort_clause ')'
  | sql_func_name '(' '*' ')'
    ;


// func_expr and its cousin func_expr_windowless are split out from c_expr just
// so that we have classifications for "everything that is a function call or
// looks like one".  This isn't very important, but it saves us having to
// document which variants are legal in places like "FROM function()" or the
// backwards-compatible functional-index syntax for CREATE INDEX.
// (Note that many of the special SQL functions wouldn't actually make any
// sense as functional index entries, but we ignore that consideration here.)

sql_func_expr:
    sql_func_application sql_within_group_clause sql_filter_clause sql_over_clause
  | sql_func_expr_common_subexpr

        ;

// As func_expr but does not accept WINDOW functions directly
// (but they can still be contained in arguments for functions etc).
// Use this when window expressions are not allowed, where needed to
// disambiguate the grammar (e.g. in CREATE INDEX).

sql_func_expr_windowless:
    sql_func_application
  | sql_func_expr_common_subexpr
    ;

// Special expressions that are considered to be functions.

sql_func_expr_common_subexpr:
    COLLATION FOR '(' sql_a_expr ')'
  | CURRENT_DATE
  | CURRENT_TIME
  | CURRENT_TIME '(' ICONST ')'
  | CURRENT_TIMESTAMP
  | CURRENT_TIMESTAMP '(' ICONST ')'
  | LOCALTIME
  | LOCALTIME '(' ICONST ')'
  | LOCALTIMESTAMP
  | LOCALTIMESTAMP '(' ICONST ')'
  | CURRENT_ROLE
  | CURRENT_USER
  | SESSION_USER
  | USER
  | CURRENT_CATALOG
  | CURRENT_SCHEMA
  | CAST '(' sql_a_expr AS sql_typename ')'
  | EXTRACT '(' sql_extract_list ')'
  | OVERLAY '(' sql_overlay_list ')'
  | POSITION '(' sql_position_list ')'
  | SUBSTRING '(' sql_substr_list ')'
  | TREAT '(' sql_a_expr AS sql_typename ')'
  | TRIM '(' BOTH sql_trim_list ')'
  | TRIM '(' LEADING sql_trim_list ')'
  | TRIM '(' TRAILING sql_trim_list ')'
  | TRIM '(' sql_trim_list ')'
  | NULLIF '(' sql_a_expr ',' sql_a_expr ')'
  | COALESCE '(' sql_expr_list ')'
    ;

// We allow several variants for SQL and other compatibility. */
//
// Aggregate decoration clauses

sql_within_group_clause:
    WITHIN GROUP_P '(' sql_sort_clause ')'
  | %empty
    ;

sql_filter_clause:
    FILTER '(' WHERE sql_a_expr ')'
  | %empty
    ;


// Window Definitions

sql_window_clause:
    WINDOW sql_window_definition_list
  | %empty
    ;

sql_window_definition_list:
    sql_window_definition
  | sql_window_definition_list ',' sql_window_definition
    ;

sql_window_definition:
    sql_col_id AS sql_window_specification
    ;

sql_over_clause:
    OVER sql_window_specification
  | OVER sql_col_id
  | %empty
    ;

sql_window_specification:
    '(' sql_opt_existing_window_name sql_opt_partition_clause sql_opt_sort_clause sql_opt_frame_clause ')'
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
    sql_col_id
  | %empty                %prec Op
    ;

sql_opt_partition_clause:
    PARTITION BY sql_expr_list
  | %empty
    ;

// For frame clauses, we return a PGWindowDef, but only some fields are used:
// frameOptions, startOffset, and endOffset.
//
// This is only a subset of the full SQL:2008 frame_clause grammar.
// We don't support <window frame exclusion> yet.

sql_opt_frame_clause:
    RANGE sql_frame_extent
  | ROWS sql_frame_extent
  | %empty
    ;

sql_frame_extent:
    sql_frame_bound
  | BETWEEN sql_frame_bound AND sql_frame_bound
    ;

sql_frame_bound:
    UNBOUNDED PRECEDING
  | UNBOUNDED FOLLOWING
  | CURRENT_P ROW
  | sql_a_expr PRECEDING
  | sql_a_expr FOLLOWING
    ;


// Supporting nonterminals for expressions.

// Explicit row production.
//
// SQL99 allows an optional ROW keyword, so we can now do single-element rows
// without conflicting with the parenthesized a_expr production.  Without the
// ROW keyword, there must be more than one a_expr inside the parens.

sql_row:
    ROW '(' sql_expr_list ')'
  | ROW '(' ')'
  | '(' sql_expr_list ',' sql_a_expr ')'
    ;

sql_sub_type:
    ANY
  | SOME
  | ALL
    ;

sql_all_op:
    Op
  | sql_math_op
    ;

sql_math_op:
    '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '^'
  | '<'
  | '>'
  | '='
  | LESS_EQUALS
  | GREATER_EQUALS
  | NOT_EQUALS
    ; 
sql_qual_op:
    Op
  | OPERATOR '(' sql_any_operator ')'
    ;

sql_qual_all_op:
    sql_all_op
  | OPERATOR '(' sql_any_operator ')'
    ;

// cannot put SIMILAR TO into sql_subquery_op, because SIMILAR TO is a hack.
// the regular expression is preprocessed by a function (similar_escape),
// and the ~ operator for posix regular expressions is used.
//        x SIMILAR TO y     ->    x ~ similar_escape(y)
// this transformation is made on the fly by the parser upwards.
// however the PGSubLink structure which handles any/some/all stuff
// is not ready for such a thing.

sql_subquery_op:
    sql_all_op
  | OPERATOR '(' sql_any_operator ')'
  | LIKE
  | NOT_LA LIKE
  | GLOB
  | NOT_LA GLOB
  | ILIKE
  | NOT_LA ILIKE
    ;

sql_any_operator:
    sql_all_op
  | sql_col_id '.' sql_any_operator
    ;

sql_expr_list:
    sql_a_expr
  | sql_expr_list ',' sql_a_expr
    ;

sql_func_arg_list:
    sql_func_arg_expr
  | sql_func_arg_list ',' sql_func_arg_expr
    ;

sql_func_arg_expr:
    sql_a_expr
  | sql_param_name COLON_EQUALS sql_a_expr
  | sql_param_name EQUALS_GREATER sql_a_expr
    ;

sql_type_list:
    sql_typename
  | sql_type_list ',' sql_typename
    ;

sql_extract_list:
    sql_extract_arg FROM sql_a_expr
  | %empty
    ;

// Allow delimited string Sconst in extract_arg as an SQL extension.
// - thomas 2001-04-12
sql_extract_arg:
    IDENT
  | YEAR_P
  | MONTH_P
  | DAY_P
  | HOUR_P
  | MINUTE_P
  | SECOND_P
  | SCONST
    ;

// OVERLAY() arguments
// SQL99 defines the OVERLAY() function:
//  - overlay(text placing text from int for int)
//  - overlay(text placing text from int)
// and similarly for binary strings

sql_overlay_list:
    sql_a_expr sql_overlay_placing sql_substr_from sql_substr_for
  | sql_a_expr sql_overlay_placing sql_substr_from
    ;

sql_overlay_placing:
    PLACING sql_a_expr
    ;

// position_list uses b_expr not a_expr to avoid conflict with general IN

sql_position_list:
    sql_b_expr IN_P sql_b_expr
  | %empty
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
    sql_a_expr sql_substr_from sql_substr_for
  | sql_a_expr sql_substr_for sql_substr_from
  | sql_a_expr sql_substr_from
  | sql_a_expr sql_substr_for
  | sql_expr_list
  | %empty
    ;

sql_substr_from:
    FROM sql_a_expr
    ;

sql_substr_for:
    FOR sql_a_expr
    ;

sql_trim_list:
    sql_a_expr FROM sql_expr_list
  | FROM sql_expr_list
  | sql_expr_list
    ;

sql_in_expr:
    sql_select_with_parens
  | '(' sql_expr_list ')'
    ;

// Define SQL-style CASE clause.
//  - Full specification
//    CASE WHEN a = b THEN c ... ELSE d END
//  - Implicit argument
//    CASE a WHEN b THEN c ... ELSE d END

sql_case_expr:
    CASE sql_case_arg sql_when_clause_list sql_case_default END_P
    ;

sql_when_clause_list:
    // There must be at least one
    sql_when_clause
  | sql_when_clause_list sql_when_clause
    ;

sql_when_clause:
    WHEN sql_a_expr THEN sql_a_expr
    ;

sql_case_default:
    ELSE sql_a_expr
  | %empty
    ;

sql_case_arg:
    sql_a_expr
  | %empty
    ;

sql_columnref:
    sql_col_id                  { $$ = { ctx.Ref(@1) }; }
  | sql_col_id sql_indirection  { $2.push_back(ctx.Ref(@1)); $$ = move($2); }
    ;

sql_indirection_el:
    '.' sql_attr_name       { $$ = ctx.Ref(@2); }
  | '.' '*'                 { $$ = ctx.Ref(@2); }
  | '[' sql_a_expr ']'      { $$ = ctx.AddIndirection(@$, $2); }
  | '[' sql_opt_slice_bound ':' sql_opt_slice_bound ']'     { $$ = ctx.AddIndirection(@$, $2, $4); }
    ;

sql_opt_slice_bound:
    sql_a_expr          { $$ = $1; }
  | %empty              { $$ = std::nullopt; }
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
    ASYMMETRIC
  | %empty
    ;


// ---------------------------------------------------------------------------
// Target list for SELECT

sql_opt_target_list:
    sql_target_list     { $$ = $1; }
  | %empty              { $$ = {}; }
    ;

sql_target_list:
    sql_target_el                       { $$ = { $1 }; }
  | sql_target_list ',' sql_target_el   { $1.push_back($3); $$ = move($1); }
    ;

sql_target_el:
    sql_a_expr AS sql_col_label_or_string       { $$ = {}; }

    // We support omitting AS only for column labels that aren't
    // any known keyword.  There is an ambiguity against postfix
    // operators: is "a ! b" an infix expression, or a postfix
    // expression and a column label?  We prefer to resolve this
    // as an infix expression, which we accomplish by assigning
    // IDENT a precedence higher than POSTFIXOP.

  | sql_a_expr IDENT {
        $$ = ctx.Add(@$, sx::NodeType::SQL_RESULT_TARGET, {
            Key::SQL_RESULT_TARGET_VALUE << $1,
            Key::SQL_RESULT_TARGET_NAME << ctx.Ref(@2),
        });
    }
  | sql_a_expr {
        $$ = ctx.Add(@$, sx::NodeType::SQL_RESULT_TARGET, {
            Key::SQL_RESULT_TARGET_VALUE << $1,
        });
    }
  | '*'         { $$ = {}; }
    ;


// ---------------------------------------------------------------------------
// Names and constants

sql_qualified_name_list:
    sql_qualified_name                              { $$ = { move($1) }; }
  | sql_qualified_name_list ',' sql_qualified_name  { $1.push_back(move($3)); $$ = move($1); }
    ;

// The production for a qualified relation name has to exactly match the
// production for a qualified func_name, because in a FROM clause we cannot
// tell which we are parsing until we see what comes after it ('(' for a
// func_name, something else for a relation). Therefore we allow 'indirection'
// which may contain subscripts, and reject that case in the C code.

sql_qualified_name:
    sql_col_id                      { $$ = { ctx.Ref(@1) }; };
  | sql_col_id sql_indirection      { $2.insert($2.begin(), ctx.Ref(@1)); $$ = move($2); };
    ;

sql_name_list:
    sql_name                        { $$ = {}; $$.push_back(ctx.Ref(@1)); }
  | sql_name_list ',' sql_name      { $1.push_back(ctx.Ref(@3)); $$ = move($1); }
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
    sql_type_function_name
  | sql_col_id sql_indirection
    ;

// Constants
sql_a_expr_const:
    ICONST  { $$ = ctx.AddConst(@1, sxs::AConstType::INTEGER); }
  | FCONST  { $$ = ctx.AddConst(@1, sxs::AConstType::FLOAT); }
  | SCONST  { $$ = ctx.AddConst(@1, sxs::AConstType::STRING); }
  | BCONST  { $$ = ctx.AddConst(@1, sxs::AConstType::BITSTRING); }
  | XCONST  { $$ = ctx.AddConst(@1, sxs::AConstType::BITSTRING); }
  | sql_func_name SCONST                                                { $$ = {}; }
  | sql_func_name '(' sql_func_arg_list sql_opt_sort_clause ')' SCONST  { $$ = {}; }
  | sql_const_typename SCONST                                           { $$ = {}; }
  | sql_const_interval SCONST sql_opt_interval                          { $$ = {}; }
  | sql_const_interval '(' ICONST ')' SCONST                            { $$ = {}; }

    // Version without () is handled in a_expr/b_expr logic due to ? mis-parsing as operator */
  | sql_const_interval '(' '?' ')' '?' sql_opt_interval                 { $$ = {}; }
  | TRUE_P                  { $$ = {}; }
  | FALSE_P                 { $$ = {}; }
  | NULL_P                  { $$ = {}; }
    ;

// Name classification hierarchy.
//
// IDENT is the lexeme returned by the lexer for identifiers that match
// no known keyword.  In most cases, we can accept certain keywords as
// names, not only IDENTs.    We prefer to accept as many such keywords
// as possible to minimize the impact of "reserved words" on programmers.
// So, we divide names into several possible classes.  The classification
// is chosen in part to make keywords acceptable as names wherever possible.

// Column identifier --- names that can be column, table, etc names.

sql_col_id:
    IDENT
  | sql_unreserved_keywords
  | sql_column_name_keywords
    ;

sql_col_id_or_string:
    sql_col_id
  | SCONST
    ;

// Type/function identifier --- names that can be type or function names.

sql_type_function_name:
    IDENT
  | sql_unreserved_keywords
  | sql_type_func_keywords
    ;

sql_any_name:
    sql_col_id
  | sql_col_id sql_attrs
    ;

sql_attrs:
    '.' sql_attr_name
  | sql_attrs '.' sql_attr_name
    ;

sql_opt_name_list:
    '(' sql_name_list ')'
  | %empty
    ;

sql_param_name:
    sql_type_function_name
    ;

// Any not-fully-reserved word --- these names can be, eg, role names.

// Column label --- allowed labels in "AS" clauses.
// This presently includes *all* Postgres keywords.

sql_col_label:
    IDENT
  | sql_unreserved_keywords
  | sql_column_name_keywords
  | sql_type_func_keywords
  | sql_reserved_keywords
  | dashql_keywords
    ;

sql_col_label_or_string:
    sql_col_label
  | SCONST
    ;
