import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../..");
// Same merge as npm db:* scripts: Docker URLs first, then .env (secrets)
config({ path: resolve(root, "docker/compose.override.env") });
config({ path: resolve(root, ".env") });
config({ path: resolve(root, ".env.local"), override: true });
