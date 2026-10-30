// index.js — Folkstyle Arena entry point.
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const { server } = createApp();
server.listen(port, () => {
  console.log(`Folkstyle Arena on http://localhost:${port} (USE_REAL_META_AI=${process.env.USE_REAL_META_AI || 'false'})`);
});
