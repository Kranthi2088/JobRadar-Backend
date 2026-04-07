import { buildApp } from "./app.js";

const PORT = parseInt(process.env.PORT || process.env.API_PORT || "3002", 10);
const app = await buildApp();
await app.listen({ port: PORT, host: "0.0.0.0" });
app.log.info(`Backend API listening on ${PORT}`);
