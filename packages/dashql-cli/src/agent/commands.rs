//! The commands of `dashql agent` that agents call. The table makes the usage of the command line tool, the
//! instructions of harness runs and the command table of the skill.

/// A command of `dashql agent` for the open DashQL session
pub struct AgentCommand {
    /// The words of the command, e.g. `vis edit`
    pub name: &'static str,
    /// The arguments and the options of the command
    pub args: &'static str,
    /// What the command does, Markdown
    pub does: &'static str,
}

impl AgentCommand {
    /// The command of a call to the session, e.g. `vis.edit`. None for `status`, the server answers it itself.
    pub fn call(&self) -> Option<String> {
        (self.name != "status").then(|| self.name.replace(' ', "."))
    }

    fn synopsis(&self) -> String {
        if self.args.is_empty() { self.name.to_string() } else { format!("{} {}", self.name, self.args) }
    }
}

pub const AGENT_COMMANDS: [AgentCommand; 11] = [
    AgentCommand { name: "status", args: "", does: "Connected clients, sessions, the focused session" },
    AgentCommand { name: "scripts", args: "", does: "Scripts of the session with their connections" },
    AgentCommand { name: "read", args: "<script>", does: "Script text" },
    AgentCommand {
        name: "edit",
        args: "<script> [--file f] [--connection c]",
        does: "Replace or create a script with the text of the file or stdin",
    },
    AgentCommand {
        name: "catalog",
        args: "[connection]",
        does: "`CREATE TABLE` statements of the tables you can query",
    },
    AgentCommand { name: "lint", args: "<script>", does: "Parser and analyzer diagnostics of a script" },
    AgentCommand {
        name: "run",
        args: "<script> [--max-rows N]",
        does: "Run a script: columns, first rows, row count or error",
    },
    AgentCommand { name: "result", args: "<script> [--page N]", does: "More rows of the last result of a script" },
    AgentCommand {
        name: "vis get",
        args: "<script>",
        does: "The chart of a script: its renderer and Vega-Lite spec",
    },
    AgentCommand {
        name: "vis edit",
        args: "<script> [--file f]",
        does: "Chart the last query of a script with the Vega-Lite spec of the file or stdin",
    },
    AgentCommand {
        name: "vis image",
        args: "<script> [--out f] [--width N] [--height N] [--scale N]",
        does: "Render the chart of a script with its last result as PNG, default `<script>.png`",
    },
];

/// Is this a command that a client runs in its session?
pub fn is_session_command(call: &str) -> bool {
    AGENT_COMMANDS.iter().any(|command| command.call().as_deref() == Some(call))
}

/// The subcommands of `vis`
pub fn vis_commands() -> impl Iterator<Item = &'static str> {
    AGENT_COMMANDS.iter().filter_map(|command| command.name.strip_prefix("vis "))
}

/// The commands as a Markdown table, for the instructions and the skill
pub fn command_table() -> String {
    let mut lines = vec!["| Command | Does |".to_string(), "|---|---|".to_string()];
    lines.extend(AGENT_COMMANDS.iter().map(|command| format!("| `dashql agent {}` | {} |", command.synopsis(), command.does)));
    lines.join("\n")
}

/// The width of the first column of the usage
const USAGE_COLUMN: usize = 38;

/// The commands in the usage of the command line tool
pub fn usage_lines() -> String {
    let mut lines = Vec::new();
    for command in &AGENT_COMMANDS {
        let synopsis = format!("  {}", command.synopsis());
        let does = command.does.replace('`', "");
        if synopsis.len() < USAGE_COLUMN {
            lines.push(format!("{synopsis:<USAGE_COLUMN$}{does}"));
        } else {
            lines.push(synopsis);
            lines.push(format!("{:USAGE_COLUMN$}{does}", ""));
        }
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_calls_of_the_commands() {
        assert!(is_session_command("vis.edit"));
        assert!(is_session_command("catalog"));
        assert!(!is_session_command("status"));
        assert!(!is_session_command("vis edit"));
        assert_eq!(vis_commands().collect::<Vec<_>>(), ["get", "edit", "image"]);
    }

    #[test]
    fn lists_the_commands_for_the_usage() {
        let usage = usage_lines();
        assert!(usage.contains("\n  read <script>                       Script text\n"));
        assert!(usage.contains(
            "\n  vis image <script> [--out f] [--width N] [--height N] [--scale N]\n                                      Render"
        ));
        assert!(usage.contains("CREATE TABLE statements"));
    }
}
