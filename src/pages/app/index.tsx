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
      setErrorMessage("Privaloma nurodyti projekto ID");
      setSaveStatus("error");
      return;
    }
    if (!password.trim() && !configQuery.data?.isConfigured) {
      setErrorMessage("Privaloma nurodyti projekto slaptažodį");
      setSaveStatus("error");
      return;
    }

    setSaveStatus("saving");
    setErrorMessage("");

    try {
      await saveConfigMutation.mutateAsync({
        projectId: projectId.trim(),
        // Leave the field blank to keep the currently stored password.
        password: password.trim() || undefined,
        testMode,
      });
      setSaveStatus("success");
      setPassword("");
      configQuery.refetch();
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (error) {
      setSaveStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Nepavyko išsaugoti nustatymų");
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
        <Text size={5}>Įkeliami nustatymai...</Text>
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
          Nepavyko įkelti nustatymų
        </Text>
        <Text size={3} color="default2">
          {configQuery.error.message}
        </Text>
        <Button onClick={() => configQuery.refetch()}>Bandyti dar kartą</Button>
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
      <Text size={7}>Paysera mokėjimų nustatymai</Text>

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
            Projekto ID
          </Text>
          <Input
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="Įveskite Paysera projekto ID"
          />
        </Box>

        <Box display="flex" flexDirection="column" gap={2}>
          <Text size={4} fontWeight="bold">
            Projekto slaptažodis
          </Text>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              configQuery.data?.isConfigured
                ? "Palikite tuščią, kad išliktų dabartinis slaptažodis"
                : "Įveskite Paysera projekto slaptažodį"
            }
          />
          <Text size={2} color="default2">
            Turi tiksliai sutapti su slaptažodžiu, nurodytu Paysera projekto skiltyje „Bendri
            nustatymai“.
          </Text>
          {configQuery.data?.isConfigured && (
            <Text size={2} color="default2">
              Slaptažodis jau išsaugotas. Įveskite naują reikšmę tik jei norite jį pakeisti.
            </Text>
          )}
        </Box>

        <Box display="flex" alignItems="center" gap={3}>
          <Toggle pressed={testMode} onPressedChange={(pressed) => setTestMode(pressed)}>
            <Text>Bandymų režimas</Text>
          </Toggle>
          <Text size={2} color="default2">
            {testMode
              ? "Bandomieji mokėjimai – pinigai nenuskaitomi"
              : "Tikri mokėjimai – pinigai nuskaitomi"}
          </Text>
        </Box>

        <Box display="flex" flexDirection="column" gap={2} marginTop={2}>
          <Button onClick={handleSave} disabled={saveStatus === "saving"}>
            {saveStatus === "saving" ? "Išsaugoma..." : "Išsaugoti nustatymus"}
          </Button>

          {saveStatus === "success" && (
            <Text color="success1" size={3}>
              Nustatymai sėkmingai išsaugoti!
            </Text>
          )}

          {saveStatus === "error" && (
            <Text color="critical1" size={3}>
              {errorMessage || "Nepavyko išsaugoti nustatymų"}
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
            Būsena
          </Text>
          <Box display="flex" alignItems="center" gap={2}>
            <Box
              __width="8px"
              __height="8px"
              borderRadius={4}
              backgroundColor={configQuery.data?.isConfigured ? "success1" : "critical1"}
            />
            <Text size={3}>
              {configQuery.data?.isConfigured ? "Sukonfigūruota" : "Nesukonfigūruota"}
            </Text>
          </Box>
          {configQuery.data?.isConfigured && (
            <Text size={2} color="default2">
              Projekto ID: {configQuery.data.projectId}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default ConfigurationPage;
