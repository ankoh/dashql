use super::print_ast;
use super::program::Program;
use quick_xml::events::BytesEnd;
use quick_xml::events::BytesStart;
use quick_xml::events::BytesText;
use quick_xml::events::Event;
use quick_xml::Writer;
use serde::Deserialize;
use serde::Serialize;
use std::error::Error;
use std::io::Write;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename = "astdumps")]
pub struct ASTDumpTemplateFile {
    #[serde(rename = "astdump", default)]
    pub dumps: Vec<ASTDumpTemplate>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ASTDumpTemplate {
    pub name: String,
    pub input: String,
}

#[derive(Debug)]
pub struct ASTDumpFile<'text> {
    pub dumps: Vec<ASTDump<'text>>,
}

impl<'text> ASTDumpFile<'text> {
    pub fn write_xml<W>(&self, writer: &mut Writer<W>) -> Result<(), Box<dyn Error + Send + Sync>>
    where
        W: Write + Clone,
    {
        writer.write_event(Event::Start(BytesStart::borrowed_name(b"astdumps")))?;
        for dump in self.dumps.iter() {
            dump.write_xml(writer)?;
        }
        writer.write_event(Event::End(BytesEnd::borrowed(b"astdumps")))?;
        Ok(())
    }
}

#[derive(Debug)]
pub struct ASTDump<'text> {
    pub name: String,
    pub input: &'text str,
    pub parsed: Option<dashql_parser::ASTBuffer>,
    pub translated: Option<Program<'text>>,
}

impl<'text> ASTDump<'text> {
    pub fn write_xml<W>(&self, writer: &mut Writer<W>) -> Result<(), Box<dyn Error + Send + Sync>>
    where
        W: Write + Clone,
    {
        let mut start = BytesStart::borrowed_name(b"astdump");
        start.push_attribute(("name", self.name.as_str()));
        writer.write_event(Event::Start(start))?;
        writer.write_event(Event::Start(BytesStart::borrowed_name(b"input")))?;
        writer.write_event(Event::Text(BytesText::from_plain_str(self.input)))?;
        writer.write_event(Event::End(BytesEnd::borrowed(b"input")))?;
        if let Some(ast) = &self.parsed {
            writer.write_event(Event::Start(BytesStart::borrowed_name(b"parsed")))?;
            print_ast(writer, ast.get_root(), self.input)?;
            writer.write_event(Event::End(BytesEnd::borrowed(b"parsed")))?;
        }
        if let Some(prog) = &self.translated {
            writer.write_event(Event::Start(BytesStart::borrowed_name(b"translated")))?;
            writer.write_event(Event::Text(BytesText::from_plain_str(&format!("{:#?}", &prog))))?;
            writer.write_event(Event::End(BytesEnd::borrowed(b"translated")))?;
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

    use crate::grammar::translate_ast;

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

        let mut script_text: Option<String> = None;
        let mut ast_buffer = None;

        let mut tmp_buffer = Vec::new();
        let mut awaiting_input = false;
        let mut awaiting_parsed = false;
        let mut awaiting_translated = false;
        loop {
            match xml_reader.read_event(&mut tmp_buffer)? {
                Event::Start(e) => {
                    let name = std::str::from_utf8(e.name())?;
                    if name == "input" {
                        awaiting_input = true;
                        script_text = None;
                    } else if name == "parsed" {
                        awaiting_parsed = true;
                    } else if name == "translated" {
                        awaiting_translated = true;
                    } else if awaiting_parsed {
                        expected_writer.write_event(Event::Start(e))?;
                    }
                }
                Event::End(e) => {
                    let name = std::str::from_utf8(e.name())?;
                    if name == "input" {
                        awaiting_input = false;
                    } else if name == "translated" {
                        awaiting_translated = false;
                    } else if name == "parsed" {
                        awaiting_parsed = false;

                        // Get the expected xml string
                        let expected_str = String::from_utf8(expected_writer.into_inner())?;
                        expected_writer = quick_xml::Writer::new_with_indent(Vec::new(), b' ', 4);
                        // Parse the input text
                        let have_input = script_text.as_ref().map(String::as_str).unwrap_or_default();
                        let have = crate::grammar::parse(have_input)?;
                        let have_ast = have.get_root();
                        // Print parsed ast
                        let mut have_writer = quick_xml::Writer::new_with_indent(Vec::new(), b' ', 4);
                        crate::grammar::print_ast(&mut have_writer, have_ast, have_input)?;
                        let have_str = String::from_utf8(have_writer.into_inner())?;
                        // Compare output
                        assert_eq!(have_str, expected_str);
                        // Remember AST buffer
                        ast_buffer = Some(have);
                    } else if awaiting_parsed {
                        expected_writer.write_event(Event::End(e))?;
                    }
                }
                Event::Text(expected) => {
                    if awaiting_input {
                        if script_text.is_none() {
                            let unescaped = expected.unescape_and_decode(&xml_reader).unwrap_or_default();
                            script_text = Some(unescaped)
                        }
                    } else if awaiting_parsed {
                        expected_writer.write_event(Event::Text(expected))?;
                    } else if awaiting_translated {
                        awaiting_translated = false;

                        // Translate the ast
                        let unescaped = expected.unescape_and_decode(&xml_reader).unwrap_or_default();
                        let ast = ast_buffer.as_ref().expect("expected ast buffer").get_root();
                        let translated =
                            translate_ast(script_text.as_ref().expect("expected script text").as_str(), ast)?;
                        assert_eq!(&format!("{:#?}", translated), &unescaped);
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
