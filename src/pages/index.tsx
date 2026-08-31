import { isInIframe } from "@/lib/is-in-iframe";
import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { Box, Button, Input, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { useIsMounted } from "usehooks-ts";

const AddToSaleorForm = () => (
  <Box
    as={"form"}
    display={"flex"}
    alignItems={"center"}
    gap={4}
    onSubmit={(event) => {
      event.preventDefault();

      const saleorUrl = new FormData(event.currentTarget as HTMLFormElement).get("saleor-url");
      const manifestUrl = new URL("/api/manifest", window.location.origin);
      const redirectUrl = new URL(
        `/dashboard/apps/install?manifestUrl=${manifestUrl}`,
        saleorUrl as string
      ).href;

      window.open(redirectUrl, "_blank");
    }}
  >
    <Input type="url" required label="Saleor adresas" name="saleor-url" />
    <Button type="submit">Įdiegti į Saleor</Button>
  </Box>
);

const IndexPage: NextPage = () => {
  const isMounted = useIsMounted();
  const { replace } = useRouter();
  const { appBridgeState } = useAppBridge();

  useEffect(() => {
    if (isMounted() && appBridgeState?.ready) {
      replace("/app");
    }
  }, [isMounted, appBridgeState?.ready, replace]);

  if (isInIframe()) {
    return <span>Įkeliama...</span>;
  }

  const isLocalHost = global.location.href.includes("localhost");

  return (
    <Box padding={8} display="flex" flexDirection="column" gap={4}>
      <Text size={10}>Paysera mokėjimų programėlė</Text>
      <Text as={"p"}>
        Ši programėlė skirta naudoti Saleor administravimo skydelyje. Atidarykite ją per skydelį,
        kad pasiektumėte nustatymus.
      </Text>

      {isMounted() && !isLocalHost && !appBridgeState?.ready && (
        <>
          <Text as={"p"} marginTop={4}>
            Įdiekite šią programėlę savo Saleor skydelyje:
          </Text>
          <AddToSaleorForm />
        </>
      )}
    </Box>
  );
};

export default IndexPage;
