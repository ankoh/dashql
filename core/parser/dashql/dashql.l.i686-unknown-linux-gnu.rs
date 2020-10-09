 mod dashql_l {
use lrlex::{LexerDef, LRNonStreamingLexerDef, Rule};

#[allow(dead_code)]
pub fn lexerdef() -> LRNonStreamingLexerDef<u32> {
    let rules = vec![
Rule::new(Some(0), None, "[\\t ]+".to_string()).unwrap(),
Rule::new(Some(1), None, "\\n".to_string()).unwrap(),
Rule::new(None, Some(",".to_string()), ",".to_string()).unwrap(),
Rule::new(Some(0), Some(";".to_string()), ";".to_string()).unwrap(),
Rule::new(None, Some("\'".to_string()), "'".to_string()).unwrap(),
Rule::new(None, Some("\"".to_string()), "\"".to_string()).unwrap(),
Rule::new(None, Some(".".to_string()), "\\.".to_string()).unwrap(),
Rule::new(None, Some("(".to_string()), "\\(".to_string()).unwrap(),
Rule::new(None, Some(")".to_string()), "\\)".to_string()).unwrap(),
Rule::new(None, Some("[".to_string()), "\\[".to_string()).unwrap(),
Rule::new(None, Some("]".to_string()), "\\]".to_string()).unwrap(),
Rule::new(None, Some("*".to_string()), "\\*".to_string()).unwrap(),
Rule::new(None, Some("+".to_string()), "\\+".to_string()).unwrap(),
Rule::new(None, Some("=".to_string()), "=".to_string()).unwrap(),
Rule::new(Some(1), Some("declare".to_string()), "(?i)declare".to_string()).unwrap(),
Rule::new(Some(4), Some("extract".to_string()), "(?i)extract".to_string()).unwrap(),
Rule::new(Some(3), Some("load".to_string()), "(?i)load".to_string()).unwrap(),
Rule::new(Some(2), Some("parameter".to_string()), "(?i)parameter".to_string()).unwrap(),
Rule::new(Some(5), Some("query".to_string()), "(?i)query".to_string()).unwrap(),
Rule::new(Some(6), Some("visualize".to_string()), "(?i)visualize".to_string()).unwrap(),
];
    LRNonStreamingLexerDef::from_rules(rules)
}
#[allow(dead_code)]
pub const T_PARAMETER: u32 = 2;
#[allow(dead_code)]
pub const T_EXTRACT: u32 = 4;
#[allow(dead_code)]
pub const T_QUERY: u32 = 5;
#[allow(dead_code)]
pub const T_VISUALIZE: u32 = 6;
#[allow(dead_code)]
pub const T_DECLARE: u32 = 1;
#[allow(dead_code)]
pub const T_LOAD: u32 = 3;
}