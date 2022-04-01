mod grammar;
mod proto;

fn main() {
    grammar::parse("select 1;");
    println!("Hello, world!");
}
