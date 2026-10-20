/**
 * Widens the grant of one workspace on a STOPPED state dir (add-multiuser 12.4), the way
 * add-case-open will after it verified a signed handoff: it builds a WorkspaceRegistry on the dir,
 * calls `grantObjects`, flushes, stops, and prints the new grant. For the UI checks only, so a
 * server workspace can show data before add-case-open exists. Not part of the server build
 * (tsconfig has noEmit; nothing imports this file) and never run against a running server: the
 * server would overwrite the file on its next write.
 *
 * Run: node scripts/grant.ts <stateDir> <workspaceId> <dataRef...>
 *      (from apps/server; or: pnpm --filter @kipscope/server exec node scripts/grant.ts ...)
 * Prints one JSON line: {"workspace": "<id>", "granted": <number of objects or "all">, "objects": [...]}
 */
import { EMPTY_WORKSPACE } from "@kipscope/shared";
import { grantedOf } from "../src/rights.ts";
import { WorkspaceRegistry } from "../src/workspaces.ts";

const [stateDir, workspaceId, ...dataRefs] = process.argv.slice(2);
if (!stateDir || !workspaceId || dataRefs.length === 0) {
  process.stderr.write("usage: node scripts/grant.ts <stateDir> <workspaceId> <dataRef...>\n");
  process.exit(2);
}

const registry = new WorkspaceRegistry({
  dir: stateDir,
  seed: () => EMPTY_WORKSPACE,
  // A server identity: a stored grant is read as stored, and a stored `all` reads as empty.
  identity: "module",
  // The idle cleanup of start() must not delete anything of a state dir that was only stopped.
  idleDays: 36_500,
  log: { info: () => {}, warn: (message) => process.stderr.write(`${message}\n`) },
});

let code = 0;
try {
  registry.start();
  const entry = registry.grantObjects(workspaceId, dataRefs);
  if (!entry) {
    process.stderr.write(`grant: no workspace ${workspaceId} in ${stateDir}\n`);
    code = 1;
  } else {
    registry.flush();
    const grant = registry.grantOf(workspaceId);
    process.stdout.write(
      `${JSON.stringify({ workspace: workspaceId, granted: grantedOf(grant), objects: grant.objects })}\n`,
    );
  }
} catch (error) {
  process.stderr.write(`grant: ${error instanceof Error ? error.message : String(error)}\n`);
  code = 1;
} finally {
  registry.stop();
}
process.exit(code);
