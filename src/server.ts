import express from 'express';
import { env } from './config/env.js';
import { loadStore } from './store/index.js';

const app = express();

app.get('/health', (req, res) => {
  const store = loadStore();
  res.json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    positionStatus: store.status,
  });
});

export function startHealthServer() {
  const port = env.PORT;
  app.listen(port, () => {
    console.log(`✓ Health server running on port ${port}`);
  });
}
