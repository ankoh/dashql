use dashql_proto::syntax as sx;

pub fn text_at<'text>(text: &'text str, loc: sx::Location) -> &'text str {
    &text[loc.offset() as usize..(loc.offset() + loc.length()) as usize]
}
