export interface PostRawWithClassification {
  id: number;
  groupId: string;
  fbPostId: string;
  authorName: string | null;
  authorLink: string | null;
  text: string;
  scrapedAt: Date;
  classified: {
    id: number;
    isHistoric: boolean;
    confidence: number;
    reason: string;
    classifiedAt: Date;
  } | null;
}

export interface SystemLogEntry {
  id: number;
  type: string;
  message: string;
  createdAt: Date;
}

export interface MessageQueueItem {
  id: number;
  postId: number;
  messageText: string;
  link: string;
  createdAt: Date;
  post: {
    id: number;
    authorName: string | null;
    text: string;
  };
}

export interface MessageSentRecord {
  id: number;
  postId: number;
  authorLink: string;
  status: string;
  sentAt: Date;
  error: string | null;
  post: {
    id: number;
    authorName: string | null;
  };
}

export interface DailyMessageUsage {
  limit: number;
  sentLast24h: number;
  remaining: number;
}

export interface SystemStats {
  postsTotal: number;
  classifiedTotal: number;
  historicTotal: number;
  queueCount: number;
  sentLast24h: number;
  quotaRemaining: number;
  messageLimit: number;
  logsCount: number;
  lastScrapeAt: Date | null;
  lastMessageSentAt: Date | null;
}
