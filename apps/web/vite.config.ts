import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const server = process.env.KIPSCOPE_SERVER_URL ?? "http://127.0.0.1:7310";

// Dev users (add-multiuser M2): with KIPSCOPE_DEV_USER set, the proxy adds the headers of the
// example identity module (`apps/server/examples/forward-header.mjs`) to every /api request, the
// live channel's upgrade included, so two Vite servers act as two users against one server.
const devUser = process.env.KIPSCOPE_DEV_USER;
// Lower-case, so they replace a browser's own headers of that name (Node's request keys).
const devHeaders: Record<string, string> = devUser
  ? {
      "x-forwarded-user": devUser,
      "x-forwarded-groups": process.env.KIPSCOPE_DEV_ROLES ?? "",
    }
  : {};

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // `headers` reaches plain requests and WebSocket upgrades alike (http-proxy).
      "/api": { target: server, ws: true, headers: devHeaders },
    },
  },
});
