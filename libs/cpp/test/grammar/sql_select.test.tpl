name: select_iconst_1
input: |-
  select 1
----
name: select_fconst_1e04
input: |-
  select 1e-04
----
name: select_fconst_realfail1
input: |-
  select 1e
----
name: select_bconst_b1010
input: |-
  select b'1010'
----
name: select_bconst_x2a
input: |-
  select x'2a'
----
name: select_sconst_quotes
input: |-
  select 'foo'
----
name: select_sconst_quotes_nested_quote
input: |-
  select '''foo'''
----
name: select_sconst_quotes_nested_dquote
input: |-
  select '"foo"'
----
name: select_iconst_1_ident
input: |-
  select 1 "foo"
----
name: comments_cstyle
input: |-
  /* foo */
----
name: comments_cstyle_nested
input: |-
  /* foo /* bar */ */
----
name: select_iconst_list
input: |-
  select 1, 2
----
name: select_from_1rel
input: |-
  select a from b
----
name: select_from_1rel_indirect1
input: |-
  select a from b.c
----
name: select_from_1rel_indirect1_noinherit
input: |-
  select a from only b.c
----
name: select_from_1rel_indirect1_alias
input: |-
  select a from b.c as d
----
name: select_from_2rel
input: |-
  select a from b, c
----
name: select_from_into_2rel
input: |-
  select a into b from c, d
----
name: select_from_1rel_group1
input: |-
  select a from b group by 1
----
name: select_from_1rel_window_empty
input: |-
  select a from b window c as ()
----
name: select_from_1rel_window_partition1
input: |-
  select a from b window c as (partition by d)
----
name: select_from_1rel_window_partition1_rows_unbounded
input: |-
  select a from b
  window c as (partition by d rows between unbounded preceding and unbounded following)
----
name: select_from_1rel_window_partition1_rows_1preceding_current
input: |-
  select a from b
  window c as (partition by d rows between 1 preceding and current row)
----
name: select_from_1rel_2windows
input: |-
  select a from b
  window c as (partition by d range between current row and 1 following),
         e as (partition by f)
----
name: select_distinct_from_1rel
input: |-
  select distinct a from b
----
name: select_distinct_on_from_1rel
input: |-
  select distinct on (a) a from b
----
name: select_all_from_1rel
input: |-
  select all from b
----
name: values_1
input: |-
  values (1)
----
name: values_1_2
input: |-
  values (1), (2);
----
name: values_12_34
input: |-
  values (1, 2), (3, 4)
----
name: table_a
input: |-
  TABLE a
