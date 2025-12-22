import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				project: "./tsconfig.json",
			},
			globals: {
				window: "readonly",
				document: "readonly",
				process: "readonly",
				NodeJS: "readonly",
				console: "readonly",
			},
		},
		rules: {
			"obsidianmd/sample-names": "off",
		},
	},
]);
