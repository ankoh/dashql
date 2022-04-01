mod grammar;

fn main() {
    grammar::parse("select 1;");
    println!("Hello, world!");
}
