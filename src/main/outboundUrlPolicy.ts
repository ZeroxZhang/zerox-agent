import { lookup as dnsLookupCallback } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.com",
  "169.254.169.254",
]);
const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
];

export async function assertSafeOutboundUrl(
  value: string,
  options: {
    protocols?: string[];
    resolveHostname?: (hostname: string) => Promise<string[]>;
  } = {},
): Promise<URL> {
  const url = new URL(value);
  const protocols = options.protocols ?? ["https:", "http:"];
  if (!protocols.includes(url.protocol)) {
    throw new Error(`Outbound URL protocol ${url.protocol} is not allowed.`);
  }
  const hostname = stripIpv6Brackets(url.hostname).toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    (isIP(hostname) !== 0 && isPrivateAddress(hostname))
  ) {
    throw new Error(`Outbound URL host ${hostname} is not public.`);
  }
  const resolveHostname = options.resolveHostname ?? resolveAllAddresses;
  const addresses = isIP(hostname) ? [hostname] : await resolveHostname(hostname);
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error(`Outbound URL host ${hostname} resolves to a non-public address.`);
  }
  return url;
}

export function createSafeOutboundDispatcher(
  resolveDns: typeof dnsLookupCallback = dnsLookupCallback,
): Agent {
  return new Agent({
    connect: {
      lookup(hostname, lookupOptions, callback) {
        resolveDns(
          hostname,
          { ...lookupOptions, all: true, verbatim: true },
          (error, records) => {
            if (error) {
              callback(error, [], undefined);
              return;
            }
            const addresses = Array.isArray(records) ? records : [records];
            const requestedFamily = Number(lookupOptions.family ?? 0);
            const eligible = addresses.filter(
              (record) =>
                isPublicAddress(record.address) &&
                (requestedFamily === 0 || record.family === requestedFamily),
            );
            if (eligible.length !== addresses.length || eligible.length === 0) {
              callback(
                Object.assign(
                  new Error(`Outbound connection to ${hostname} resolved to a non-public address.`),
                  { code: "ENETUNREACH" },
                ),
                [],
                undefined,
              );
              return;
            }
            if (lookupOptions.all) {
              callback(null, eligible, undefined);
            } else {
              callback(null, eligible[0]!.address, eligible[0]!.family);
            }
          },
        );
      },
    },
  });
}

const safeOutboundDispatcher = createSafeOutboundDispatcher();

/** Fetch using a connector whose actual DNS lookup rejects non-public peers. */
export function createSafeOutboundFetch(
  dispatcher: Agent = safeOutboundDispatcher,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) =>
    undiciFetch(input as string | URL, {
      ...(init as import("undici").RequestInit | undefined),
      dispatcher,
    }) as unknown as Promise<Response>) as typeof fetch;
}

export const safeOutboundFetch = createSafeOutboundFetch();

async function resolveAllAddresses(hostname: string): Promise<string[]> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isPrivateAddress(address: string): boolean {
  return !isPublicAddress(address);
}

function isPublicAddress(address: string): boolean {
  const normalized = stripIpv6Brackets(address).toLowerCase();
  if (!ipaddr.isValid(normalized)) {
    return false;
  }
  let parsed = ipaddr.parse(normalized);
  if (parsed.kind() === "ipv6") {
    const ipv6 = parsed as ipaddr.IPv6;
    if (ipv6.isIPv4MappedAddress()) {
      parsed = ipv6.toIPv4Address();
    }
  }
  return parsed.range() === "unicast";
}
