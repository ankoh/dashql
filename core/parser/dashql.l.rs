 mod dashql_l {
use lrlex::{LexerDef, LRNonStreamingLexerDef, Rule};

#[allow(dead_code)]
pub fn lexerdef() -> LRNonStreamingLexerDef<u32> {
    let rules = vec![
Rule::new(Some(0), None, "[\\t ]+".to_string()).unwrap(),
Rule::new(Some(1), None, "\\n".to_string()).unwrap(),
Rule::new(Some(0), Some("foo".to_string()), "foo".to_string()).unwrap(),
];
    LRNonStreamingLexerDef::from_rules(rules)
}
#[allow(dead_code)]
pub const T_FOO: u32 = 0;
}