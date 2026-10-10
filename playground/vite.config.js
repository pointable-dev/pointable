import { defineConfig } from "vite";
import pointable from "../dist/vite.js";

export default defineConfig({ plugins: [pointable()] });
