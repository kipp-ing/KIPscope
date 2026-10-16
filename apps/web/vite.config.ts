import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const server = process.env.KIPSCOPE_SERVER_URL ?? "http://127.0.0.1:7310";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: server, ws: true },
    },
  },
});
