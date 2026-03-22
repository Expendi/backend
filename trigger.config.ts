import { defineConfig } from "@trigger.dev/sdk";
import { additionalPackages } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "your-project-ref",
  dirs: ["./trigger"],
  runtime: "node",
  maxDuration: 300,
  build: {
    extensions: [
      additionalPackages({
        packages: ["pg", "dotenv"],
      }),
    ],
  },
});
