import { config } from "./config.js";
import { Store } from "./store.js";
const store = new Store(config().DATABASE_URL);
try {
  await store.migrate();
  console.log("Agent engine schema is ready");
} finally {
  await store.close();
}
