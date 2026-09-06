import { readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const miniprogramRoot = resolve(root, "miniprogram");

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(path);
    return [".ts", ".json", ".wxml", ".wxss"].includes(extname(entry.name))
      ? [path]
      : [];
  });
}

describe("微信小程序项目结构", () => {
  it("declares only pages with complete native page files", () => {
    const appConfig = JSON.parse(read("miniprogram/app.json")) as {
      pages: string[];
    };
    expect(appConfig.pages.length).toBeGreaterThan(0);

    for (const page of appConfig.pages) {
      for (const extension of ["ts", "wxml", "wxss", "json"]) {
        expect(
          () => readFileSync(resolve(miniprogramRoot, `${page}.${extension}`), "utf8"),
          `${page}.${extension} 应存在且可读`
        ).not.toThrow();
      }
    }
  });

  it("uses native WXML instead of unsupported HTML tags or inline script", () => {
    const appConfig = JSON.parse(read("miniprogram/app.json")) as {
      pages: string[];
    };
    for (const page of appConfig.pages) {
      const wxml = read(`miniprogram/${page}.wxml`);
      expect(wxml).not.toMatch(/<(?:html|body|div|span|script|style)\b/i);
      expect(wxml).not.toContain("onclick=");
    }
  });

  it("keeps the offline runtime free of browser DOM and network APIs", () => {
    const combined = sourceFilesUnder(miniprogramRoot)
      .filter((path) => path.endsWith(".ts"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(combined).not.toMatch(/\b(?:document|window)\s*\./);
    expect(combined).not.toMatch(/\b(?:innerHTML|XMLHttpRequest|WebSocket|fetch)\b/);
    expect(combined).not.toMatch(/\bwx\.(?:request|uploadFile|downloadFile)\b/);
  });

  it("does not contain common secret-bearing files or literal secrets", () => {
    const projectConfig = read("project.config.json");
    const sources = [
      projectConfig,
      ...sourceFilesUnder(miniprogramRoot).map((path) => readFileSync(path, "utf8"))
    ].join("\n");
    expect(sources).not.toMatch(
      /(?:appsecret|api[_-]?key|github[_-]?token|private[_-]?key)\s*["']?\s*[:=]/i
    );
    expect(projectConfig).toMatch(
      /"appid"\s*:\s*"(?:touristappid|wx[a-f0-9]{16})"/i
    );
  });
});
