import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [cloudflare()],
  server: {
    host: "127.0.0.1",
    // Hard-coded — not Vite's default 5173.
    port: 8787,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 8787,
    strictPort: true,
  },
});
