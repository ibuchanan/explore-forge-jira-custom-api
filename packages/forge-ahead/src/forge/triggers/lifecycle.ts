// https://developer.atlassian.com/platform/forge/events-reference/life-cycle/

import type { CommonEvent, InstallContext } from "../function";
import type { UniquelyIdentifiedObject } from "../types";

// https://developer.atlassian.com/platform/forge/events-reference/life-cycle/#type-reference
// https://developer.atlassian.com/platform/forge/events-reference/life-cycle/#type-reference-1
export interface App extends UniquelyIdentifiedObject {
  version: string;
  name?: string;
  ownerAccountId?: string;
}

interface CommonLifecycleEvent extends UniquelyIdentifiedObject, CommonEvent {
  app: App;
  environment?: UniquelyIdentifiedObject;
  // Undocumented attributes
  eventType?: string;
  selfGenerated?: boolean;
  permissions?: { scopes: Array<string> };
}

// https://developer.atlassian.com/platform/forge/events-reference/life-cycle/#installation
export interface InstallationEvent extends CommonLifecycleEvent {
  installerAccountId: string;
}
// https://developer.atlassian.com/platform/forge/events-reference/life-cycle/#upgrade
export interface UpgradeEvent extends CommonLifecycleEvent {
  upgraderAccountId: string;
}
export type LifecycleEvent = InstallationEvent | UpgradeEvent;

export type LifecycleFunction = (
  request: LifecycleEvent,
  context: InstallContext,
) => Promise<void>;
export const install: LifecycleFunction = async (request, _context) => {
  // import { truncateEvents } from "../logging";
  // console.debug(`${request.eventType} request: ${JSON.stringify(truncateEvents(request))}`);
  // console.debug(`${request.eventType} context: ${JSON.stringify(truncateEvents(_context))}`);
  console.debug(`${request.eventType} for ${request.context.moduleKey}`);
  // console.info(`Runtime versions ${JSON.stringify(process.versions)}`);
  console.info(
    `${request.eventType} Node.js runtime version ${process.versions.node}`,
  );

  const account =
    "installerAccountId" in request
      ? request.installerAccountId
      : request.upgraderAccountId;
  console.info(`${request.eventType} performed by: ${account}`);
  console.info(
    `${request.eventType} into cloud id: ${request.context.cloudId}`,
  );
  console.info(`${request.eventType} app version: ${request.app?.version}`);
  console.info(`${request.eventType} app installation id: ${request.app?.id}`);
};
