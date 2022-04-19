use crate::proto::syntax as sx;
use clap::{App, Arg};
use log::info;
use quick_xml::events::BytesEnd;
use quick_xml::events::BytesStart;
use quick_xml::events::BytesText;
use quick_xml::events::Event;
use quick_xml::Writer;
use serde::Deserialize;
use std::error::Error;
use std::fs;
use std::io::BufReader;
use std::io::BufWriter;
use std::io::Write;
use std::path::PathBuf;

mod error;
mod grammar;
mod proto;

#[derive(Debug, Deserialize)]
#[serde(rename = "dumps")]
struct GrammarDumpFile {
    #[serde(rename = "dump", default)]
    dumps: Vec<GrammarDump>,
}

impl GrammarDumpFile {
    pub fn write_xml<W>(&self, writer: &mut Writer<W>) -> Result<(), Box<dyn Error + Send + Sync>>
    where
        W: Write,
    {
        writer.write_event(Event::Start(BytesStart::borrowed_name(b"dumps")))?;
        for dump in self.dumps.iter() {
            dump.write_xml(writer)?;
        }
        writer.write_event(Event::End(BytesEnd::borrowed(b"dumps")))?;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
struct GrammarDump {
    name: String,
    input: String,
    #[serde(skip)]
    parsed: Option<grammar::ProgramBuffer>,
}

impl GrammarDump {
    pub fn write_xml<W>(&self, writer: &mut Writer<W>) -> Result<(), Box<dyn Error + Send + Sync>>
    where
        W: Write,
    {
        let mut start = BytesStart::borrowed_name(b"dump");
        start.push_attribute(("name", self.name.as_str()));
        writer.write_event(Event::Start(start))?;
        writer.write_event(Event::Start(BytesStart::borrowed_name(b"input")))?;
        writer.write_event(Event::Text(BytesText::from_plain_str(self.input.as_str())))?;
        writer.write_event(Event::End(BytesEnd::borrowed(b"input")))?;
        if let Some(ast) = &self.parsed {
            let (program, text) = ast.read();
            writer.write_event(Event::Start(BytesStart::borrowed_name(b"parsed")))?;
            grammar::print_ast(writer, program, text)?;
            writer.write_event(Event::End(BytesEnd::borrowed(b"parsed")))?;
        }
        writer.write_event(Event::End(BytesEnd::borrowed(b"dump")))?;
        Ok(())
    }
}

fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    env_logger::init();

    let matches = App::new("Dump")
        .version("0.1")
        .arg(
            Arg::with_name("directory")
                .long("dir")
                .short("d")
                .required(true)
                .takes_value(true),
        )
        .get_matches();

    let dir_str = matches.value_of("directory").unwrap();
    let dir_path = PathBuf::from(dir_str).canonicalize()?;
    info!("dir={:?}", &dir_path);

    let paths = fs::read_dir(&dir_path).unwrap();
    for file_path in paths {
        let file_path = file_path?;
        let file_name_os = file_path.file_name();
        let file_name_str = file_name_os.to_str().unwrap_or_default();
        let tpl_suffix = ".tpl.xml";
        if !file_name_str.ends_with(tpl_suffix) {
            continue;
        }
        let prefix = file_name_str.strip_suffix(tpl_suffix).unwrap_or_default();

        let input_file = fs::File::open(&file_path.path())?;
        let input_reader = BufReader::new(input_file);
        let mut dump_file: GrammarDumpFile = quick_xml::de::from_reader(input_reader)?;

        for dump in dump_file.dumps.iter_mut() {
            let ast_buffer = grammar::parse(&dump.input)?;
            dump.parsed = Some(ast_buffer);
        }

        let output_file = fs::File::create(&dir_path.join(format!("{}.xml", prefix)))?;
        let mut output_writer = BufWriter::new(output_file);
        let mut xml_writer = Writer::new_with_indent(&mut output_writer, b' ', 4);
        dump_file.write_xml(&mut xml_writer)?;
        output_writer.flush()?;
    }

    let test = GrammarDumpFile {
        dumps: vec![
            GrammarDump {
                name: "select_1".to_string(),
                input: "select 1;".to_string(),
                parsed: None,
            },
            GrammarDump {
                name: "select_1".to_string(),
                input: "select 1;".to_string(),
                parsed: None,
            },
        ],
    };

    let mut buffer = Vec::new();
    let mut writer = Writer::new_with_indent(&mut buffer, b' ', 4);
    test.write_xml(&mut writer)?;
    let xml_str = std::str::from_utf8(&buffer)?;
    println!("{}", xml_str);
    Ok(())
}
