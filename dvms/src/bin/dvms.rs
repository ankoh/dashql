use dashql::*;

fn main() {
    grammar::parse("select 1;").ok();
    println!("Hello, world!");
}
