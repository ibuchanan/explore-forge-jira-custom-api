// fallow-ignore-file unused-file
/**
 * Admin page frontend — surfaces the base URLs for making REST API requests
 * to this Forge app on the current site.
 *
 * The base URL patterns (from Forge docs):
 *   https://api.atlassian.com/svc/<product>/<cloud-id>/apps/<app-id>_<env-id>
 *   https://<site-name>/gateway/api/svc/<product>/apps/<app-id>_<env-id>
 *
 * @see {@link https://developer.atlassian.com/platform/forge/expose-forge-app-rest-apis/#step-5--deploy-your-app}
 */

import { type FullContext, view } from "@forge/bridge";
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
const APP_UUID = "bb398628-d837-4378-9fe5-9b033fb24aac";

interface AdminPageContext {
  appId: string;
  envId: string;
  cloudId: string;
  currentAccountId: string | null;
  siteHostname: string | null;
  baseUrlViaCloudId: string;
  baseUrlViaSiteName: string | null;
}

interface SelectedUser {
  id: string;
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
        const product = "jira";
        const appEnvSegment = `${appId}_${envId}`;
        const siteHostname = getSiteHostname(ctx);
        const currentAccountId = ctx.accountId ?? null;
        setContext({
          appId,
          envId,
          cloudId,
          currentAccountId,
          siteHostname,
          baseUrlViaCloudId: `https://api.atlassian.com/svc/${product}/${cloudId}/apps/${appEnvSegment}`,
          baseUrlViaSiteName: siteHostname
            ? `https://${siteHostname}/gateway/api/svc/${product}/apps/${appEnvSegment}`
            : null,
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
          Use either base URL below to make authenticated REST API requests to
          this Forge app from external clients. Append the route path (e.g.{" "}
          <Text as="strong">/workitem</Text>) to complete the endpoint URL.
          Authentication requires a 3LO OAuth 2.0 access token.
        </Text>
      </SectionMessage>
      <Box xcss={cardStyle}>
        <Stack space="space.150">
          <Heading size="small">Base URL (via Cloud ID)</Heading>
          <CodeBlock language="text" text={context.baseUrlViaCloudId} />
          <Text>
            Example:{" "}
            <Text as="strong">POST {context.baseUrlViaCloudId}/workitem</Text>
          </Text>
        </Stack>
      </Box>

      <Box xcss={cardStyle}>
        <Stack space="space.150">
          <Heading size="small">Base URL (via Site Name)</Heading>
          {context.baseUrlViaSiteName ? (
            <>
              <CodeBlock language="text" text={context.baseUrlViaSiteName} />
              <Text>
                Derived from this site:{" "}
                <Text as="strong">{context.siteHostname}</Text>
              </Text>
            </>
          ) : (
            <SectionMessage appearance="warning" title="Site URL unavailable">
              <Text>
                Forge did not provide a valid site URL in the page context. Use
                the Cloud ID URL above, or refresh this page and try again.
              </Text>
            </SectionMessage>
          )}
        </Stack>
      </Box>

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
