import assert from "node:assert/strict";
import test from "node:test";

import { EventStore } from "../src/store.js";
import { LicensingService } from "../src/service.js";
import { createQueryServer } from "../src/server.js";
import { buildBaseline, IDS } from "../src/scenario.js";

const CLOCK = "2026-10-03T09:00:00+08:00";

async function withServer(run) {
  const store = new EventStore({ now: () => CLOCK });
  const service = new LicensingService(store, { now: () => CLOCK });
  buildBaseline(service);
  const server = createQueryServer(service);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  try {
    await run(`http://localhost:${port}`);
  } finally {
    server.close();
  }
}

const get = async (base, pathname) => {
  const res = await fetch(`${base}${pathname}`);
  return { status: res.status, body: await res.json() };
};

test("查询后端：逐秒依据、公开来源、收入台账可经 HTTP 回答", async () => {
  await withServer(async (base) => {
    const frame = await get(base, `/releases/${IDS.releases.study}/frame?sec=15`);
    assert.equal(frame.status, 200);
    assert.ok(frame.body.materials.some((m) => m.title === "缠枝莲纹传统纹样"));
    assert.equal(frame.body.materials.find((m) => m.material_id === IDS.materials.pattern).rights.teaching.status, "allowed");

    const pub = await get(base, `/assets/${IDS.assets.trailer}/public`);
    assert.equal(pub.status, 200);
    const titles = pub.body.versions[0].sources.map((s) => s.title);
    assert.ok(titles.includes("缠枝莲纹传统纹样"));

    // 缺 sec 参数返回 400；未知路由 404
    assert.equal((await get(base, `/releases/${IDS.releases.study}/frame`)).status, 400);
    assert.equal((await get(base, "/nope")).status, 404);
  });
});
