import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
const config = loadConfig();
const server = createApp(config.origin).listen(config.port, () => {
  console.log(`TED Intake listening on http://localhost:${config.port}`);
});
function shutdown() {
  server.close((error) => {
    process.exitCode = error ? 1 : 0;
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
