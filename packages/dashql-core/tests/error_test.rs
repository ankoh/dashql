//! Tests of the errors of the core: status errors carry the variant name as message and the default
//! message as `what()`, other errors carry their own message.

use dashql_buffers::status::StatusCode;
use dashql_core::error::{default_message, Error};

#[test]
fn status_errors_carry_the_variant_name() {
    let error = Error::status(StatusCode::SCRIPT_NOT_PARSED);
    assert_eq!(error.status, Some(StatusCode::SCRIPT_NOT_PARSED));
    assert_eq!(error.message, "SCRIPT_NOT_PARSED");
    assert_eq!(error.to_string(), "SCRIPT_NOT_PARSED");
    assert_eq!(error.what(), "Script is not parsed");
}

#[test]
fn invalid_arguments_carry_their_message() {
    let error = Error::invalid_argument("bad input");
    assert_eq!(error.status, None);
    assert_eq!(error.message, "bad input");
    assert_eq!(error.to_string(), "bad input");
    assert_eq!(error.what(), "bad input");
    let _: &dyn std::error::Error = &error;
}

#[test]
fn unknown_status_codes_have_no_variant_name() {
    let error = Error::status(StatusCode(200));
    assert_eq!(error.message, "");
    assert_eq!(error.what(), "Unknown error");
}

#[test]
fn every_status_code_has_a_default_message() {
    for &code in StatusCode::ENUM_VALUES {
        let message = default_message(code);
        assert_eq!(Error::status(code).what(), message, "{code:?}");
        if code == StatusCode::OK {
            assert_eq!(message, "");
        } else {
            assert!(!message.is_empty(), "{code:?}");
            assert_ne!(message, "Unknown error", "{code:?}");
        }
    }
}
