import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@resvg/resvg-js"],
  outputFileTracingIncludes: { "/api/chart": ["./assets/fonts/NotoSans-Regular.ttf"] },
};
export default config;
