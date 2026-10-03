// 只读查询后端：上线后直接回答
//   “这一秒画面依据什么、允许在哪用、收益归谁”，以及公开来源与收入台账。
// 写操作（登记/授权/生成/发布/结算/撤回）走 LicensingService 的同进程 API；
// HTTP 面只暴露经过同一策略引擎实时重算的只读视图。
import { createServer } from "node:http";

export function createQueryServer(service, { logger = () => {} } = {}) {
  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };

  return createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const [, root, id, action] = url.pathname.split("/");
    try {
      if (root === "assets" && action === "public") {
        return json(res, 200, service.publicView(id));
      }
      if (root === "releases" && action === "frame") {
        const raw = url.searchParams.get("sec");
        const sec = Number(raw);
        if (raw === null || !Number.isFinite(sec)) return json(res, 400, { error: "查询参数 sec 必须是数字秒" });
        return json(res, 200, service.frameLookup(id, sec));
      }
      if (root === "revenues" && action === "ledger") {
        return json(res, 200, service.revenueLedger(id));
      }
      if (root === "health") {
        return json(res, 200, { ok: true, events: service.store.events().length });
      }
      json(res, 404, {
        error: "not_found",
        routes: [
          "GET /assets/:asset_id/public",
          "GET /releases/:release_id/frame?sec=<秒>",
          "GET /revenues/:revenue_id/ledger",
        ],
      });
    } catch (err) {
      logger(err);
      json(res, err.name === "PolicyError" || /不存在|已下架/.test(err.message) ? 409 : 500, {
        error: err.message,
      });
    }
  });
}

// 直接运行：node src/server.js [events.jsonl]，从事件日志重建后提供查询
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ?? "data/demo-events.jsonl";
  const { EventStore } = await import("./store.js");
  const { LicensingService } = await import("./service.js");
  const store = await EventStore.fromFile(path);
  const service = new LicensingService(store);
  const port = Number(process.env.PORT ?? 8080);
  createQueryServer(service).listen(port, () => {
    console.log(`数字演绎授权查询后端已启动：http://localhost:${port}（事件日志 ${path}，共 ${store.events().length} 条）`);
  });
}
