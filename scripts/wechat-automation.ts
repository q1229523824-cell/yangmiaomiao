/** Small client for the protocol used by WeChat's miniprogram-automator SDK.
 * Uses Node 22's WebSocket so no legacy SDK dependency enters the project.
 */
import { randomUUID } from "node:crypto";

export interface SimulatorPage { pageId: number; path: string }
export interface SimulatorElement { elementId: string; pageId: number; tagName: string }

export class WeChatAutomation {
  private pending = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  readonly exceptions: unknown[] = [];
  private constructor(private socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.method === "App.exceptionThrown") this.exceptions.push(message.params);
      const callback = this.pending.get(message.id);
      if (!callback) return;
      clearTimeout(callback.timer);
      this.pending.delete(message.id);
      if (message.error) callback.reject(new Error(message.error.message));
      else callback.resolve(message.result);
    });
    socket.addEventListener("close", () => this.rejectPending());
  }

  static async connect(port = 9420): Promise<WeChatAutomation> {
    const deadline = Date.now() + 20_000;
    let lastError: unknown;
    do {
      try { return await this.connectOnce(port); }
      catch (error) { lastError = error; }
      await new Promise((resolve) => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    throw lastError;
  }

  private static async connectOnce(port: number): Promise<WeChatAutomation> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const client = new WeChatAutomation(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("WeChat automation connection timed out"));
      }, 15_000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Start the project with cli auto --auto-port 9420 before connecting"));
      }, { once: true });
    });
    return client;
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`WeChat automation timed out: ${method}`));
      }, 20_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async wx<T = any>(method: string, ...args: unknown[]): Promise<T> {
    return (await this.send("App.callWxMethod", { method, args })).result;
  }

  async evaluate<T = any>(fn: (...args: any[]) => unknown, ...args: unknown[]): Promise<T> {
    return (await this.send("App.callFunction", {
      functionDeclaration: fn.toString(), args,
    })).result;
  }

  async currentPage(): Promise<SimulatorPage> { return this.send("App.getCurrentPage"); }

  async route(path: string, method: "switchTab" | "reLaunch" = "switchTab") {
    const previous = method === "reLaunch" ? await this.currentPage() : undefined;
    await this.wx(method, { url: `/${path}` });
    let page!: SimulatorPage;
    await until(async () => {
      page = await this.currentPage();
      return page.path === path && (!previous || page.pageId !== previous.pageId);
    }, `route ${path}`);
    await this.ready(page);
    return this.currentPage();
  }

  async data<T = any>(page: SimulatorPage): Promise<T> {
    try {
      return (await this.send("Page.getData", { pageId: page.pageId })).data;
    } catch (error) {
      const message = String(error);
      if (!message.includes("page is not on top of page stack")) throw error;
      const current = await this.currentPage();
      return (await this.send("Page.getData", { pageId: current.pageId })).data;
    }
  }

  async ready(page: SimulatorPage): Promise<void> {
    await until(async () => {
      const current = await this.currentPage();
      if (current.path !== page.path) return false;
      const data = await this.data(current);
      return !data.loading && !data.busy;
    }, `ready ${page.path}`);
  }

  async element(page: SimulatorPage, selector: string): Promise<SimulatorElement> {
    // setData is observable before the native view layer commits its nodes.
    // Retry read-only lookup, never the tap/write itself, across that boundary.
    let element: SimulatorElement | undefined;
    await until(async () => {
      const current = await this.currentPage();
      if (current.path !== page.path) return false;
      try {
        const result = await this.send("Page.getElement", { pageId: current.pageId, selector });
        if (!result.elementId) return false;
        element = { ...result, pageId: current.pageId };
        return true;
      } catch (error) {
        if (/no such element|page is not on top of page stack/.test(String(error))) return false;
        throw error;
      }
    }, `rendered element ${selector} on ${page.path}`, 6000);
    return element!;
  }

  async tap(page: SimulatorPage, selector: string): Promise<void> {
    try {
      const element = await this.element(page, selector);
      await this.send("Element.tap", { pageId: element.pageId, elementId: element.elementId });
      return;
    } catch (error) {
      if (!String(error).includes("page is not on top of page stack")) throw error;
      const current = await this.currentPage();
      const element = await this.element(current, selector);
      await this.send("Element.tap", { pageId: element.pageId, elementId: element.elementId });
    }
  }

  async input(page: SimulatorPage, selector: string, value: string): Promise<void> {
    try {
      const element = await this.element(page, selector);
      await this.send("Element.callFunction", {
        pageId: element.pageId, elementId: element.elementId,
        functionName: "input.input", args: [value],
      });
      return;
    } catch (error) {
      if (!String(error).includes("page is not on top of page stack")) throw error;
      const current = await this.currentPage();
      const element = await this.element(current, selector);
      await this.send("Element.callFunction", {
        pageId: element.pageId, elementId: element.elementId,
        functionName: "input.input", args: [value],
      });
    }
  }

  async trigger(page: SimulatorPage, selector: string, type: string, detail: unknown): Promise<void> {
    try {
      const element = await this.element(page, selector);
      await this.send("Element.triggerEvent", {
        pageId: element.pageId, elementId: element.elementId, type, detail,
      });
      return;
    } catch (error) {
      if (!String(error).includes("page is not on top of page stack")) throw error;
      const current = await this.currentPage();
      const element = await this.element(current, selector);
      await this.send("Element.triggerEvent", {
        pageId: element.pageId, elementId: element.elementId, type, detail,
      });
    }
  }

  async modal(confirm: boolean): Promise<void> {
    await this.evaluate(() => { getApp().globalData.testModalCalls = 0; });
    await this.send("App.mockWxMethod", {
      method: "showModal",
      functionDeclaration: `function (options) {
        getApp().globalData.testModalCalls += 1;
        var result = { confirm: ${confirm}, cancel: ${!confirm}, errMsg: 'showModal:ok' };
        if (options && options.success) options.success(result);
        return Promise.resolve(result);
      }`,
    });
  }

  private rejectPending() {
    for (const { timer, reject } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("WeChat automation disconnected"));
    }
    this.pending.clear();
  }

  close() { this.rejectPending(); this.socket.close(); }
}

export async function until(predicate: () => Promise<boolean>, description: string, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  do {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}`);
}
