import express from 'express';
import cors from 'cors';
import postsRouter from './routes/posts';
import logsRouter from './routes/logs';
import messagesRouter from './routes/messages';
import healthRouter from './routes/health';
import logger from './utils/logger';
import './cron';
import { errorHandler } from './middleware/errorHandler';

const app = express();
app.use(cors());
app.use(express.json());
app.use(postsRouter);
app.use(messagesRouter);
app.use(logsRouter);
app.use(healthRouter);
app.use(errorHandler);

const port = process.env.PORT || 4000;

app.listen(port, () => {
  logger.info(`API listening on port ${port}`);
});
