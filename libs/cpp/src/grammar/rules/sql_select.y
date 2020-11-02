/* A complete SELECT statement looks like this.
 *
 * The rule returns either a single PGSelectStmt node or a tree of them,
 * representing a set-operation tree.
 *
 * There is an ambiguity when a sub-SELECT is within an a_expr and there
 * are excess parentheses: do the parentheses belong to the sub-SELECT or
 * to the surrounding a_expr?  We don't really care, but bison wants to know.
 * To resolve the ambiguity, we are careful to define the grammar so that
 * the decision is staved off as long as possible: as long as we can keep
 * absorbing parentheses into the sub-SELECT, we will do so, and only when
 * it's no longer possible to do that will we decide that parens belong to
 * the expression.  For example, in "SELECT (((SELECT 2)) + 3)" the extra
 * parentheses are treated as part of the sub-select.  The necessity of doing
 * it that way is shown by "SELECT (((SELECT 2)) UNION SELECT 2)".  Had we
 * parsed "((SELECT 2))" as an a_expr, it'd be too late to go back to the
 * SELECT viewpoint when we see the UNION.
 *
 * This approach is implemented by defining a nonterminal select_with_parens,
 * which represents a SELECT with at least one outer layer of parentheses,
 * and being careful to use select_with_parens, never '(' PGSelectStmt ')',
 * in the expression grammar.  We will then have shift-reduce conflicts
 * which we can resolve in favor of always treating '(' <select> ')' as
 * a select_with_parens.  To resolve the conflicts, the productions that
 * conflict with the select_with_parens productions are manually given
 * precedences lower than the precedence of ')', thereby ensuring that we
 * shift ')' (and then reduce to select_with_parens) rather than trying to
 * reduce the inner <select> nonterminal to something else.  We use UMINUS
 * precedence for this, which is a fairly arbitrary choice.
 *
 * To be able to define select_with_parens itself without ambiguity, we need
 * a nonterminal select_no_parens that represents a SELECT structure with no
 * outermost parentheses.  This is a little bit tedious, but it works.
 *
 * In non-expression contexts, we use PGSelectStmt which can represent a SELECT
 * with or without outer parentheses.
 */

sql_select_statement:
    '(' sql_select_statement ')'    { $$ = $2; }
  | sql_select_no_parens            { $$ = $1; }
    ;

sql_select_no_parens:
    sql_simple_select               { $$ = $1; }
    ;

sql_simple_select:
    SELECT sql_opt_target_list {
        $$ = ctx.CreateObject(@$, sx::ObjectType::SQL_SELECT, {
            {@2, sx::AttributeKey::SQL_SELECT_TARGETS, ctx.AddArray(@2, $2)},
        });
    }
    ;


/*
 * General expressions
 * This is the heart of the expression syntax.
 *
 * We have two expression types: a_expr is the unrestricted kind, and
 * b_expr is a subset that must be used in some places to avoid shift/reduce
 * conflicts.  For example, we can't do BETWEEN as "BETWEEN a_expr AND a_expr"
 * because that use of AND conflicts with AND as a boolean operator.  So,
 * b_expr is used in BETWEEN and we remove boolean keywords from b_expr.
 *
 * Note that '(' a_expr ')' is a b_expr, so an unrestricted expression can
 * always be used by surrounding it with parens.
 *
 * c_expr is all the productions that are common to a_expr and b_expr;
 * it's factored out just to eliminate redundant coding.
 *
 * Be careful of productions involving more than one terminal token.
 * By default, bison will assign such productions the precedence of their
 * last terminal, but in nearly all cases you want it to be the precedence
 * of the first terminal instead; otherwise you will not get the behavior
 * you expect!  So we use %prec annotations freely to set precedences.
 */
sql_a_expr:
    sql_c_expr                      { $$ = $1; }
    ;

/*
 * Productions that can be used in both a_expr and b_expr.
 *
 * Note: productions that refer recursively to a_expr or b_expr mostly
 * cannot appear here.  However, it's OK to refer to a_exprs that occur
 * inside parentheses, such as function arguments; that cannot introduce
 * ambiguity to the b_expr syntax.
 */
sql_c_expr:
    sql_a_expr_const                { $$ = $1; }
    ;

/*
 * Constants
 */
sql_a_expr_const:
    sql_iconst {
        $$ = ctx.CreateObject(@$, sx::ObjectType::SQL_ACONST, {
            {@$, sx::AttributeKey::SQL_ACONST_TYPE, ctx.CreateEnum(@$, sxs::AConstType::INTEGER)},
            {@$, sx::AttributeKey::SQL_ACONST_VALUE, $1},
        });
    }
  | FCONST {
        $$ = ctx.CreateObject(@$, sx::ObjectType::SQL_ACONST, {
            {@$, sx::AttributeKey::SQL_ACONST_TYPE, ctx.CreateEnum(@$, sxs::AConstType::FLOAT)},
        });
    }
  | SCONST {
        $$ = ctx.CreateObject(@$, sx::ObjectType::SQL_ACONST, {
            {@$, sx::AttributeKey::SQL_ACONST_TYPE, ctx.CreateEnum(@$, sxs::AConstType::STRING)},
        });
    }
  | BCONST {
        $$ = ctx.CreateObject(@$, sx::ObjectType::SQL_ACONST, {
            {@$, sx::AttributeKey::SQL_ACONST_TYPE, ctx.CreateEnum(@$, sxs::AConstType::BITSTRING)},
        });
   }
  | XCONST {
        /* This is a bit constant per SQL99:
        * Without Feature F511, "BIT data type",
        * a <general literal> shall not be a
        * <bit string literal> or a <hex string literal>.
        */
        $$ = ctx.CreateObject(@$, sx::ObjectType::SQL_ACONST, {
            {@$, sx::AttributeKey::SQL_ACONST_TYPE, ctx.CreateEnum(@$, sxs::AConstType::BITSTRING)},
        });
    }
    ;

sql_iconst: ICONST { $$ = sx::Value(@1, sx::ValueType::I64, $1); };
sql_ident: IDENT { $$ = sx::Value(@1, sx::ValueType::STRING, 0); };

// ---------------------------------------------------------------------------
// Define SQL-style CASE clause.
//  - Full specification
//    CASE WHEN a = b THEN c ... ELSE d END
//  - Implicit argument
//    CASE a WHEN b THEN c ... ELSE d END

sql_case_expr:
    CASE sql_case_arg sql_when_clause_list sql_case_default END_P
    ;

sql_when_clause_list:
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

sql_column_ref:
    sql_col_id
  | sql_col_id sql_indirection
    ;

sql_indirection_el:
    '.' sql_attr_name
  | '.' '*'
  | '[' sql_a_expr ']'
  | '[' sql_opt_slice_bound ':' sql_opt_slice_bound ']'
    ;

sql_opt_slice_bound:
    sql_a_expr
  | %empty
    ;

sql_indirection:
    sql_indirection_el
  | sql_indirection sql_indirection_el
    ;

sql_opt_indirection:
    %empty
  | sql_opt_indirection sql_indirection_el
    ;

sql_opt_asymmetric: ASYMMETRIC | %empty;

/*
 * Target list for SELECT
 */

sql_opt_target_list:
    sql_target_list { $$ = $1; }
  | %empty          { $$ = {}; }
    ;

sql_target_list:
    sql_target_list ',' sql_target_el   { $1.push_back($3); $$ = move($1); }
 |  sql_target_el                       { $$ = { $1 }; }
    ;

sql_target_el:
    sql_a_expr sql_ident {
        $$ = ctx.CreateObject(@$, sx::ObjectType::SQL_RESULT_TARGET, {
            {@$, sx::AttributeKey::SQL_RESULT_TARGET_VALUE, ctx.AddObject($1)},
            {@$, sx::AttributeKey::SQL_RESULT_TARGET_NAME, $2},
        });
    }
  | sql_a_expr {
        $$ = ctx.CreateObject(@$, sx::ObjectType::SQL_RESULT_TARGET, {
            {@$, sx::AttributeKey::SQL_RESULT_TARGET_VALUE, ctx.AddObject($1)},
        });
    }
    ;

sql_name_list:
    sql_name                    { $$ = {}; $$.push_back(@1); }
  | sql_name_list ',' sql_name  { $1.push_back(@3); $$ = move($1); }
    ;

sql_name: sql_col_id;
sql_attr_name: sql_col_label;


// ---------------------------------------------------------------------------
// Name classification hierarchy.
// 
// IDENT is the lexeme returned by the lexer for identifiers that match
// no known keyword.  In most cases, we can accept certain keywords as
// names, not only IDENTs.	We prefer to accept as many such keywords
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

// Any not-fully-reserved word --- these names can be, eg, role names.
// 
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
