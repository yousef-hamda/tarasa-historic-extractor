import winston from 'winston';
import path from 'path';
import fs from 'fs';

const LOG_DIR = process.env.LOG_DIR || 'logs';
const isProduction = process.env.NODE_ENV === 'production';

// Ensure log directory exists
const ensureLogDir = (): void => {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch (error) {
    console.error(`Failed to create log directory ${LOG_DIR}: ${(error as Error).message}`);
  }
};

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf(
    (info: winston.Logform.TransformableInfo) => `${info.timestamp} [${info.level}] ${info.message}`
  )
);

// JSON format for production file logs
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: consoleFormat,
  }),
];

// Add file transports in production
if (isProduction) {
  // Ensure log directory exists before creating file transports
  ensureLogDir();

  // Combined log - all levels
  transports.push(
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    })
  );

  // Error log - errors only
  transports.push(
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    })
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports,
});

export default logger;
