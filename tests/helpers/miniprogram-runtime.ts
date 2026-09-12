import { vi } from "vitest";

export interface RuntimePage {
  data: Record<string, unknown>;
  setData(patch: Record<string, unknown>): void;
  [key: string]: unknown;
}

export interface MiniProgramRuntime {
  storage: Map<string, unknown>;
  wx: {
    getStorage: ReturnType<typeof vi.fn>;
    setStorage: ReturnType<typeof vi.fn>;
    removeStorage: ReturnType<typeof vi.fn>;
    getStorageInfo: ReturnType<typeof vi.fn>;
    showModal: ReturnType<typeof vi.fn>;
    showToast: ReturnType<typeof vi.fn>;
    getClipboardData: ReturnType<typeof vi.fn>;
    setClipboardData: ReturnType<typeof vi.fn>;
    switchTab: ReturnType<typeof vi.fn>;
    navigateTo: ReturnType<typeof vi.fn>;
    pageScrollTo: ReturnType<typeof vi.fn>;
  };
  createPage<T extends RuntimePage>(): T;
  resetPageRegistration(): void;
  cleanup(): void;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

const MAX_STORAGE_BYTES_PER_KEY = 1_000_000;

function jsonRoundTrip<T>(value: T): T {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw { errMsg: "setStorage:fail data is not JSON serializable" };
  }
  if (serialized === undefined) {
    throw { errMsg: "setStorage:fail data is not JSON serializable" };
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_STORAGE_BYTES_PER_KEY) {
    throw {
      errMsg: `setStorage:fail data exceeds ${MAX_STORAGE_BYTES_PER_KEY} bytes`,
    };
  }
  return JSON.parse(serialized) as T;
}

function restoreGlobalProperty(
  key: "wx" | "Page",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, key);
  }
}

/**
 * Small in-memory WeChat runtime used by page-controller tests.
 *
 * Domain services and repositories remain real. Only the host APIs supplied by
 * WeChat are replaced, so a page test exercises the same versioned envelope and
 * persistence path used on a device.
 */
export function installMiniProgramRuntime(): MiniProgramRuntime {
  const storage = new Map<string, unknown>();
  let capturedPage: unknown;
  let clipboard = "";
  let cleanedUp = false;
  const previousWxDescriptor = Object.getOwnPropertyDescriptor(globalThis, "wx");
  const previousPageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "Page",
  );

  const wxMock = {
    getStorage: vi.fn(async ({ key }: { key: string }) => {
      if (!storage.has(key)) {
        throw { errMsg: "getStorage:fail data not found" };
      }
      return { data: jsonRoundTrip(storage.get(key)) };
    }),
    setStorage: vi.fn(
      async ({ key, data }: { key: string; data: unknown }) => {
        storage.set(key, jsonRoundTrip(data));
        return { errMsg: "setStorage:ok" };
      },
    ),
    removeStorage: vi.fn(async ({ key }: { key: string }) => {
      storage.delete(key);
      return { errMsg: "removeStorage:ok" };
    }),
    getStorageInfo: vi.fn(async () => ({
      keys: [...storage.keys()],
      currentSize: 0,
      limitSize: 10240,
      errMsg: "getStorageInfo:ok",
    })),
    showModal: vi.fn(async () => ({
      confirm: true,
      cancel: false,
      errMsg: "showModal:ok",
    })),
    showToast: vi.fn(async () => ({ errMsg: "showToast:ok" })),
    getClipboardData: vi.fn(async () => ({ data: clipboard, errMsg: "getClipboardData:ok" })),
    setClipboardData: vi.fn(async ({ data }: { data: string }) => {
      clipboard = data;
      return { errMsg: "setClipboardData:ok" };
    }),
    switchTab: vi.fn(async () => ({ errMsg: "switchTab:ok" })),
    navigateTo: vi.fn(async () => ({ errMsg: "navigateTo:ok" })),
    pageScrollTo: vi.fn(async () => ({ errMsg: "pageScrollTo:ok" })),
  };

  Object.defineProperty(globalThis, "wx", {
    configurable: true,
    writable: true,
    value: wxMock,
  });
  Object.defineProperty(globalThis, "Page", {
    configurable: true,
    writable: true,
    value: vi.fn((definition: unknown) => {
      capturedPage = definition;
    }),
  });

  return {
    storage,
    wx: wxMock,
    createPage<T extends RuntimePage>(): T {
      if (
        typeof capturedPage !== "object" ||
        capturedPage === null ||
        !("data" in capturedPage)
      ) {
        throw new Error("Page definition was not registered");
      }
      const definition = capturedPage as RuntimePage;
      const page = {
        ...definition,
        data: clone(definition.data),
      } as T;
      page.setData = (patch: Record<string, unknown>) => {
        page.data = { ...page.data, ...clone(patch) };
      };
      return page;
    },
    resetPageRegistration() {
      capturedPage = undefined;
    },
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      capturedPage = undefined;
      restoreGlobalProperty("Page", previousPageDescriptor);
      restoreGlobalProperty("wx", previousWxDescriptor);
    },
  };
}
