import express from 'express';
import postsRouter from './routes/posts';
import logsRouter from './routes/logs';
import healthRouter from './routes/health';
import logger from './utils/logger';

const app = express();
app.use(express.json());
app.use(postsRouter);
app.use(logsRouter);
app.use(healthRouter);

const port = process.env.PORT || 4000;

app.listen(port, () => {
  logger.info(`API listening on port ${port}`);
});
