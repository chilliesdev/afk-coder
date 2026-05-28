# Decouple CLI Commands and Inject GitClient for Testability

To align the CLI module with the Dependency Inversion Principle (DIP) and Single Responsibility Principle (SRP), we refactored command registration, command execution, and external tool dependencies.

## Architectural Decision

1. **Separation of Concerns in CLI Commands**: CLI commands under `src/cli/commands/` must separate argument registration (Commander configuration) from execution logic. Each command class must expose a dedicated `execute` method containing the core execution flow, allowing direct unit testing without invoking Commander.
2. **Dependency Inversion for Git Client**: CLI command classes must not directly instantiate concrete helper classes like `ShellGitClient`. Instead, they should request the `GitClient` abstraction through a factory (`gitClientFactory`) supplied in `CommandContext`.
3. **Graceful Fallback**: For backward compatibility and convenience in non-DIP contexts, commands can fall back to instantiating `ShellGitClient` if the factory is not provided in `CommandContext`.
