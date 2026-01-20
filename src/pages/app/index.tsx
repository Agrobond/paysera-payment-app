// pages/dashboard.tsx
import { Box, Text } from "@saleor/macaw-ui";

const DashboardPage = () => {
  return (
    <>
      <Box
        display="flex"
        flexDirection="column"
        height="100%"
        width="100%"
        justifyContent="center"
        alignItems="center"
        gap={4}
      >
        <Text size={7}>Paysera Payment App</Text>
      </Box>
    </>
  );
};

export default DashboardPage;
