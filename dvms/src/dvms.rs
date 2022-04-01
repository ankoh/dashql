mod parser;

#[cfg(test)]
mod test;

fn main() {
    parser::parse("select 1;");
    println!("Hello, world!");
}
