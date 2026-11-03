import { describe, expect, it } from "vitest";
import { checkNames, classifyStatus } from "../scripts/check-names.js";

function fakeFetch(status: number, urls: string[] = []): typeof fetch {
  return ((input: string | URL | Request) => {
    urls.push(String(input));
    return Promise.resolve({ status } as Response);
  }) as typeof fetch;
}

describe("classifyStatus", () => {
  it("maps 404 to available, 200 to taken, others to unknown", () => {
    expect(classifyStatus(404)).toBe("available");
    expect(classifyStatus(200)).toBe("taken");
    expect(classifyStatus(500)).toBe("unknown");
  });
});

describe("checkNames", () => {
  it("classifies each status via fetch", async () => {
    expect(await checkNames(["a"], fakeFetch(404))).toEqual([{ name: "a", status: "available" }]);
    expect(await checkNames(["a"], fakeFetch(200))).toEqual([{ name: "a", status: "taken" }]);
    expect(await checkNames(["a"], fakeFetch(500))).toEqual([{ name: "a", status: "unknown" }]);
  });

  it("maps a throwing fetch to unknown", async () => {
    const boom = (() => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const rejecting = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    expect(await checkNames(["a"], boom)).toEqual([{ name: "a", status: "unknown" }]);
    expect(await checkNames(["a"], rejecting)).toEqual([{ name: "a", status: "unknown" }]);
  });

  it("requests the encoded registry URL", async () => {
    const urls: string[] = [];
    await checkNames(["@marvinliem/tempo"], fakeFetch(404, urls));
    expect(urls).toEqual(["https://registry.npmjs.org/@marvinliem%2Ftempo"]);
  });

  it("keeps input order", async () => {
    const result = await checkNames(["b", "a", "c"], fakeFetch(404));
    expect(result.map((r) => r.name)).toEqual(["b", "a", "c"]);
  });
});
