import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { Box, Button, Input, Text, Toggle } from "@saleor/macaw-ui";
import React, { useEffect, useState } from "react";
import { trpcClient } from "@/trpc-client";

const ConfigurationPage = () => {
  const { appBridgeState } = useAppBridge();
  const [projectId, setProjectId] = useState("");
  const [password, setPassword] = useState("");
  const [testMode, setTestMode] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // Only run query when app bridge is ready (has token)
  const isAppReady = !!appBridgeState?.token;

  const configQuery = trpcClient.configuration.getConfig.useQuery(undefined, {
    enabled: isAppReady,
  });
  const saveConfigMutation = trpcClient.configuration.saveConfig.useMutation();

  useEffect(() => {
    if (configQuery.data) {
      setProjectId(configQuery.data.projectId);
      setTestMode(configQuery.data.testMode);
    }
  }, [configQuery.data]);

  const handleSave = async () => {
    if (!projectId.trim()) {
      setErrorMessage("Project ID is required");
      setSaveStatus("error");
      return;
    }
    if (!password.trim() && !configQuery.data?.isConfigured) {
      setErrorMessage("Password is required");
      setSaveStatus("error");
      return;
    }

    setSaveStatus("saving");
    setErrorMessage("");

    try {
      await saveConfigMutation.mutateAsync({
        projectId: projectId.trim(),
        password: password.trim() || "unchanged",
        testMode,
      });
      setSaveStatus("success");
      setPassword("");
      configQuery.refetch();
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (error) {
      setSaveStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to save configuration");
    }
  };

  if (!isAppReady || configQuery.isLoading) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        height="100%"
        width="100%"
        justifyContent="center"
        alignItems="center"
      >
        <Text size={5}>Loading configuration...</Text>
      </Box>
    );
  }

  if (configQuery.error) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        height="100%"
        width="100%"
        justifyContent="center"
        alignItems="center"
        gap={4}
      >
        <Text size={5} color="critical1">
          Error loading configuration
        </Text>
        <Text size={3} color="default2">
          {configQuery.error.message}
        </Text>
        <Button onClick={() => configQuery.refetch()}>Retry</Button>
      </Box>
    );
  }

  return (
    <Box
      display="flex"
      flexDirection="column"
      height="100%"
      width="100%"
      alignItems="center"
      paddingTop={8}
      gap={6}
    >
      <Text size={7}>Paysera Payment Configuration</Text>

      <Box
        display="flex"
        flexDirection="column"
        gap={4}
        __width="400px"
        padding={6}
        borderWidth={1}
        borderStyle="solid"
        borderColor="default1"
        borderRadius={4}
      >
        <Box display="flex" flexDirection="column" gap={2}>
          <Text size={4} fontWeight="bold">
            Project ID
          </Text>
          <Input
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="Enter your Paysera Project ID"
          />
        </Box>

        <Box display="flex" flexDirection="column" gap={2}>
          <Text size={4} fontWeight="bold">
            Password
          </Text>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              configQuery.data?.isConfigured
                ? "Leave empty to keep current password"
                : "Enter your Paysera password"
            }
          />
          {configQuery.data?.isConfigured && (
            <Text size={2} color="default2">
              Password is already configured. Enter a new value only if you want to change it.
            </Text>
          )}
        </Box>

        <Box display="flex" alignItems="center" gap={3}>
          <Toggle pressed={testMode} onPressedChange={(pressed) => setTestMode(pressed)}>
            <Text>Test Mode</Text>
          </Toggle>
          <Text size={2} color="default2">
            {testMode ? "Using Paysera sandbox" : "Using Paysera production"}
          </Text>
        </Box>

        <Box display="flex" flexDirection="column" gap={2} marginTop={2}>
          <Button onClick={handleSave} disabled={saveStatus === "saving"}>
            {saveStatus === "saving" ? "Saving..." : "Save Configuration"}
          </Button>

          {saveStatus === "success" && (
            <Text color="success1" size={3}>
              Configuration saved successfully!
            </Text>
          )}

          {saveStatus === "error" && (
            <Text color="critical1" size={3}>
              {errorMessage || "Failed to save configuration"}
            </Text>
          )}
        </Box>

        <Box
          display="flex"
          flexDirection="column"
          gap={2}
          marginTop={4}
          paddingTop={4}
          borderTopWidth={1}
          borderStyle="solid"
          borderColor="default1"
        >
          <Text size={4} fontWeight="bold">
            Status
          </Text>
          <Box display="flex" alignItems="center" gap={2}>
            <Box
              __width="8px"
              __height="8px"
              borderRadius={4}
              backgroundColor={configQuery.data?.isConfigured ? "success1" : "critical1"}
            />
            <Text size={3}>
              {configQuery.data?.isConfigured ? "Configured" : "Not configured"}
            </Text>
          </Box>
          {configQuery.data?.isConfigured && (
            <Text size={2} color="default2">
              Project ID: {configQuery.data.projectId}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default ConfigurationPage;
