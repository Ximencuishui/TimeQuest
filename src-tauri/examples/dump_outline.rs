use std::env;

fn main() {
    let path = match env::args().nth(1) {
        Some(path) => path,
        None => {
            eprintln!("usage: dump_outline <pdf>");
            return;
        }
    };
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
            eprintln!("read failed: {error}");
            return;
        }
    };
    match timequest_lib::extract_outline(&bytes) {
        Ok(chapters) => {
            println!("---- raw lines ----");
            for line in timequest_lib::extract_outline_lines(&bytes).unwrap_or_default() {
                println!("| {line}");
            }
            println!("---- parsed ----");
            for chapter in chapters {
                println!("{}", chapter.title);
                for section in chapter.sections {
                    println!("    {} {}", section.number, section.title);
                }
            }
        }
        Err(error) => println!("ERR: {error}"),
    }
}
