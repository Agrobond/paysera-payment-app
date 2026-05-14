import { Box, ConfigurationIcon } from "@saleor/macaw-ui";
import { NavigationTile } from "./NavigationTile";

export const ROUTES = {
  configuration: "/app/configuration",
} as const;

export const Navigation = () => {
  return (
    <Box width="100%" backgroundColor="default2" __height="10vh">
      <Box display="flex" flexDirection="row" gap={4} padding={4}>
        <NavigationTile href={ROUTES.configuration}>
          <ConfigurationIcon />
          Configuration
        </NavigationTile>
      </Box>
    </Box>
  );
};
