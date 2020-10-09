use cfgrammar::yacc::YaccKind;
use lrlex::LexerBuilder;
use lrpar::{CTParserBuilder, RecoveryKind};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().collect::<Vec<_>>();

    if args.len() != 2 + 4 {
        Err("Invalid number of arguments")?;
    }

    let input_y = &args[2];
    let output_y = &args[3];

    let input_l = &args[4];
    let output_l = &args[5];

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
