import { defineConfig } from "vite";
import { createViteConfig } from "@brain-bbqs/config/vite";

export default defineConfig(createViteConfig({ rootDir: new URL("..", import.meta.url) }));
