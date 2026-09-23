import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import type { APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import type { AnalysisDetail } from "../../src/shared/api/generated";

export const syntheticDraftPrefix = "E2E SYNTHETIC:";

export async function removeSyntheticDraft(
  request: APIRequestContext,
  analysisId: string,
  expectedTitle: string,
) {
  assert.match(analysisId, /^[a-f0-9-]{36}$/i);
  assert.ok(expectedTitle.startsWith(syntheticDraftPrefix));
  const response = await request.get(`/backend/api/analyses/${analysisId}`);
  assert.equal(response.status(), 200, "The synthetic draft must be accessible for cleanup");
  const analysis: AnalysisDetail = await response.json();
  assert.equal(analysis.title, expectedTitle, "Refusing to remove an unrelated comparison");
  assert.equal(analysis.run, null, "Refusing to remove an analysis that has a run");

  const environment = parseEnv(await readFile(path.resolve("../backend/.env"), "utf8"));
  const databaseUrl = environment.DATABASE_URL;
  assert.ok(databaseUrl, "The local backend DATABASE_URL is required for test cleanup");
  assert.ok(databaseUrl.startsWith("postgresql+asyncpg://"));
  const connectionString = databaseUrl.replace("postgresql+asyncpg://", "postgresql://");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(connectionString).hostname),
    "Browser test cleanup only supports the local development database");
  const database = new Client({ connectionString });
  await database.connect();
  try {
    const matchingDraft = await database.query(
      "SELECT id FROM analyses WHERE id = $1 AND title = $2",
      [analysisId, expectedTitle],
    );
    assert.equal(matchingDraft.rowCount, 1, "The API and cleanup must use the same database");
    for (const document of analysis.documents) {
      const removed = await request.delete(`/backend/api/analyses/${analysisId}/documents/${document.id}`);
      assert.equal(removed.status(), 204, "Delete synthetic uploads through the API to clean their stored files");
    }
    const deleted = await database.query(
      `DELETE FROM analyses
       WHERE id = $1 AND title = $2
         AND NOT EXISTS (SELECT 1 FROM runs WHERE analysis_id = $1)
         AND NOT EXISTS (SELECT 1 FROM documents WHERE analysis_id = $1)
       RETURNING id`,
      [analysisId, expectedTitle],
    );
    assert.equal(deleted.rowCount, 1, "Remove only this empty synthetic draft without a run");
  } finally {
    await database.end();
  }
}
