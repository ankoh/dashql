mod grammar;

#[cfg(test)]
mod test;

fn main() {
    grammar::parse("select 1;");
    println!("Hello, world!");
}
