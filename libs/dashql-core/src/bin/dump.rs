#![allow(dead_code)]

use clap::{App, Arg, SubCommand};
use dashql_core::external::parser::parse_into;
use dashql_core::grammar::ast_dump::ASTDump;
use dashql_core::grammar::ast_dump::ASTDumpTemplateFile;
use dashql_core::utils::shared_writer::SharedWriter;
use dashql_core::*;
use log::info;
use log::warn;
use quick_xml::Writer;
use std::error::Error;
use std::fs;
use std::io::BufReader;
use std::io::BufWriter;
use std::io::Write;
use std::path::PathBuf;

use grammar::ast_dump::ASTDumpFile;

fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    let arena = bumpalo::Bump::new();
    env_logger::builder().filter_level(log::LevelFilter::Info).init();

    let matches = App::new("Dump")
        .version("0.1")
        .subcommand(
            SubCommand::with_name("grammar").arg(
                Arg::with_name("directory")
                    .long("dir")
                    .short("d")
                    .required(true)
                    .takes_value(true),
            ),
        )
        .get_matches();

    if let Some(matches) = matches.subcommand_matches("grammar") {
        let dir_str = matches.value_of("directory").unwrap();
        let dir_path = PathBuf::from(dir_str).canonicalize()?;
        info!("directory={}", &dir_str);

        let paths = fs::read_dir(&dir_path).unwrap();
        for file_path in paths {
            let file_path = file_path?;
            let file_name_os = file_path.file_name();
            let file_name_str = file_name_os.to_str().unwrap_or_default();
            let tpl_suffix = ".tpl.xml";
            if !file_name_str.ends_with(tpl_suffix) {
                continue;
            }
            info!("dump_file={}", &file_name_str);
            let prefix = file_name_str.strip_suffix(tpl_suffix).unwrap_or_default();

            let input_file = fs::File::open(&file_path.path())?;
            let input_reader = BufReader::new(input_file);
            let dump_file: ASTDumpTemplateFile = quick_xml::de::from_reader(input_reader)?;

            let mut dumps = Vec::new();
            let alloc = bumpalo::Bump::new();
            for dump in dump_file.dumps.iter() {
                let ast = parse_into(&alloc, &dump.input)?;
                let translated = match grammar::deserialize_ast(&arena, &dump.input, ast) {
                    Ok(p) => Some(p),
                    Err(e) => {
                        warn!("{}", e);
                        None
                    }
                };
                dumps.push(ASTDump {
                    name: dump.name.clone(),
                    input: &dump.input,
                    parsed: Some(ast),
                    translated,
                });
            }
            let output_dump = ASTDumpFile { dumps };

            let output_file = fs::File::create(&dir_path.join(format!("{}.xml", prefix)))?;
            let output_writer = SharedWriter::from_writer(BufWriter::new(output_file));
            let mut output_writer_cp = output_writer.clone();
            let mut xml_writer = Writer::new_with_indent(output_writer, b' ', 4);
            output_dump.write_xml(&mut xml_writer)?;
            output_writer_cp.flush()?;
        }
    }
    Ok(())
}
