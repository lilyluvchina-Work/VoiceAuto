import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createPool } from './db.js';

const port = Number(process.env.PORT || 3000);
const pool = createPool();
const app = createApp({ pool });
const server = createServer(app);

server.listen(port, '0.0.0.0', () => {
  console.log(`VoiceAuto server listening on ${port}`);
});

process.on('SIGTERM', async () => {
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
});
