 mod dashql_l {
use lrlex::{LexerDef, LRNonStreamingLexerDef, Rule};

#[allow(dead_code)]
pub fn lexerdef() -> LRNonStreamingLexerDef<u32> {
    let rules = vec![
Rule::new(Some(0), None, "[\\t ]+".to_string()).unwrap(),
Rule::new(Some(1), None, "\\n".to_string()).unwrap(),
Rule::new(Some(37), Some(",".to_string()), ",".to_string()).unwrap(),
Rule::new(Some(3), Some(";".to_string()), ";".to_string()).unwrap(),
Rule::new(None, Some("\'".to_string()), "'".to_string()).unwrap(),
Rule::new(None, Some("\"".to_string()), "\"".to_string()).unwrap(),
Rule::new(None, Some(".".to_string()), "\\.".to_string()).unwrap(),
Rule::new(Some(35), Some("(".to_string()), "\\(".to_string()).unwrap(),
Rule::new(Some(36), Some(")".to_string()), "\\)".to_string()).unwrap(),
Rule::new(None, Some("[".to_string()), "\\[".to_string()).unwrap(),
Rule::new(None, Some("]".to_string()), "\\]".to_string()).unwrap(),
Rule::new(None, Some("*".to_string()), "\\*".to_string()).unwrap(),
Rule::new(None, Some("+".to_string()), "\\+".to_string()).unwrap(),
Rule::new(Some(38), Some("=".to_string()), "=".to_string()).unwrap(),
Rule::new(Some(39), Some("$".to_string()), "$".to_string()).unwrap(),
Rule::new(Some(6), Some("AS".to_string()), "(?i)as".to_string()).unwrap(),
Rule::new(Some(7), Some("CSV".to_string()), "(?i)csv".to_string()).unwrap(),
Rule::new(Some(8), Some("DATE".to_string()), "(?i)date".to_string()).unwrap(),
Rule::new(Some(9), Some("DATETIME".to_string()), "(?i)datetime".to_string()).unwrap(),
Rule::new(Some(0), Some("DECLARE".to_string()), "(?i)declare".to_string()).unwrap(),
Rule::new(Some(10), Some("DELIMITER".to_string()), "(?i)delimiter".to_string()).unwrap(),
Rule::new(Some(11), Some("ENCODING".to_string()), "(?i)encoding".to_string()).unwrap(),
Rule::new(Some(12), Some("EXTRACT".to_string()), "(?i)extract".to_string()).unwrap(),
Rule::new(Some(13), Some("FALSE".to_string()), "(?i)false".to_string()).unwrap(),
Rule::new(Some(14), Some("FILE".to_string()), "(?i)file".to_string()).unwrap(),
Rule::new(Some(15), Some("FLOAT".to_string()), "(?i)float".to_string()).unwrap(),
Rule::new(Some(16), Some("FORMAT".to_string()), "(?i)format".to_string()).unwrap(),
Rule::new(Some(17), Some("FROM".to_string()), "(?i)from".to_string()).unwrap(),
Rule::new(Some(18), Some("GET".to_string()), "(?i)get".to_string()).unwrap(),
Rule::new(Some(19), Some("HEADER".to_string()), "(?i)header".to_string()).unwrap(),
Rule::new(Some(20), Some("HTTP".to_string()), "(?i)http".to_string()).unwrap(),
Rule::new(Some(21), Some("INTEGER".to_string()), "(?i)integer".to_string()).unwrap(),
Rule::new(Some(22), Some("LOAD".to_string()), "(?i)load".to_string()).unwrap(),
Rule::new(Some(23), Some("METHOD".to_string()), "(?i)method".to_string()).unwrap(),
Rule::new(Some(1), Some("PARAMETER".to_string()), "(?i)parameter".to_string()).unwrap(),
Rule::new(Some(24), Some("POST".to_string()), "(?i)post".to_string()).unwrap(),
Rule::new(Some(25), Some("PUT".to_string()), "(?i)put".to_string()).unwrap(),
Rule::new(Some(26), Some("QUERY".to_string()), "(?i)query".to_string()).unwrap(),
Rule::new(Some(27), Some("QUOTE".to_string()), "(?i)quote".to_string()).unwrap(),
Rule::new(Some(28), Some("TEXT".to_string()), "(?i)text".to_string()).unwrap(),
Rule::new(Some(29), Some("TIME".to_string()), "(?i)time".to_string()).unwrap(),
Rule::new(Some(30), Some("TIMESTAMP".to_string()), "(?i)timestamp".to_string()).unwrap(),
Rule::new(Some(31), Some("TRUE".to_string()), "(?i)true".to_string()).unwrap(),
Rule::new(Some(2), Some("TYPE".to_string()), "(?i)type".to_string()).unwrap(),
Rule::new(Some(32), Some("URL".to_string()), "(?i)url".to_string()).unwrap(),
Rule::new(Some(33), Some("USING".to_string()), "(?i)using".to_string()).unwrap(),
Rule::new(Some(34), Some("VISUALIZE".to_string()), "(?i)visualize".to_string()).unwrap(),
Rule::new(Some(4), Some("SINGLY_QUOTED_STRING".to_string()), "'(\\\\.|[^\\\\'])*'".to_string()).unwrap(),
Rule::new(None, Some("DOUBLY_QUOTED_STRING".to_string()), "\"(\\\\.|[^\\\\\"])*\"".to_string()).unwrap(),
Rule::new(Some(5), Some("IDENTIFIER".to_string()), "(?i)[a-z][a-z0-9_]*".to_string()).unwrap(),
Rule::new(Some(40), Some("SQL_SELECT".to_string()), "(?i)select[^;]*".to_string()).unwrap(),
Rule::new(Some(41), Some("SQL_WITH".to_string()), "(?i)with[^;]*".to_string()).unwrap(),
];
    LRNonStreamingLexerDef::from_rules(rules)
}
#[allow(dead_code)]
pub const T_TEXT: u32 = 28;
#[allow(dead_code)]
pub const T_PARAMETER: u32 = 1;
#[allow(dead_code)]
pub const T_SQL_WITH: u32 = 41;
#[allow(dead_code)]
pub const T_FLOAT: u32 = 15;
#[allow(dead_code)]
pub const T_USING: u32 = 33;
#[allow(dead_code)]
pub const T_FROM: u32 = 17;
#[allow(dead_code)]
pub const T_SQL_SELECT: u32 = 40;
#[allow(dead_code)]
pub const T_QUERY: u32 = 26;
#[allow(dead_code)]
pub const T_VISUALIZE: u32 = 34;
#[allow(dead_code)]
pub const T_DELIMITER: u32 = 10;
#[allow(dead_code)]
pub const T_PUT: u32 = 25;
#[allow(dead_code)]
pub const T_POST: u32 = 24;
#[allow(dead_code)]
pub const T_QUOTE: u32 = 27;
#[allow(dead_code)]
pub const T_TIMESTAMP: u32 = 30;
#[allow(dead_code)]
pub const T_TRUE: u32 = 31;
#[allow(dead_code)]
pub const T_TIME: u32 = 29;
#[allow(dead_code)]
pub const T_DATETIME: u32 = 9;
#[allow(dead_code)]
pub const T_INTEGER: u32 = 21;
#[allow(dead_code)]
pub const T_FORMAT: u32 = 16;
#[allow(dead_code)]
pub const T_URL: u32 = 32;
#[allow(dead_code)]
pub const T_FALSE: u32 = 13;
#[allow(dead_code)]
pub const T_GET: u32 = 18;
#[allow(dead_code)]
pub const T_HEADER: u32 = 19;
#[allow(dead_code)]
pub const T_TYPE: u32 = 2;
#[allow(dead_code)]
pub const T_HTTP: u32 = 20;
#[allow(dead_code)]
pub const T_AS: u32 = 6;
#[allow(dead_code)]
pub const T_LOAD: u32 = 22;
#[allow(dead_code)]
pub const T_ENCODING: u32 = 11;
#[allow(dead_code)]
pub const T_DECLARE: u32 = 0;
#[allow(dead_code)]
pub const T_IDENTIFIER: u32 = 5;
#[allow(dead_code)]
pub const T_CSV: u32 = 7;
#[allow(dead_code)]
pub const T_SINGLY_QUOTED_STRING: u32 = 4;
#[allow(dead_code)]
pub const T_DATE: u32 = 8;
#[allow(dead_code)]
pub const T_EXTRACT: u32 = 12;
#[allow(dead_code)]
pub const T_FILE: u32 = 14;
#[allow(dead_code)]
pub const T_METHOD: u32 = 23;
}