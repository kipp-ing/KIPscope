import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const server = process.env.LETSVIEW_SERVER_URL ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: server, ws: true },
    },
  },
});
