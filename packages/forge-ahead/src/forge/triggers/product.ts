// fallow-ignore-file unused-file
// Placeholder handler for Forge product triggers (jira:issue, confluence:page, etc.).
// Not yet wired into index.ts; kept as a starting point for future trigger support.
import type { CommonEvent, InstallContext } from "../function";
// import { truncateEvents } from "../logging";

export type TriggerEvent = CommonEvent;
export type TriggerFunction = (
  request: TriggerEvent,
  context: InstallContext,
) => Promise<void>;

export const productEventHandler: TriggerFunction = async (
  request,
  _context,
) => {
  // import { truncateEvents } from "../logging";
  // console.debug(`trigger request: ${JSON.stringify(truncateEvents(request))}`);
  // console.debug(`trigger context: ${JSON.stringify(truncateEvents(_context))}`);
  console.debug(`trigger for ${request.context.moduleKey}`);
};
