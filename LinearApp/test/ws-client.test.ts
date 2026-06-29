import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 'ws' 모듈을 가짜 소켓으로 대체해서 하트비트/재연결 타이밍을 검증한다.
// vi.mock 은 호이스팅되므로 가짜 클래스도 vi.hoisted 로 끌어올린다.
const { FakeWS, sockets } = vi.hoisted(() => {
  const { EventEmitter } = require("node:events");
  const sockets: any[] = [];
  class FakeWS extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    url: string;
    ping = vi.fn();
    terminate = vi.fn(() => { this.readyState = 3; this.emit("close"); });
    close = vi.fn(() => { this.readyState = 3; this.emit("close"); });
    constructor(url: string) { super(); this.url = url; sockets.push(this); }
  }
  return { FakeWS, sockets };
});
vi.mock("ws", () => ({ default: FakeWS }));

import { RelayClient } from "../src/main/ws-client";

const config = () => ({ relayUrl: "wss://relay", sessionToken: "tok" });
const noop = () => {};
let client: RelayClient;

beforeEach(() => { sockets.length = 0; vi.useFakeTimers(); });
afterEach(() => { client?.stop(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("RelayClient 하트비트", () => {
  it("open 후 30초마다 ping을 보낸다", () => {
    client = new RelayClient(config, noop, noop, noop);
    client.start();
    sockets[0].emit("open");
    vi.advanceTimersByTime(30_000);
    expect(sockets[0].ping).toHaveBeenCalledTimes(1);
  });

  it("ping 후 pong이 없으면 소켓을 terminate 한다(죽은 연결 감지)", () => {
    client = new RelayClient(config, noop, noop, noop);
    client.start();
    sockets[0].emit("open");
    vi.advanceTimersByTime(30_000); // ping
    expect(sockets[0].terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000); // pong 대기 만료
    expect(sockets[0].terminate).toHaveBeenCalledTimes(1);
  });

  it("pong이 오면 terminate 하지 않는다", () => {
    client = new RelayClient(config, noop, noop, noop);
    client.start();
    sockets[0].emit("open");
    vi.advanceTimersByTime(30_000); // ping
    sockets[0].emit("pong");        // 살아있음
    vi.advanceTimersByTime(10_000);
    expect(sockets[0].terminate).not.toHaveBeenCalled();
  });

  it("reconnect()는 기존 소켓을 정리하고 새 소켓을 연다", () => {
    client = new RelayClient(config, noop, noop, noop);
    client.start();
    sockets[0].emit("open");
    client.reconnect();
    expect(sockets.length).toBe(2);
    expect(sockets[0].terminate).toHaveBeenCalled();
  });
});
