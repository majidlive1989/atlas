import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Wait } from "testcontainers";

export function startPostgres(password: string) {
  return (
    new PostgreSqlContainer(process.env.ATLAS_TEST_POSTGRES_IMAGE ?? "postgres:17-alpine")
      .withDatabase("atlas")
      .withUsername("atlas")
      .withPassword(password)
      // PostgreSQL initializes through a temporary socket-only server. Wait for the final listener.
      .withWaitStrategy(Wait.forLogMessage(/\[1\].*database system is ready to accept connections/))
      .start()
  );
}
