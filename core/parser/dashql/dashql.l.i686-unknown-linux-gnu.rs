 mod dashql_l {
use lrlex::{LexerDef, LRNonStreamingLexerDef, Rule};

#[allow(dead_code)]
pub fn lexerdef() -> LRNonStreamingLexerDef<u32> {
    let rules = vec![
Rule::new(Some(0), None, "[\\t ]+".to_string()).unwrap(),
Rule::new(Some(1), None, "\\n".to_string()).unwrap(),
Rule::new(Some(27), Some(",".to_string()), ",".to_string()).unwrap(),
Rule::new(Some(3), Some(";".to_string()), ";".to_string()).unwrap(),
Rule::new(None, Some("\'".to_string()), "'".to_string()).unwrap(),
Rule::new(None, Some("\"".to_string()), "\"".to_string()).unwrap(),
Rule::new(None, Some(".".to_string()), "\\.".to_string()).unwrap(),
Rule::new(Some(25), Some("(".to_string()), "\\(".to_string()).unwrap(),
Rule::new(Some(26), Some(")".to_string()), "\\)".to_string()).unwrap(),
Rule::new(None, Some("[".to_string()), "\\[".to_string()).unwrap(),
Rule::new(None, Some("]".to_string()), "\\]".to_string()).unwrap(),
Rule::new(None, Some("*".to_string()), "\\*".to_string()).unwrap(),
Rule::new(None, Some("+".to_string()), "\\+".to_string()).unwrap(),
Rule::new(Some(28), Some("=".to_string()), "=".to_string()).unwrap(),
Rule::new(Some(29), Some("$".to_string()), "$".to_string()).unwrap(),
Rule::new(Some(6), Some("AS".to_string()), "(?i)as".to_string()).unwrap(),
Rule::new(Some(7), Some("DATE".to_string()), "(?i)date".to_string()).unwrap(),
Rule::new(Some(8), Some("DATETIME".to_string()), "(?i)datetime".to_string()).unwrap(),
Rule::new(Some(0), Some("DECLARE".to_string()), "(?i)declare".to_string()).unwrap(),
Rule::new(Some(9), Some("EXTRACT".to_string()), "(?i)extract".to_string()).unwrap(),
Rule::new(Some(10), Some("FILE".to_string()), "(?i)file".to_string()).unwrap(),
Rule::new(Some(11), Some("FLOAT".to_string()), "(?i)float".to_string()).unwrap(),
Rule::new(Some(12), Some("FROM".to_string()), "(?i)from".to_string()).unwrap(),
Rule::new(Some(13), Some("GET".to_string()), "(?i)get".to_string()).unwrap(),
Rule::new(Some(14), Some("HTTP".to_string()), "(?i)http".to_string()).unwrap(),
Rule::new(Some(15), Some("INTEGER".to_string()), "(?i)integer".to_string()).unwrap(),
Rule::new(Some(16), Some("LOAD".to_string()), "(?i)load".to_string()).unwrap(),
Rule::new(Some(17), Some("METHOD".to_string()), "(?i)method".to_string()).unwrap(),
Rule::new(Some(1), Some("PARAMETER".to_string()), "(?i)parameter".to_string()).unwrap(),
Rule::new(Some(18), Some("POST".to_string()), "(?i)post".to_string()).unwrap(),
Rule::new(Some(19), Some("PUT".to_string()), "(?i)put".to_string()).unwrap(),
Rule::new(Some(20), Some("QUERY".to_string()), "(?i)query".to_string()).unwrap(),
Rule::new(Some(21), Some("TEXT".to_string()), "(?i)text".to_string()).unwrap(),
Rule::new(Some(22), Some("TIME".to_string()), "(?i)time".to_string()).unwrap(),
Rule::new(Some(2), Some("TYPE".to_string()), "(?i)type".to_string()).unwrap(),
Rule::new(Some(23), Some("URL".to_string()), "(?i)url".to_string()).unwrap(),
Rule::new(Some(24), Some("VISUALIZE".to_string()), "(?i)visualize".to_string()).unwrap(),
Rule::new(Some(4), Some("SINGLY_QUOTED_STRING".to_string()), "'(\\\\.|[^\\\\'])*'".to_string()).unwrap(),
Rule::new(None, Some("DOUBLY_QUOTED_STRING".to_string()), "\"(\\\\.|[^\\\\\"])*\"".to_string()).unwrap(),
Rule::new(Some(5), Some("IDENTIFIER".to_string()), "(?i)[a-z][a-z0-9_]*".to_string()).unwrap(),
];
    LRNonStreamingLexerDef::from_rules(rules)
}
#[allow(dead_code)]
pub const T_TYPE: u32 = 2;
#[allow(dead_code)]
pub const T_IDENTIFIER: u32 = 5;
#[allow(dead_code)]
pub const T_URL: u32 = 23;
#[allow(dead_code)]
pub const T_PARAMETER: u32 = 1;
#[allow(dead_code)]
pub const T_QUERY: u32 = 20;
#[allow(dead_code)]
pub const T_PUT: u32 = 19;
#[allow(dead_code)]
pub const T_EXTRACT: u32 = 9;
#[allow(dead_code)]
pub const T_POST: u32 = 18;
#[allow(dead_code)]
pub const T_GET: u32 = 13;
#[allow(dead_code)]
pub const T_INTEGER: u32 = 15;
#[allow(dead_code)]
pub const T_TEXT: u32 = 21;
#[allow(dead_code)]
pub const T_DATETIME: u32 = 8;
#[allow(dead_code)]
pub const T_FROM: u32 = 12;
#[allow(dead_code)]
pub const T_AS: u32 = 6;
#[allow(dead_code)]
pub const T_HTTP: u32 = 14;
#[allow(dead_code)]
pub const T_DATE: u32 = 7;
#[allow(dead_code)]
pub const T_FILE: u32 = 10;
#[allow(dead_code)]
pub const T_VISUALIZE: u32 = 24;
#[allow(dead_code)]
pub const T_SINGLY_QUOTED_STRING: u32 = 4;
#[allow(dead_code)]
pub const T_LOAD: u32 = 16;
#[allow(dead_code)]
pub const T_METHOD: u32 = 17;
#[allow(dead_code)]
pub const T_DECLARE: u32 = 0;
#[allow(dead_code)]
pub const T_TIME: u32 = 22;
#[allow(dead_code)]
pub const T_FLOAT: u32 = 11;
}