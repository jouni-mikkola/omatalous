import { createServer, type AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { pinnedLookup, postPinned, publicAddress, type Pin } from "../src/services/pinned-post.ts";

const PUBLIC: Pin = { address: "93.184.216.34", family: 4 };
const INSIDE: Pin = { address: "192.168.1.20", family: 4 };

describe("a notice goes to the address that was checked", () => {
  it("refuses a name with any private answer and one that does not resolve", async () => {
    expect(await publicAddress("hooks.example.org", async () => [PUBLIC])).toEqual(PUBLIC);
    expect(await publicAddress("hooks.example.org", async () => [PUBLIC, INSIDE])).toBeNull();
    expect(await publicAddress("hooks.example.org", async () => [{ address: "fd00::1", family: 6 }])).toBeNull();
    expect(await publicAddress("hooks.example.org", async () => [])).toBeNull();
    expect(
      await publicAddress("hooks.example.org", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).toBeNull();
  });

  it("does not ask DNS again after the check, so a name that turns private a moment later is not followed (rebinding)", async () => {
    let asked = 0;
    const rebinding = async (): Promise<Pin[]> => (++asked === 1 ? [PUBLIC] : [INSIDE]);
    const pin = await publicAddress("rebind.example.org", rebinding);
    expect(pin).toEqual(PUBLIC);
    const seen = await new Promise<unknown>((resolve, reject) => {
      pinnedLookup(pin!)("rebind.example.org", {}, (err, address, family) => (err ? reject(err) : resolve({ address, family })));
    });
    expect(seen).toEqual({ address: PUBLIC.address, family: 4 });
    const all = await new Promise<unknown>((resolve, reject) => {
      pinnedLookup(pin!)("rebind.example.org", { all: true }, (err, list) => (err ? reject(err) : resolve(list)));
    });
    expect(all).toEqual([{ address: PUBLIC.address, family: 4 }]);
    expect(asked).toBe(1);
    // the next check meets the changed answer and refuses
    expect(await publicAddress("rebind.example.org", rebinding)).toBeNull();
  });

  it("opens the socket to the pinned address and names the host in the TLS hello", async () => {
    const hello = new Promise<Buffer>((resolve) => {
      const server = createServer((socket) => {
        socket.once("data", (d) => {
          resolve(d);
          socket.destroy();
          server.close();
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        // the name resolves nowhere: only the pin can lead the request to this server
        void postPinned(new URL(`https://webhook.invalid:${port}/in`), {}, "{}", { address: "127.0.0.1", family: 4 }, 5_000).catch(() => undefined);
      });
    });
    expect((await hello).includes("webhook.invalid")).toBe(true);
  });
});
