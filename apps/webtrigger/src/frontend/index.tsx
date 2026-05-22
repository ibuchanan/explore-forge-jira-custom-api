// fallow-ignore-file unused-file
/**
 * Admin page frontend — surfaces the installed webtrigger URLs for this
 * Forge app on the current site.
 *
 * The URLs are loaded through a Forge resolver because webtrigger URLs are
 * installation- and environment-specific.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/runtime-reference/web-trigger-api/}
 */

import { type FullContext, invoke, view } from "@forge/bridge";
import ForgeReconciler, {
  Box,
  CodeBlock,
  Heading,
  Inline,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  UserPicker,
  xcss,
} from "@forge/react";
import React, { useEffect, useState } from "react";

/** The app UUID — taken from the `app.id` ARI in manifest.yml (static per app). */
const APP_UUID = "ed4c162d-2d8a-4b93-a846-ed29952040eb";

interface AdminPageContext {
  appId: string;
  envId: string;
  cloudId: string;
  currentAccountId: string | null;
  siteHostname: string | null;
  webtriggerUrls: WebtriggerUrlInfo[];
}

interface SelectedUser {
  id: string;
}

interface WebtriggerUrlInfo {
  key: string;
  label: string;
  token: string;
  url: string;
}

const cardStyle = xcss({
  backgroundColor: "elevation.surface",
  borderColor: "color.border",
  borderWidth: "border.width",
  borderRadius: "radius.medium",
  padding: "space.200",
});

function getSiteHostname(context: FullContext): string | null {
  try {
    return new URL(context.siteUrl).hostname;
  } catch (_e) {
    return null;
  }
}
const App = (): JSX.Element => {
  const [context, setContext] = useState<AdminPageContext | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    const load = async () => {
      try {
        const ctx = await view.getContext();
        const cloudId = ctx.cloudId ?? "";
        // environmentId may be a bare UUID or a full ARI — take the last segment
        const envId = (ctx.environmentId ?? "").split("/").pop() ?? "";
        const appId = APP_UUID;
        const siteHostname = getSiteHostname(ctx);
        const currentAccountId = ctx.accountId ?? null;
        const webtriggerUrls =
          await invoke<WebtriggerUrlInfo[]>("getWebtriggerUrls");
        setContext({
          appId,
          envId,
          cloudId,
          currentAccountId,
          siteHostname,
          webtriggerUrls,
        });
        setSelectedAccountId(currentAccountId);
      } catch (_e) {
        setError("Failed to load context. Please refresh the page.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <Inline alignBlock="center" space="space.100">
        <Spinner size="small" />
        <Text>Loading…</Text>
      </Inline>
    );
  }

  if (error || !context) {
    return (
      <SectionMessage appearance="error" title="Error">
        <Text>{error ?? "Unknown error"}</Text>
      </SectionMessage>
    );
  }

  return (
    <Stack space="space.300">
      <SectionMessage appearance="information" title="How to use these URLs">
        <Text>
          Use the webtrigger URLs below to call this Forge app from external
          clients. Each request must include a short-lived JWT Bearer token
          signed with the token shown for that endpoint.
        </Text>
      </SectionMessage>

      {context.webtriggerUrls.map((webtrigger) => (
        <Box key={webtrigger.key} xcss={cardStyle}>
          <Stack space="space.150">
            <Heading size="small">{webtrigger.label}</Heading>
            <CodeBlock language="text" text={webtrigger.url} />
            <Stack space="space.050">
              <Text>
                Trigger key: <Text as="strong">{webtrigger.key}</Text>
              </Text>
              <Text>
                Token: <Text as="strong">{webtrigger.token}</Text>
              </Text>
            </Stack>
          </Stack>
        </Box>
      ))}

      <Box xcss={cardStyle}>
        <Stack space="space.150">
          <Heading size="small">Account ID lookup</Heading>
          <UserPicker
            label="User"
            name="account-id-user"
            description="Select a user to reveal their Atlassian account ID. The current user is selected by default."
            placeholder="Select a user"
            defaultValue={context.currentAccountId ?? undefined}
            onChange={(user: SelectedUser) => setSelectedAccountId(user.id)}
          />
          {selectedAccountId ? (
            <Text>
              Account ID: <Text as="strong">{selectedAccountId}</Text>
            </Text>
          ) : (
            <Text>Select a user to show their account ID.</Text>
          )}
        </Stack>
      </Box>

      <Box xcss={cardStyle}>
        <Stack space="space.150">
          <Heading size="small">Details</Heading>
          <Stack space="space.100">
            <Inline space="space.100">
              <Text as="strong">App ID:</Text>
              <Text>{context.appId}</Text>
            </Inline>
            <Inline space="space.100">
              <Text as="strong">Environment ID:</Text>
              <Text>{context.envId}</Text>
            </Inline>
            <Inline space="space.100">
              <Text as="strong">Cloud ID:</Text>
              <Text>{context.cloudId}</Text>
            </Inline>
          </Stack>
        </Stack>
      </Box>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
