#![allow(unused_attributes)]
#![feature(trait_alias)]

pub mod context;

pub mod parser {
    #[allow(unused_imports)]
    use super::context;

    include!("dashql.l.rs");
    include!("dashql.y.rs");

    pub mod dashql_lexer {
        pub use super::dashql_l::*;
    }

    pub mod dashql_parser {
        pub use super::dashql_y::*;
    }
}

pub use self::parser::*;
