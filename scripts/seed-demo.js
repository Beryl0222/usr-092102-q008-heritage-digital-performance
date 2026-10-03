// 生成演示事件日志：node scripts/seed-demo.js [--force]
// 重放景泰蓝基线 + 一笔已结算的研学收入，供查询后端直接演示。
import { existsSync, rmSync } from "node:fs";
import { EventStore } from "../src/store.js";
import { LicensingService } from "../src/service.js";
import { buildBaseline, IDS } from "../src/scenario.js";

const path = "data/demo-events.jsonl";
if (existsSync(path)) {
  if (!process.argv.includes("--force")) {
    console.error(`${path} 已存在；加 --force 覆盖重建。`);
    process.exit(1);
  }
  rmSync(path);
}

const store = await EventStore.fromFile(path);
const service = new LicensingService(store);
buildBaseline(service);
service.recordRevenue({ revenue_id: "rev:study-demo", release_id: IDS.releases.study, amount: 100000, currency: "CNY" });
service.allocateRevenue("rev:study-demo");

console.log(`已写入 ${store.events().length} 条事件到 ${path}`);
