pub fn trim_quotes<'a>(input: &'a str) -> &'a str {
    input.trim_matches(|c| c == '\'' || c == '\"')
}
