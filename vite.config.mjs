import { defineConfig } from "vite";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
	plugins: [tailwind()],
	server: { proxy: { "/api": "http://127.0.0.1:4317" } },
});
