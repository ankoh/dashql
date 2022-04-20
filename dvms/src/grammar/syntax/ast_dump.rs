use super::super::ProgramBuffer;
use super::print_ast;
use quick_xml::events::BytesEnd;
use quick_xml::events::BytesStart;
use quick_xml::events::BytesText;
use quick_xml::events::Event;
use quick_xml::Writer;
use serde::Deserialize;
use std::error::Error;
use std::io::Write;

#[derive(Debug, Deserialize)]
#[serde(rename = "astdumps")]
pub struct ASTDumpFile {
    #[serde(rename = "astdump", default)]
    pub dumps: Vec<ASTDump>,
}

impl ASTDumpFile {
    pub fn write_xml<W>(&self, writer: &mut Writer<W>) -> Result<(), Box<dyn Error + Send + Sync>>
    where
        W: Write,
    {
        writer.write_event(Event::Start(BytesStart::borrowed_name(b"astdumps")))?;
        for dump in self.dumps.iter() {
            dump.write_xml(writer)?;
        }
        writer.write_event(Event::End(BytesEnd::borrowed(b"astdumps")))?;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
pub struct ASTDump {
    pub name: String,
    pub input: String,
    #[serde(skip)]
    pub parsed: Option<ProgramBuffer>,
}

impl ASTDump {
    pub fn write_xml<W>(&self, writer: &mut Writer<W>) -> Result<(), Box<dyn Error + Send + Sync>>
    where
        W: Write,
    {
        let mut start = BytesStart::borrowed_name(b"astdump");
        start.push_attribute(("name", self.name.as_str()));
        writer.write_event(Event::Start(start))?;
        writer.write_event(Event::Start(BytesStart::borrowed_name(b"input")))?;
        writer.write_event(Event::Text(BytesText::from_plain_str(self.input.as_str())))?;
        writer.write_event(Event::End(BytesEnd::borrowed(b"input")))?;
        if let Some(ast) = &self.parsed {
            let (program, text) = ast.read();
            writer.write_event(Event::Start(BytesStart::borrowed_name(b"parsed")))?;
            print_ast(writer, program, text)?;
            writer.write_event(Event::End(BytesEnd::borrowed(b"parsed")))?;
        }
        writer.write_event(Event::End(BytesEnd::borrowed(b"astdump")))?;
        Ok(())
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test {
    use quick_xml::events::Event;

    use pretty_assertions::assert_eq;
    use std::error::Error;
    use std::fs;
    use std::io::BufReader;
    use std::path::PathBuf;

    fn test_ast_dump(name: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let dump_dir = base.join("dump").join("ast");
        let dump_path = dump_dir.join(name);

        let dump_name_os = dump_path.file_name().unwrap();
        let dump_name_str = dump_name_os.to_str().unwrap_or_default();

        let xml_suffix = ".xml";
        assert!(dump_name_str.ends_with(xml_suffix));

        let input_file = fs::File::open(&dump_path)?;
        let input_reader = BufReader::new(input_file);

        let mut xml_reader = quick_xml::Reader::from_reader(input_reader);
        xml_reader
            .expand_empty_elements(false)
            .check_end_names(true)
            .trim_text(true);

        let mut expected_writer = quick_xml::Writer::new_with_indent(Vec::new(), b' ', 4);

        let mut tmp_buffer = Vec::new();
        let mut input_text: Option<String> = None;
        let mut awaiting_input = false;
        let mut awaiting_parsed = false;
        loop {
            match xml_reader.read_event(&mut tmp_buffer)? {
                Event::Start(e) => {
                    let name = std::str::from_utf8(e.name())?;
                    if name == "input" {
                        awaiting_input = true;
                        input_text = None;
                    } else if name == "parsed" {
                        awaiting_parsed = true;
                    } else if awaiting_parsed {
                        expected_writer.write_event(Event::Start(e))?;
                    }
                }
                Event::End(e) => {
                    let name = std::str::from_utf8(e.name())?;
                    if name == "input" {
                        awaiting_input = false;
                    } else if name == "parsed" {
                        awaiting_parsed = false;

                        // Get the expected xml string
                        let expected_str = String::from_utf8(expected_writer.into_inner())?;
                        expected_writer = quick_xml::Writer::new_with_indent(Vec::new(), b' ', 4);
                        // Parse the input text
                        let have_input =
                            input_text.as_ref().map(String::as_str).unwrap_or_default();
                        let have = crate::grammar::parse(have_input)?;
                        let (have_ast, have_script) = have.read();
                        // Print parsed ast
                        let mut have_writer =
                            quick_xml::Writer::new_with_indent(Vec::new(), b' ', 4);
                        crate::grammar::print_ast(&mut have_writer, have_ast, have_script)?;
                        let have_str = String::from_utf8(have_writer.into_inner())?;
                        // Compare output
                        assert_eq!(have_str, expected_str);
                    } else if awaiting_parsed {
                        expected_writer.write_event(Event::End(e))?;
                    }
                }
                Event::Text(t) => {
                    if awaiting_input {
                        if input_text.is_none() {
                            let unescaped = t.unescape_and_decode(&xml_reader).unwrap_or_default();
                            input_text = Some(unescaped)
                        }
                    } else if awaiting_parsed {
                        expected_writer.write_event(Event::Text(t))?;
                    }
                }
                Event::Eof => break,
                e => {
                    if awaiting_parsed {
                        expected_writer.write_event(e)?;
                    }
                }
            }
        }
        Ok(())
    }

    type ASTTestResult = Result<(), Box<dyn Error + Send + Sync>>;

    #[test]
    fn test_dashql_fetch() -> ASTTestResult {
        test_ast_dump("dashql_fetch.xml")
    }
    #[test]
    fn test_dashql_input() -> ASTTestResult {
        test_ast_dump("dashql_input.xml")
    }
    #[test]
    fn test_dashql_set() -> ASTTestResult {
        test_ast_dump("dashql_set.xml")
    }
    #[test]
    fn test_dashql_statement() -> ASTTestResult {
        test_ast_dump("dashql_statement.xml")
    }
    #[test]
    fn test_dashql_viz() -> ASTTestResult {
        test_ast_dump("dashql_viz.xml")
    }
    #[test]
    fn test_scripts_demo() -> ASTTestResult {
        test_ast_dump("scripts_demo.xml")
    }
    #[test]
    fn test_sql_create() -> ASTTestResult {
        test_ast_dump("sql_create.xml")
    }
    #[test]
    fn test_sql_select() -> ASTTestResult {
        test_ast_dump("sql_select.xml")
    }
    #[test]
    fn test_sql_view() -> ASTTestResult {
        test_ast_dump("sql_view.xml")
    }
}
