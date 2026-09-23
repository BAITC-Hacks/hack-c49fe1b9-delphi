import { readFile } from "node:fs/promises";
import { betterAuth } from "better-auth";
import { authOptions, database } from "./auth-config.mjs";

try {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo authentication users can only be seeded in development.");
  }
  const auth = betterAuth(authOptions);

  const fixture = JSON.parse(await readFile(
    new URL("../../backend/fixtures/users.json", import.meta.url), "utf8",
  ));
  const password = process.env.DELPHI_DEMO_PASSWORD ?? "password123";
  if (password.length < 8 || password.length > 128) {
    throw new Error("DELPHI_DEMO_PASSWORD must contain 8 to 128 characters.");
  }

  let created = 0;
  let existing = 0;
  for (const user of fixture.users) {
    const result = await database.query('SELECT id FROM "user" WHERE email = $1', [user.email]);
    if (result.rowCount) {
      existing += 1;
      continue;
    }
    await auth.api.signUpEmail({
      body: { email: user.email, name: user.display_name, password },
    });
    created += 1;
  }
  console.log(JSON.stringify({ created, existing, total: created + existing }));
} finally {
  await database.end();
}
