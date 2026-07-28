import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delegateHandler } from "../src/tools/delegate.js";
import { getResultHandler } from "../src/tools/getResult.js";

test(
  "real opencode: delegate a trivial prompt and get a result back",
  {
    skip:
      process.env.RUN_REAL_OPENCODE_TESTS !== "1"
        ? "set RUN_REAL_OPENCODE_TESTS=1 to run this (spends real tokens)"
        : false,
  },
  async () => {
    const home = mkdtempSync(join(tmpdir(), "claude-delegate-home-"));
    const workDir = mkdtempSync(join(tmpdir(), "claude-delegate-work-"));
    process.env.CLAUDE_DELEGATE_HOME = home;
    delete process.env.OPENCODE_BIN;

    try {
      const delegated = JSON.parse(
        (
          await delegateHandler({
            prompt:
              "Reply with exactly the text: PONG. Do not read, write, or list any files. Do not call any tools.",
            working_directory: workDir,
          })
        ).content[0].text
      );
      assert.equal(delegated.status, "running");

      let result;
      const start = Date.now();
      do {
        if (Date.now() - start > 60000) throw new Error("real opencode run did not finish in time");
        await new Promise((r) => setTimeout(r, 500));
        result = JSON.parse((await getResultHandler({ job_id: delegated.job_id })).content[0].text);
      } while (result.status === "running");

      assert.equal(result.status, "completed");
      assert.match(result.output, /PONG/);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(workDir, { recursive: true, force: true });
    }
  }
);
