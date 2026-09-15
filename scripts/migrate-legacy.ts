import { convertLegacyWorkspace } from "../apps/server/src/migration/convert";
const args = process.argv.slice(2);
const source = args[args.indexOf("--source") + 1];
const destination = args[args.indexOf("--destination") + 1];
if (
  !args.includes("--source") ||
  !args.includes("--destination") ||
  !source ||
  !destination
) {
  process.stderr.write(
    "用法：pnpm migrate:legacy --source /旧目录 --destination /尚不存在的新目录\n",
  );
  process.exitCode = 2;
} else {
  try {
    const result = await convertLegacyWorkspace(source, destination);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (result.report.status !== "verified") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : String(error)) + "\n",
    );
    process.exitCode = 1;
  }
}
