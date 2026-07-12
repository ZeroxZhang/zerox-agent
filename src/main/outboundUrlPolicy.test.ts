import { describe, expect, it } from "vitest";
import { lookup as dnsLookup } from "node:dns";
import {
  assertSafeOutboundUrl,
  createSafeOutboundDispatcher,
  createSafeOutboundFetch,
} from "./outboundUrlPolicy";

describe("outbound URL policy", () => {
  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://192.0.2.10/",
    "http://198.18.0.1/",
    "http://224.0.0.1/",
    "http://[fd00::1]/",
    "http://[ff02::1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:a00:1]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://metadata.google.internal/",
    "http://service.local/",
  ])("blocks literal private or metadata destinations: %s", async (url) => {
    await expect(assertSafeOutboundUrl(url)).rejects.toThrow(/not public/);
  });

  it("blocks a public hostname that resolves to a private address", async () => {
    await expect(
      assertSafeOutboundUrl("https://public.example/", {
        resolveHostname: async () => ["192.168.1.20"],
      }),
    ).rejects.toThrow(/non-public/);
  });

  it("allows HTTPS hosts resolving only to public addresses", async () => {
    await expect(
      assertSafeOutboundUrl("https://public.example/path", {
        resolveHostname: async () => ["93.184.216.34"],
      }),
    ).resolves.toMatchObject({ hostname: "public.example" });
  });

  it.each([
    [[{ address: "127.0.0.1", family: 4 }]],
    [[
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.10", family: 4 },
    ]],
    [[{ address: "::ffff:7f00:1", family: 6 }]],
  ])("rejects non-public addresses in the connector's actual DNS lookup", async (records) => {
    const resolver = ((_hostname, _options, callback) => {
      callback(null, records, undefined);
    }) as typeof dnsLookup;
    const dispatcher = createSafeOutboundDispatcher(resolver);
    try {
      await expect(
        createSafeOutboundFetch(dispatcher)("http://connector-policy.test/"),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          message: expect.stringContaining("non-public address"),
        }),
      });
    } finally {
      await dispatcher.close();
    }
  });
});
