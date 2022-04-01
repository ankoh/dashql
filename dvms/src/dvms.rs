mod error;
mod grammar;
mod proto;

fn main() {
    grammar::parse("select 1;").ok();
    println!("Hello, world!");
}
