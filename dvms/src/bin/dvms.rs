use dashql::*;

fn main() {
    let alloc = bumpalo::Bump::new();
    grammar::parse(&alloc, "select 1;").ok();
    println!("Hello, world!");
}
