// API Response Types for Tarasa Dashboard

export interface PostClassification {
  id: number;
  postId: number;
  isHistoric: boolean;
  confidence: number;
  reason: string;
  classifiedAt: string;
}

export interface Post {
  id: number;
  groupId: string;
  fbPostId: string;
  authorName?: string;
  authorLink?: string;
  authorPhoto?: string;
  text: string;
  scrapedAt: string;
  classified?: PostClassification;
}

export interface QueuedMessage {
  id: number;
  postId: number;
  messageText: string;
  link: string;
  createdAt: string;
  post?: Post;
}

export interface SentMessage {
  id: number;
  postId: number;
  authorLink: string;
  status: 'pending' | 'sent' | 'error';
  sentAt: string;
  error?: string;
  post?: Post;
}

export interface SystemLog {
  id: number;
  type: 'scrape' | 'classify' | 'message' | 'auth' | 'error';
  message: string;
  createdAt: string;
}

export interface Stats {
  postsTotal: number;
  classifiedTotal: number;
  historicTotal: number;
  queueCount: number;
  sentLast24h: number;
  quotaRemaining: number;
  messageLimit: number;
  logsCount: number;
  lastScrapeAt: string | null;
  lastMessageSentAt: string | null;
}

export interface HealthChecks {
  database: boolean;
  facebookSession: boolean;
  openaiKey: boolean;
  apifyToken: boolean;
}

export interface SessionInfo {
  status: string;
  userId: string | null;
  userName: string | null;
  lastChecked: string;
  canAccessPrivateGroups: boolean;
}

export interface GroupsSummary {
  total: number;
  public: number;
  private: number;
  accessible: number;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: HealthChecks;
  session: SessionInfo;
  groups: GroupsSummary;
  uptime: number;
}

export interface SessionHealth {
  status: 'valid' | 'expired' | 'invalid' | 'refreshing' | 'blocked' | 'unknown';
  lastChecked: string;
  lastValid: string | null;
  expiresAt: string | null;
  errorMessage: string | null;
}

export interface SessionStatus {
  loggedIn: boolean;
  userId: string | null;
  userName: string | null;
  status: string;
  lastChecked: string;
  canAccessPrivateGroups: boolean;
  requiresAction: boolean;
  sessionHealth: SessionHealth;
}

export interface GroupInfo {
  groupId: string;
  groupType: 'public' | 'private' | 'unknown';
  groupName?: string;
  accessMethod: 'mbasic' | 'apify' | 'playwright' | 'none';
  isAccessible: boolean;
  lastScraped: string | null;
  errorMessage?: string;
}

export interface GroupsResponse {
  groups: GroupInfo[];
  summary: {
    total: number;
    public: number;
    private: number;
    accessible: number;
    inaccessible: number;
  };
  capabilities: {
    sessionValid: boolean;
    apifyConfigured: boolean;
    canScrapePublic: boolean;
    canScrapePrivate: boolean;
  };
}

export interface Settings {
  groups: string[];
  messageLimit: number;
  baseTarasaUrl: string;
  emailConfigured: boolean;
  apifyConfigured?: boolean;
}

export interface PaginationInfo {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface TriggerResult {
  status: 'completed' | 'error';
  message?: string;
}

export type StatusType = 'ok' | 'degraded' | 'unhealthy' | 'valid' | 'invalid' | 'expired' | 'pending' | 'sent' | 'error';
