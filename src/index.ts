import { createCli } from "./cli/commands.js";

async function main() {
  const cli = createCli();
  await cli.parseAsync(process.argv);
}

main().catch((error) => {
  console.error("telegram-mcp fatal error:", error);
  process.exit(1);
});
