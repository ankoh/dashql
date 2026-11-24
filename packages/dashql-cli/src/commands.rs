//! The commands of `dashql`, one table that makes the usage and that the parser of the arguments follows

/// A command of `dashql`
pub struct Command {
    /// The name on the command line
    pub name: &'static str,
    /// The arguments, as the usage shows them
    pub args: &'static str,
    /// What it does, one line
    pub does: &'static str,
}

/// The commands, in the order of the usage
pub const COMMANDS: [Command; 11] = [
    Command { name: "guide", args: "", does: "How to work on DashQL with these commands, read it first" },
    Command {
        name: "scripts",
        args: "",
        does: "The scripts in the order of the feed, the connections and the attachments",
    },
    Command { name: "read", args: "<script>", does: "The text of a script" },
    Command {
        name: "edit",
        args: "<script> [--file <file>] [--connection <id>]",
        does: "Replace or create a script with the text of the file or of stdin",
    },
    Command {
        name: "move",
        args: "<script> (--before <script> | --after <script> | --first | --last)",
        does: "Move a script in the feed",
    },
    Command {
        name: "catalog",
        args: "[<connection>]",
        does: "The tables that you can query, as CREATE TABLE statements",
    },
    Command { name: "lint", args: "<script>", does: "Check a script without running it" },
    Command { name: "format", args: "<script>", does: "Pretty print a script in place" },
    Command {
        name: "run",
        args: "[<script>...] [--refresh] [--rows <n>]",
        does: "Run scripts in DashQL, print their first rows and the files of their results",
    },
    Command {
        name: "vis",
        args: "<script> [--width <n>] [--height <n>] [--refresh]",
        does: "Check the chart of a script against its result and render it as PNG",
    },
    Command { name: "help", args: "", does: "This usage" },
];

/// The width of the first column of the usage
const COLUMN: usize = 36;

/// The usage of `dashql`
pub fn usage() -> String {
    let mut out = String::from(
        "Usage: dashql --session <file> <command> [args]\n\
         \n\
         The commands of an agent that DashQL runs for a question. They read and change the workbook that DashQL shows\n\
         and run its scripts there. DashQL passes --session to the dashql of the agent, guide and help need none.\n\
         \n\
         Commands:\n",
    );
    for command in &COMMANDS {
        let call = if command.args.is_empty() {
            command.name.to_string()
        } else {
            format!("{} {}", command.name, command.args)
        };
        if call.len() + 2 < COLUMN {
            out.push_str(&format!("  {call:<width$}{}\n", command.does, width = COLUMN - 2));
        } else {
            out.push_str(&format!("  {call}\n{:COLUMN$}{}\n", "", command.does));
        }
    }
    out.push_str(
        "\nA script is named like orders or orders.sql. Exits with 0 when the command succeeded, 1 when it failed and 2 on\n\
         usage errors or when DashQL runs no question on the workbook.\n",
    );
    out
}

/// The command of a name
pub fn command(name: &str) -> Option<&'static Command> {
    COMMANDS.iter().find(|command| command.name == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_every_command_in_the_usage() {
        let usage = usage();
        for command in &COMMANDS {
            assert!(usage.contains(&format!("\n  {}", command.name)), "{}", command.name);
            assert!(usage.contains(command.does), "{}", command.name);
        }
        assert!(usage.contains("\n  read <script>                     The text of a script\n"), "{usage}");
        assert!(usage.contains(
            "\n  edit <script> [--file <file>] [--connection <id>]\n                                    Replace"
        ));
    }

    #[test]
    fn finds_commands_by_name() {
        assert_eq!(command("run").map(|c| c.name), Some("run"));
        assert!(command("result").is_none());
        assert!(command("connect").is_none());
    }
}
