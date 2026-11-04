//! Tests of identifier quoting.

use dashql_core::utils::quote_identifier as quote;

#[test]
fn bare_identifier_stays_unquoted() {
    assert_eq!(quote("foo"), "foo");
    assert_eq!(quote("foo_bar"), "foo_bar");
    assert_eq!(quote("_foo"), "_foo");
    assert_eq!(quote("foo123"), "foo123");
    assert_eq!(quote("foo$bar"), "foo$bar");
}

#[test]
fn upper_case_gets_quoted() {
    assert_eq!(quote("Foo"), "\"Foo\"");
    assert_eq!(quote("FOO"), "\"FOO\"");
}

#[test]
fn invalid_bare_characters_get_quoted() {
    // Slash isn't a valid identifier character, so it must be quoted.
    assert_eq!(quote("vis_data/vega_cars"), "\"vis_data/vega_cars\"");
    assert_eq!(quote("a.b"), "\"a.b\"");
    assert_eq!(quote("a b"), "\"a b\"");
    assert_eq!(quote("a-b"), "\"a-b\"");
}

#[test]
fn leading_digit_gets_quoted() {
    assert_eq!(quote("123abc"), "\"123abc\"");
}

#[test]
fn empty_gets_quoted() {
    assert_eq!(quote(""), "\"\"");
}

#[test]
fn embedded_quotes_are_doubled() {
    assert_eq!(quote("a\"b"), "\"a\"\"b\"");
}

#[test]
fn column_names_quote_keywords_that_are_not_unreserved() {
    use dashql_core::utils::quote_column_name;
    assert_eq!(quote_column_name("foo"), "foo");
    assert_eq!(quote_column_name("name"), "name");
    assert_eq!(quote_column_name("year"), "year");
    assert_eq!(quote_column_name("user"), "\"user\"");
    assert_eq!(quote_column_name("order"), "\"order\"");
    assert_eq!(quote_column_name("null"), "\"null\"");
    assert_eq!(quote_column_name("position"), "\"position\"");
    assert_eq!(quote_column_name("left"), "\"left\"");
    assert_eq!(quote_column_name("Order"), "\"Order\"");
    assert_eq!(quote_column_name("?column?"), "\"?column?\"");
}
