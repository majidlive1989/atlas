import { test, expect } from "@playwright/test";
import { hashPassword } from "@atlas/auth";
import { migrate, openDatabase, seed } from "@atlas/db";
import { startApi } from "../src/index.js";
import { startPostgres } from "../test/postgres.js";

test("logs in over HTTP, authorizes site settings and detects refresh replay", async ({
  request,
}) => {
  test.setTimeout(180_000);
  const postgres = await startPostgres("playwright-only");
  const database = openDatabase(postgres.getConnectionUri());
  let server: Awaited<ReturnType<typeof startApi>> | undefined;
  try {
    const password = "Playwright test password";
    await migrate(database);
    await seed(database, {
      hostname: "127.0.0.1",
      tenant: "atlas",
      site: "test",
      email: "playwright@atlas.test",
      passwordHash: await hashPassword(password),
    });

    server = await startApi({
      NODE_ENV: "test",
      DATABASE_URL: postgres.getConnectionUri(),
      ATLAS_AUTH_SECRET: Buffer.alloc(32, 31).toString("base64url"),
      ATLAS_PORT: "0",
      ATLAS_LOG_LEVEL: "silent",
    });
    const endpoint = new URL("/v1/auth/login", server.address).href;
    const login = await request.post(endpoint, {
      data: { email: "playwright@atlas.test", password },
    });
    expect(login.status()).toBe(200);
    let { accessToken, refreshToken } = (await login.json()) as {
      accessToken: string;
      refreshToken: string;
    };
    const options = new URL("/v1/options", server.address).href;
    const refresh = new URL("/v1/auth/refresh", server.address).href;
    expect(
      (
        await request.get(options, { headers: { authorization: "Bearer " + accessToken } })
      ).status(),
    ).toBe(200);
    const previous = refreshToken;
    const rotated = await request.post(refresh, { data: { refreshToken: previous } });
    expect(rotated.status()).toBe(200);
    ({ accessToken, refreshToken } = (await rotated.json()) as {
      accessToken: string;
      refreshToken: string;
    });
    expect(refreshToken).not.toBe(previous);
    expect((await request.post(refresh, { data: { refreshToken: previous } })).status()).toBe(401);
    expect(
      (
        await request.get(options, { headers: { authorization: "Bearer " + accessToken } })
      ).status(),
    ).toBe(401);
  } finally {
    try {
      await server?.app.close();
    } finally {
      try {
        await database.close();
      } finally {
        await postgres.stop();
      }
    }
  }
});
