import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");

const pairs = [
  ["agent-hub-proto-update/icons.js", "apps/web/src/shared/icons.js"],

];

describe("retained icon library", () => {
  it.each(pairs)("keeps %s unchanged in %s", (reference, implementation) => {
    expect(readFileSync(resolve(root, implementation), "utf8"))
      .toBe(readFileSync(resolve(root, reference), "utf8"));
  });
});
