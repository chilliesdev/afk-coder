export const cleanup = () => {
  if (process.stdout.isTTY) {
    process.stdout.write('\u001B[?25h'); // Show cursor
  }
};

export const registerCleanupHandlers = () => {
  process.on('exit', cleanup);
  process.on('SIGINT', () => process.exit(130));
  process.on('SIGTERM', () => process.exit(143));
  process.on('SIGHUP', () => process.exit(129));

  process.on('uncaughtException', (err) => {
    cleanup();
    console.error('\n❌ An unexpected error occurred:');
    console.error(err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    cleanup();
    console.error('\n❌ An unhandled promise rejection occurred:');
    console.error(reason);
    process.exit(1);
  });
};
