import { createPluginHarness } from "@atlas/plugin-testkit";
import { expect, test } from "vitest";
import { plugin, spam } from "../src/index.js";

const input = { email: "visitor@example.test", message: "Hello" };

test("validates, persists and notifies", async () => {
  const app = createPluginHarness({ settings: { recipient: "ops@example.test", locale: "ar" } });
  await app.start(plugin);
  expect(await app.request("POST", "/submit", { ...input, email: "invalid" })).toMatchObject({
    status: 400,
  });
  expect(await app.request("POST", "/submit", input)).toMatchObject({
    status: 200,
    body: { accepted: true },
  });
  expect(app.mail).toEqual([
    {
      to: "ops@example.test",
      subject: "رسالة جديدة من نموذج التواصل",
      text: "visitor@example.test\n\nHello",
    },
  ]);
  expect(app.tables.get("submissions")?.size).toBe(1);
  await app.stop();
  expect((await app.request("POST", "/submit", input)).status).toBe(404);
});

test("a spam verdict prevents both side effects", async () => {
  const app = createPluginHarness();
  app.context.hooks.filters.register(spam, () => true);
  await app.start(plugin);
  expect(await app.request("POST", "/submit", input)).toEqual({
    status: 200,
    body: { accepted: false },
  });
  expect(app.mail).toEqual([]);
  expect(app.tables.size).toBe(0);
});
