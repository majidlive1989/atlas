import SwaggerParser from "@apidevtools/swagger-parser";
import { readConfig } from "@atlas/config";
import { createKernel } from "@atlas/kernel";
import { expect, it } from "vitest";
import { createApi } from "../src/index.js";

it("generates valid OpenAPI 3.1 with resolvable JSON setting schemas", async () => {
  const kernel = createKernel(
    readConfig({
      DATABASE_URL: "postgresql://atlas@localhost/atlas",
      ATLAS_AUTH_SECRET: Buffer.alloc(32, 13).toString("base64url"),
      ATLAS_LOG_LEVEL: "silent",
    }),
  );
  const app = await createApi(kernel);
  try {
    await app.ready();
    const document = await SwaggerParser.validate(app.swagger());
    expect(document).toHaveProperty("openapi", "3.1.0");
    expect(document.paths).toHaveProperty(["/v1/options/{key}", "put", "requestBody"]);
  } finally {
    await app.close();
  }
});
