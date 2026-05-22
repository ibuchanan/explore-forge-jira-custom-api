/**
 * Forge app entry point.
 *
 * Re-exports all handler functions referenced in manifest.yml so Forge
 * can resolve them at runtime via the `handler` field of each function module.
 */

export { handleWorkitem } from "./workitem/handler";
export { handleWorkitemAsUser } from "./workitem/insert-as-user-handler";
export { handleWorkitemUpsert } from "./workitem/upsert-handler";
export { handleWorkitemUpsertAsUser } from "./workitem/upsert-as-user-handler";
export { handler as adminPageResolver } from "./resolvers";
