import { describe, expect, it } from "vitest";
import { AdxSource } from "../src/adx.ts";
import { adxDatetime, KustoClient, KustoError, type KustoParam } from "../src/kusto.ts";
import { adxEventMapping, adxMapping } from "./adxdb.ts";

const CLUSTER = "https://kipscope-fake.westeurope.kusto.windows.net";
const B = 1791158400000000000n;

interface Sent {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: {
    db: string;
    csl: string;
    properties: { Options: { servertimeout: string }; Parameters: Record<string, string> };
  };
}

/** A fake fetch that records every request and answers with `answer`. */
function fakeFetch(answer: () => Response) {
  const sent: Sent[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    sent.push({
      url: String(url),
      method: init?.method,
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    return answer();
  };
  return { fetchImpl, sent };
}

/** A v2 answer with one primary table of `rows` and a clean completion frame. */
const framesOf = (rows: unknown[], completion: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify([
      { FrameType: "DataSetHeader", IsProgressive: false, Version: "v2.0" },
      {
        FrameType: "DataTable",
        TableKind: "PrimaryResult",
        TableName: "PrimaryResult",
        Rows: rows,
      },
      { FrameType: "DataSetCompletion", HasErrors: false, Cancelled: false, ...completion },
    ]),
    { status: 200 },
  );

const client = (fetchImpl: typeof fetch, token?: () => Promise<string>) =>
  new KustoClient({
    cluster: CLUSTER,
    database: "kipscope_test",
    timeoutSeconds: 30,
    fetch: fetchImpl,
    ...(token ? { token } : {}),
  });

describe("KustoClient request", () => {
  it("sends parameters and limits", async () => {
    const { fetchImpl, sent } = fakeFetch(() => framesOf([]));
    const source = new AdxSource(client(fetchImpl), adxMapping, adxEventMapping);
    await source.raw({ dataRef: "conf-a", name: `it's "q"`, sna: [] }, B, B + 1_000_000_000n, 5);

    expect(sent).toHaveLength(1);
    const request = sent[0] as Sent;
    expect(request.url).toBe(`${CLUSTER}/v2/rest/query`);
    expect(request.method).toBe("POST");
    expect(request.body.db).toBe("kipscope_test");
    expect(request.body.csl.startsWith("declare query_parameters(")).toBe(true);
    expect(request.body.properties.Options.servertimeout).toBe("00:00:30");
    // The signal name travels as a parameter, never inside the query text.
    expect(request.body.properties.Parameters.sig).toBe(`it's "q"`);
    expect(request.body.csl).not.toContain(`it's`);
    expect(request.headers["x-ms-app"]).toBe("KIPscope");
    expect(request.headers["x-ms-client-request-id"]).toMatch(/^KIPscope\.query;[0-9a-f-]{36}$/);
    expect(request.headers.Accept).toBe("application/json");
    expect(request.headers["Content-Type"]).toBe("application/json; charset=utf-8");
    // No token getter: no Authorization header (the emulator).
    expect(request.headers).not.toHaveProperty("Authorization");
  });

  it("sends every parameter type in its encoding", async () => {
    const { fetchImpl, sent } = fakeFetch(() => framesOf([[1]]));
    const params: Record<string, KustoParam> = {
      s: { type: "string", value: "x" },
      from: { type: "datetime", value: B },
      lim: { type: "long", value: 1001 },
      big: { type: "long", value: 1791158400123456700n },
      names: { type: "dynamic", value: ["a", "b'c", 3] },
    };
    const rows = await client(fetchImpl, async () => "tok").query("print 1", params);
    expect(rows).toEqual([[1]]);
    const request = sent[0] as Sent;
    expect(request.body.csl.split("\n")[0]).toBe(
      "declare query_parameters(s:string, from:datetime, lim:long, big:long, names:dynamic);",
    );
    expect(request.body.csl.endsWith("print 1")).toBe(true);
    expect(request.body.properties.Parameters).toEqual({
      s: "x",
      from: "2026-10-05T00:00:00.0000000Z",
      lim: "1001",
      big: "1791158400123456700",
      names: 'dynamic(["a","b\'c",3])',
    });
    expect(request.headers.Authorization).toBe("Bearer tok");
  });

  it("sends real parameters", async () => {
    const { fetchImpl, sent } = fakeFetch(() => framesOf([[1]]));
    const params: Record<string, KustoParam> = {
      k0: { type: "real", value: 2.5 },
      k1: { type: "real", value: 1e21 },
      k2: { type: "real", value: Number.NaN },
      k3: { type: "real", value: Number.NEGATIVE_INFINITY },
      k4: { type: "real", value: -3 },
    };
    await client(fetchImpl).query("print 1", params);
    const request = sent[0] as Sent;
    expect(request.body.csl.split("\n")[0]).toBe(
      "declare query_parameters(k0:real, k1:real, k2:real, k3:real, k4:real);",
    );
    expect(request.body.properties.Parameters).toEqual({
      k0: "real(2.5)",
      k1: "real(1e+21)",
      k2: "real(nan)",
      k3: "real(-inf)",
      k4: "real(-3)",
    });
    // Positive infinity and zero pass too (a seed value is any number the table holds).
    await client(fetchImpl).query("print 1", {
      k5: { type: "real", value: Number.POSITIVE_INFINITY },
      k6: { type: "real", value: 0 },
    });
    expect((sent[1] as Sent).body.properties.Parameters).toEqual({
      k5: "real(+inf)",
      k6: "real(0)",
    });
  });

  it("rounds bounds up to the next tick", async () => {
    // Stored times are multiples of 100 ns, so rounding a bound up keeps every half-open range.
    expect(adxDatetime(B)).toBe("2026-10-05T00:00:00.0000000Z");
    expect(adxDatetime(B + 100n)).toBe("2026-10-05T00:00:00.0000001Z");
    expect(adxDatetime(B + 1n)).toBe("2026-10-05T00:00:00.0000001Z");
    expect(adxDatetime(B + 99n)).toBe("2026-10-05T00:00:00.0000001Z");
    expect(adxDatetime(B + 123_456_700n)).toBe("2026-10-05T00:00:00.1234567Z");
    expect(adxDatetime(B + 123_456_701n)).toBe("2026-10-05T00:00:00.1234568Z");
    expect(adxDatetime(B + 123_457_801n)).toBe("2026-10-05T00:00:00.1234579Z");
    expect(adxDatetime(B + 999_999_901n)).toBe("2026-10-05T00:00:01.0000000Z");
    // Before 1970 rounding still goes up (toward the later time).
    expect(adxDatetime(-1_500_000_000n)).toBe("1969-12-31T23:59:58.5000000Z");
    expect(adxDatetime(-101n)).toBe("1969-12-31T23:59:59.9999999Z");
    expect(adxDatetime(-1n)).toBe("1970-01-01T00:00:00.0000000Z");

    // The adapter sends the rounded bounds: [B + 123,456,701, B + 123,457,801) as 1234568 and 1234579.
    const { fetchImpl, sent } = fakeFetch(() => framesOf([]));
    const source = new AdxSource(client(fetchImpl), adxMapping, adxEventMapping);
    const fine = { dataRef: "conf-a", name: "Fine.NS", sna: [] };
    await source.raw(fine, B + 123_456_701n, B + 123_457_801n);
    await source.before(fine, B + 123_456_701n);
    await source.after(fine, B + 123_456_701n);
    // The bound parameters, whatever the adapter names them: the datetime ones end in "Z".
    const bounds = sent.map((request) =>
      Object.values(request.body.properties.Parameters).filter((value) => value.endsWith("Z")),
    );
    expect(bounds[0]).toEqual(["2026-10-05T00:00:00.1234568Z", "2026-10-05T00:00:00.1234579Z"]);
    expect(bounds[1]).toEqual(["2026-10-05T00:00:00.1234568Z"]);
    expect(bounds[2]).toEqual(["2026-10-05T00:00:00.1234568Z"]);
  });
});

describe("KustoClient errors", () => {
  it("fails on error frames and error answers", async () => {
    // 200 with a completion frame that reports errors: the rows it got are not returned.
    const limits = fakeFetch(() =>
      framesOf([[1], [2]], {
        HasErrors: true,
        OneApiErrors: [
          {
            error: {
              code: "LimitsExceeded",
              message: "Request is invalid",
              "@message": "Query result set has exceeded the internal record count limit 500000",
            },
          },
        ],
      }),
    );
    await expect(client(limits.fetchImpl).query("T", {})).rejects.toThrow(
      /Query result set has exceeded the internal record count limit 500000/,
    );

    // 400 with a Kusto error object: its @message.
    const semantic = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: "BadRequest_SemanticError",
              message: "Request is invalid",
              "@message": "Semantic error: SEM0100: 'extend' operator: Failed to resolve table",
            },
          }),
          { status: 400 },
        ),
    );
    const failed = await client(semantic.fetchImpl)
      .query("T", {})
      .catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(KustoError);
    expect((failed as KustoError).message).toContain("SEM0100: 'extend' operator");
    expect((failed as KustoError).status).toBe(400);

    // An error row among the rows of a 200 answer (e.g. LowMemoryCondition) fails as well.
    const inData = fakeFetch(() =>
      framesOf([
        [1],
        {
          OneApiErrors: [
            { error: { code: "LowMemoryCondition", "@message": "Low memory condition" } },
          ],
        },
      ]),
    );
    await expect(client(inData.fetchImpl).query("T", {})).rejects.toThrow(/Low memory condition/);

    // A plain-text answer shows its first line; 401 adds what to do.
    const plain = fakeFetch(() => new Response("Bad gateway\nmore", { status: 502 }));
    await expect(client(plain.fetchImpl).query("T", {})).rejects.toThrow(/Bad gateway/);
    const denied = fakeFetch(
      () => new Response(JSON.stringify({ error: { message: "Unauthorized" } }), { status: 401 }),
    );
    await expect(client(denied.fetchImpl).query("T", {})).rejects.toThrow(
      /run az login, or check your access to database kipscope_test/,
    );
  });

  it("never puts the token into errors", async () => {
    const token = "secret-token-123";
    const getToken = async () => token;

    const denied = fakeFetch(
      () =>
        new Response(JSON.stringify({ error: { "@message": "Unauthorized: bad token" } }), {
          status: 401,
        }),
    );
    const unauthorized = await client(denied.fetchImpl, getToken)
      .query("T", {})
      .catch((error: unknown) => error as Error);
    expect(unauthorized).toBeInstanceOf(Error);
    expect((unauthorized as Error).message).not.toContain(token);
    expect(String((unauthorized as Error).stack)).not.toContain(token);
    // The request did carry the token.
    expect(denied.sent[0]?.headers.Authorization).toBe(`Bearer ${token}`);

    const network: typeof fetch = async () => {
      throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:1") });
    };
    const unreachable = await client(network, getToken)
      .query("T", {})
      .catch((error: unknown) => error as Error);
    expect((unreachable as Error).message).toContain("ECONNREFUSED");
    expect((unreachable as Error).message).not.toContain(token);
    expect(JSON.stringify(unreachable, Object.getOwnPropertyNames(unreachable))).not.toContain(
      token,
    );
  });
});
