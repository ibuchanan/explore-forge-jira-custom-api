import { webTrigger } from "@forge/api";
import Resolver from "@forge/resolver";

const resolver = new Resolver();

const webtriggerModules = [
  {
    key: "workitem-post",
    label: "Create work item",
    token: "WEBTRIGGER_TOKEN",
  },
  {
    key: "workitem-as-user-post",
    label: "Create work item as user",
    token: "WEBTRIGGER_AS_USER_TOKEN",
  },
  {
    key: "workitem-upsert-post",
    label: "Upsert work item",
    token: "WEBTRIGGER_TOKEN",
  },
  {
    key: "workitem-upsert-as-user-post",
    label: "Upsert work item as user",
    token: "WEBTRIGGER_AS_USER_TOKEN",
  },
] as const;

export interface WebtriggerUrlInfo {
  key: (typeof webtriggerModules)[number]["key"];
  label: string;
  token: string;
  url: string;
}

resolver.define("getWebtriggerUrls", async (): Promise<WebtriggerUrlInfo[]> => {
  return Promise.all(
    webtriggerModules.map(async ({ key, label, token }) => ({
      key,
      label,
      token,
      url: await webTrigger.getUrl(key),
    })),
  );
});

export const handler = resolver.getDefinitions();
