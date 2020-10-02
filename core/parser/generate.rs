use cfgrammar::yacc::YaccKind;
use lrlex::LexerBuilder;
use lrpar::{CTParserBuilder, RecoveryKind};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let input_y = "./dashql.y";
    let output_y = "./dashql.y.rs";

    let input_l = "./dashql.l";
    let output_l = "./dashql.l.rs";

    let lex_rule_ids_map = CTParserBuilder::new()
        .yacckind(YaccKind::Grmtools)
        .recoverer(RecoveryKind::None)
        .process_file(input_y, output_y)
        .map_err(|error| format!("Failed processing {}: {}", input_y, error))?;

    LexerBuilder::new()
        .rule_ids_map(lex_rule_ids_map)
        .process_file(input_l, output_l)
        .map_err(|error| format!("Failed processing {}: {}", input_l, error))?;

    Ok(())
}
