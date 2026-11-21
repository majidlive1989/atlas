import { createHmac, timingSafeEqual } from "node:crypto";
import { problemSchema } from "@atlas/contracts";
import { AtlasProblem } from "@atlas/kernel";
import { z } from "zod";

export const securitySchema = [{ bearer: [] }];
export const commonProblems = {
  400: problemSchema,
  401: problemSchema,
  403: problemSchema,
  404: problemSchema,
  409: problemSchema,
  412: problemSchema,
  429: problemSchema,
  500: problemSchema,
  503: problemSchema,
};
export const id = z.uuid();
export const jsonValue = z.json().register(z.globalRegistry, { id: "AtlasJsonValue" });
export const jsonSettings = z.record(z.string().max(120), jsonValue);
export const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(160).optional(),
});
export const keyPattern = z
  .string()
  .max(120)
  .regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/);
export const ifMatch = z.object({ "if-match": z.string().regex(/^"[0-9]{1,9}"$/) });
export const date = z.iso.datetime();
export const uuidResponse = z.strictObject({ id });

export function pageSchema<Row extends z.ZodType>(row: Row) {
  return z.strictObject({ data: z.array(row), nextCursor: z.string().nullable() });
}

export function paging(secret: Buffer, scope: string, input: z.infer<typeof listQuery>) {
  function signature(value: string) {
    return createHmac("sha256", secret)
      .update("atlas:cursor:" + scope + ":" + value)
      .digest("base64url");
  }
  let after: string | null = null;
  if (input.cursor) {
    const parts = input.cursor.split(".");
    const [value, mac] = parts;
    if (
      parts.length !== 2 ||
      !value ||
      !mac ||
      !id.safeParse(value).success ||
      mac.length !== 43 ||
      !/^[a-zA-Z0-9_-]+$/.test(mac) ||
      !timingSafeEqual(Buffer.from(mac), Buffer.from(signature(value)))
    ) {
      throw new AtlasProblem(400, "invalid-cursor");
    }
    after = value;
  }
  return {
    after,
    limit: input.limit + 1,
    page<Row extends { id: string }>(rows: Row[]) {
      const data = rows.slice(0, input.limit);
      const last = data.at(-1);
      return {
        data,
        nextCursor: last && rows.length > input.limit ? last.id + "." + signature(last.id) : null,
      };
    },
  };
}

export function versionOf(header: string) {
  return Number(header.slice(1, -1));
}
