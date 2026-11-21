import { createPluginHarness } from "@atlas/plugin-testkit";
import { expect, test } from "vitest";
import { plugin } from "../src/index.js";

test("ranks genuine overlap, preserves ties and honors the site limit", async () => {
  const app = createPluginHarness({ settings: { limit: 2 } });
  await app.start(plugin);
  const post = { id: "base", terms: ["a", "b"] };
  const first = { id: "first", terms: ["a"] };
  const best = { id: "best", terms: ["a", "b"] };
  const tied = { id: "tied", terms: ["a", "a"] };
  const input = {
    post,
    candidates: [post, first, tied, best, best, { id: "other", terms: ["c"] }],
  };
  expect((await app.request("POST", "/rank", input)).status).toBe(401);
  expect((await app.request("POST", "/rank", input, true)).status).toBe(403);
  expect(await app.request("POST", "/rank", input, true, ["plugin.related-posts.rank"])).toEqual({
    status: 200,
    body: [best, first],
  });
});
