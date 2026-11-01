import { loadConfig } from './config.ts';
import { createApp } from './app.ts';

const cfg = loadConfig();
const app = createApp(cfg);
app.server.listen(cfg.port, cfg.host, () => {
  console.log(`FlowProof em http://${cfg.host}:${cfg.port} (${cfg.production ? 'produção' : 'desenvolvimento'})`);
  console.log(`Banco: ${cfg.dbPath}`);
});

const shutdown = (): void => {
  void app.close().then(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
