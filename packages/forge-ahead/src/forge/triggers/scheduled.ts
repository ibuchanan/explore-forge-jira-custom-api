// fallow-ignore-file unused-file
// Placeholder handler for Forge scheduled triggers.
// Not yet wired into index.ts; kept as a starting point for future trigger support.
import type { CommonEvent, InstallContext } from "../function";

export type ScheduledEvent = CommonEvent;
export type ScheduledFunction = (
  request: ScheduledEvent,
  context: InstallContext,
) => Promise<void>;

export const heartbeat: ScheduledFunction = async (request, _context) => {
  // import { truncateEvents } from "../logging";
  // console.debug(`core:scheduledTrigger request: ${JSON.stringify(truncateEvents(request))}`);
  // console.debug(`core:scheduledTrigger context: ${JSON.stringify(truncateEvents(_context))}`);
  console.debug(`core:scheduledTrigger for ${request.context.moduleKey}`);
};
