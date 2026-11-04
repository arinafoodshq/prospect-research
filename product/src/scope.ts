/**
 * product/src/scope.ts — per-user data scoping.
 *
 * Owner directive 2026-11-04: "every data must be scoped to the user that
 * started it or has it." business_profile is the ownership root; research_run
 * and campaign carry a denormalized owner_email stamped at creation (profiles
 * never change owner). Every read and write of user data resolves the chain
 * to an owner and returns 404 when it does not end at the caller — 404, not
 * 403, so ids stay unenumerable. Legacy rows (owner_email NULL, created
 * before scoping) match nobody.
 */

export type ScopedDb = { prepare: (sql: string) => { bind: (...p: unknown[]) => { first: <T>(col?: string) => Promise<T | null> } } };
export type Owner = string | null | undefined;

/** The profile exists and belongs to this user. */
export async function profileOwned(db: ScopedDb, email: Owner, profileId: string): Promise<boolean> {
  if (!email || !profileId) return false;
  const row = await db.prepare("SELECT id FROM business_profile WHERE id = ? AND owner_email = ?")
    .bind(profileId, email).first<{ id: string }>();
  return !!row;
}

/** The run exists and belongs to this user (denormalized owner_email). */
export async function runOwned(db: ScopedDb, email: Owner, runId: string): Promise<boolean> {
  if (!email || !runId) return false;
  const row = await db.prepare("SELECT id FROM research_run WHERE id = ? AND owner_email = ?")
    .bind(runId, email).first<{ id: string }>();
  return !!row;
}

/** prospect -> run -> owner. Two single-table lookups. */
export async function prospectOwned(db: ScopedDb, email: Owner, prospectId: string): Promise<boolean> {
  if (!email || !prospectId) return false;
  const p = await db.prepare("SELECT run_id FROM prospect WHERE id = ?")
    .bind(prospectId).first<{ run_id: string | null }>();
  if (!p || !p.run_id) return false;
  return runOwned(db, email, p.run_id);
}

/** draft -> prospect -> run -> owner. */
export async function draftOwned(db: ScopedDb, email: Owner, draftId: string): Promise<boolean> {
  if (!email || !draftId) return false;
  const d = await db.prepare("SELECT prospect_id FROM outreach_draft WHERE id = ?")
    .bind(draftId).first<{ prospect_id: string | null }>();
  if (!d || !d.prospect_id) return false;
  return prospectOwned(db, email, d.prospect_id);
}

/** The campaign exists and belongs to this user (denormalized owner_email). */
export async function campaignOwned(db: ScopedDb, email: Owner, campaignId: string): Promise<boolean> {
  if (!email || !campaignId) return false;
  const row = await db.prepare("SELECT id FROM campaign WHERE id = ? AND owner_email = ?")
    .bind(campaignId, email).first<{ id: string }>();
  return !!row;
}

/** Uniform 404 for anything that exists but is not yours (or does not exist). */
export function notYours(): Response {
  return new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}
