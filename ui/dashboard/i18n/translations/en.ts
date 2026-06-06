// Translation typing.
//
// `en` is the source of truth and carries EVERY key. `he`/`ar` may omit keys —
// the `t()` helper falls back to English at runtime (see LanguageContext), so a
// not-yet-translated key renders real English text rather than a raw "a.b.c"
// path. To support that, sections are loosely typed (`{ [k: string]: string }`)
// so we can add UI strings to `en` without having to thread the exact same key
// list through the interface and all three language files.
export type TranslationSection = { [key: string]: string };
export type TranslationSchema = { [section: string]: TranslationSection };

// Documents the original (core) key set for reference; not enforced.
export interface TranslationSchemaShape {
  common: {
    loading: string;
    error: string;
    success: string;
    save: string;
    cancel: string;
    delete: string;
    edit: string;
    view: string;
    search: string;
    filter: string;
    refresh: string;
    export: string;
    import: string;
    back: string;
    next: string;
    previous: string;
    close: string;
    confirm: string;
    yes: string;
    no: string;
    all: string;
    none: string;
    unknown: string;
    notAvailable: string;
    copyText: string;
    copied: string;
    continueToTarasa: string;
    tryAgain: string;
  };
  nav: {
    dashboard: string;
    posts: string;
    search: string;
    messages: string;
    groups: string;
    logs: string;
    admin: string;
    debug: string;
    backup: string;
    settings: string;
    prompts: string;
  };
  dashboard: {
    title: string;
    subtitle: string;
    totalPosts: string;
    classifiedPosts: string;
    historicPosts: string;
    messagesSent: string;
    pendingMessages: string;
    systemHealth: string;
    healthy: string;
    degraded: string;
    unhealthy: string;
    recentActivity: string;
    activityChart: string;
    classificationDistribution: string;
    confidenceDistribution: string;
  };
  posts: {
    title: string;
    subtitle: string;
    totalPosts: string;
    filtered: string;
    onThisPage: string;
    historicPosts: string;
    withProfileLink: string;
    aiClassified: string;
    searchPlaceholder: string;
    allPosts: string;
    historicOnly: string;
    notHistoric: string;
    unclassified: string;
    withLink: string;
    author: string;
    postPreview: string;
    classification: string;
    confidence: string;
    scraped: string;
    actions: string;
    historic: string;
    pending: string;
    noPostsMatch: string;
    noPostsFound: string;
    adjustFilters: string;
    viewOnFacebook: string;
    exportToCsv: string;
    exportToExcel: string;
  };
  messages: {
    title: string;
    subtitle: string;
    pendingMessages: string;
    sentMessages: string;
    errorMessages: string;
    messagingStatus: string;
    enabled: string;
    disabled: string;
    toggleMessaging: string;
    retryFailed: string;
    clearQueue: string;
  };
  groups: {
    title: string;
    subtitle: string;
    addGroup: string;
    groupId: string;
    groupName: string;
    groupType: string;
    public: string;
    private: string;
    accessMethod: string;
    lastScraped: string;
    status: string;
    accessible: string;
    notAccessible: string;
    resetCache: string;
    removeGroup: string;
  };
  logs: {
    title: string;
    subtitle: string;
    type: string;
    message: string;
    timestamp: string;
    scrape: string;
    classify: string;
    messageLog: string;
    auth: string;
    error: string;
    admin: string;
    filterByType: string;
  };
  admin: {
    title: string;
    subtitle: string;
    systemStatus: string;
    manualTriggers: string;
    triggerScrape: string;
    triggerClassification: string;
    triggerMessages: string;
    scraping: string;
    classifying: string;
    sending: string;
    systemFlow: string;
  };
  settings: {
    title: string;
    subtitle: string;
    facebookGroups: string;
    messageLimits: string;
    maximumPerDay: string;
    rateLimited: string;
    tarasaUrl: string;
    configured: string;
    emailAlerts: string;
    notConfigured: string;
    facebookSession: string;
    sessionStatus: string;
    active: string;
    expired: string;
    renewSession: string;
    renewingSession: string;
    dangerZone: string;
    resetAllData: string;
    resetWarning: string;
    typeToConfirm: string;
    deleteEverything: string;
    language: string;
    selectLanguage: string;
  };
  prompts: {
    title: string;
    subtitle: string;
    classifierPrompt: string;
    generatorPrompt: string;
    currentPrompt: string;
    editPrompt: string;
    promptHistory: string;
    version: string;
    createdAt: string;
    preview: string;
    testPrompt: string;
    savePrompt: string;
    revertToDefault: string;
    previewResults: string;
    testWithSample: string;
  };
  submit: {
    title: string;
    subtitle: string;
    almostDone: string;
    instructions: string;
    instructionsHe: string;
    yourText: string;
    by: string;
    steps: string;
    step1: string;
    step2: string;
    step3: string;
    step4: string;
    viewOriginalPost: string;
    footer: string;
    errorOccurred: string;
    postNotFound: string;
    redirecting: string;
  };
  search: {
    advancedSearch: string;
    searchByAuthor: string;
    searchByText: string;
    dateRange: string;
    fromDate: string;
    toDate: string;
    selectGroup: string;
    allGroups: string;
    classificationStatus: string;
    qualityRating: string;
    minRating: string;
    applyFilters: string;
    clearFilters: string;
    results: string;
    noResults: string;
  };
  quality: {
    rating: string;
    excellent: string;
    good: string;
    average: string;
    belowAverage: string;
    poor: string;
    notRated: string;
    rateStory: string;
    factors: string;
    narrative: string;
    emotional: string;
    historical: string;
    uniqueness: string;
  };
  duplicates: {
    title: string;
    subtitle: string;
    potential: string;
    similarity: string;
    primary: string;
    duplicate: string;
    markAsDuplicate: string;
    dismiss: string;
    merge: string;
    reviewed: string;
  };
  reports: {
    title: string;
    subtitle: string;
    weeklyReport: string;
    emailRecipients: string;
    addRecipient: string;
    reportFrequency: string;
    daily: string;
    weekly: string;
    monthly: string;
    lastSent: string;
    sendNow: string;
    reportHistory: string;
  };
  abTesting: {
    title: string;
    subtitle: string;
    variants: string;
    createVariant: string;
    variantName: string;
    promptTemplate: string;
    weight: string;
    metrics: string;
    totalSent: string;
    responses: string;
    clicks: string;
    responseRate: string;
    clickRate: string;
  };
}

export const en: TranslationSchema = {
  common: {
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    view: 'View',
    search: 'Search',
    filter: 'Filter',
    refresh: 'Refresh',
    export: 'Export',
    import: 'Import',
    back: 'Back',
    next: 'Next',
    previous: 'Previous',
    close: 'Close',
    confirm: 'Confirm',
    yes: 'Yes',
    no: 'No',
    all: 'All',
    none: 'None',
    unknown: 'Unknown',
    notAvailable: 'N/A',
    copyText: 'Copy Text',
    copied: 'Copied!',
    continueToTarasa: 'Continue to Tarasa',
    tryAgain: 'Try Again',
  },
  nav: {
    dashboard: 'Dashboard',
    posts: 'Posts',
    search: 'Search',
    messages: 'Messages',
    groups: 'Groups',
    logs: 'Logs',
    admin: 'Admin',
    debug: 'Debug',
    backup: 'Backup',
    settings: 'Settings',
    prompts: 'Prompts',
  },
  dashboard: {
    title: 'Dashboard',
    subtitle: 'System overview and statistics',
    totalPosts: 'Total Posts',
    classifiedPosts: 'Classified Posts',
    historicPosts: 'Historic Posts',
    messagesSent: 'Messages Sent',
    pendingMessages: 'Pending Messages',
    systemHealth: 'System Health',
    healthy: 'Healthy',
    degraded: 'Degraded',
    unhealthy: 'Unhealthy',
    recentActivity: 'Recent Activity',
    activityChart: 'Activity Over Time',
    classificationDistribution: 'Classification Distribution',
    confidenceDistribution: 'Confidence Distribution',
  },
  posts: {
    title: 'Posts',
    subtitle: 'Manage and analyze collected posts',
    totalPosts: 'total posts',
    filtered: 'filtered',
    onThisPage: 'On This Page',
    historicPosts: 'Historic Posts',
    withProfileLink: 'With Profile Link',
    aiClassified: 'AI Classified',
    searchPlaceholder: 'Search posts by text, author, or group...',
    allPosts: 'All Posts',
    historicOnly: 'Historic Only',
    notHistoric: 'Not Historic',
    unclassified: 'Unclassified',
    withLink: 'With Profile Link',
    author: 'Author',
    postPreview: 'Post Preview',
    classification: 'Classification',
    confidence: 'Confidence',
    scraped: 'Scraped',
    actions: 'Actions',
    historic: 'Historic',
    pending: 'Pending',
    noPostsMatch: 'No posts match your criteria',
    noPostsFound: 'No posts found',
    adjustFilters: 'Try adjusting your search or filter settings',
    viewOnFacebook: 'View on Facebook',
    exportToCsv: 'Export to CSV',
    exportToExcel: 'Export to Excel',
  },
  messages: {
    title: 'Messages',
    subtitle: 'Message queue and history',
    pendingMessages: 'Pending Messages',
    sentMessages: 'Sent Messages',
    errorMessages: 'Failed Messages',
    messagingStatus: 'Messaging Status',
    enabled: 'Enabled',
    disabled: 'Disabled',
    toggleMessaging: 'Toggle Messaging',
    retryFailed: 'Retry Failed',
    clearQueue: 'Clear Queue',
  },
  groups: {
    title: 'Groups',
    subtitle: 'Manage Facebook groups',
    addGroup: 'Add Group',
    groupId: 'Group ID',
    groupName: 'Group Name',
    groupType: 'Group Type',
    public: 'Public',
    private: 'Private',
    accessMethod: 'Access Method',
    lastScraped: 'Last Scraped',
    status: 'Status',
    accessible: 'Accessible',
    notAccessible: 'Not Accessible',
    resetCache: 'Reset Cache',
    removeGroup: 'Remove Group',
  },
  logs: {
    title: 'System Logs',
    subtitle: 'View system activity logs',
    type: 'Type',
    message: 'Message',
    timestamp: 'Timestamp',
    scrape: 'Scrape',
    classify: 'Classify',
    messageLog: 'Message',
    auth: 'Auth',
    error: 'Error',
    admin: 'Admin',
    filterByType: 'Filter by type',
  },
  admin: {
    title: 'Admin',
    subtitle: 'System administration',
    systemStatus: 'System Status',
    manualTriggers: 'Manual Triggers',
    triggerScrape: 'Trigger Scrape',
    triggerClassification: 'Trigger Classification',
    triggerMessages: 'Trigger Messages',
    scraping: 'Scraping...',
    classifying: 'Classifying...',
    sending: 'Sending...',
    systemFlow: 'System Flow',
  },
  settings: {
    title: 'Settings',
    subtitle: 'Configure your system preferences',
    facebookGroups: 'Facebook Groups',
    messageLimits: 'Message Limits',
    maximumPerDay: 'Maximum per day',
    rateLimited: 'Rate-limited to prevent account restrictions',
    tarasaUrl: 'Tarasa URL',
    configured: 'Configured',
    emailAlerts: 'Email Alerts',
    notConfigured: 'Not Configured',
    facebookSession: 'Facebook Session',
    sessionStatus: 'Session Status',
    active: 'Active',
    expired: 'Expired',
    renewSession: 'Renew Session',
    renewingSession: 'Renewing Session...',
    dangerZone: 'Danger Zone',
    resetAllData: 'Reset All Data',
    resetWarning: 'This will permanently delete all scraped posts, AI classifications, generated messages, sent messages, and system logs. This action cannot be undone.',
    typeToConfirm: 'Type "DELETE ALL DATA" to confirm:',
    deleteEverything: 'Yes, Delete Everything',
    language: 'Language',
    selectLanguage: 'Select Language',
  },
  prompts: {
    title: 'AI Prompts',
    subtitle: 'Customize AI classification and message generation prompts',
    classifierPrompt: 'Classifier Prompt',
    generatorPrompt: 'Generator Prompt',
    currentPrompt: 'Current Prompt',
    editPrompt: 'Edit Prompt',
    promptHistory: 'Prompt History',
    version: 'Version',
    createdAt: 'Created At',
    preview: 'Preview',
    testPrompt: 'Test Prompt',
    savePrompt: 'Save Prompt',
    revertToDefault: 'Revert to Default',
    previewResults: 'Preview Results',
    testWithSample: 'Test with sample post',
  },
  submit: {
    title: 'Share Your Memory',
    subtitle: 'Preserving Community History',
    almostDone: 'Almost Done!',
    instructions: 'Your text is ready for submission. Click "Copy Text" then "Continue to Tarasa". On the site, paste the text in the memory field and check "I agree".',
    instructionsHe: 'הטקסט שלך מוכן להעלאה. לחצו על "העתק טקסט" ואז על "המשך לטרסה". באתר, הדביקו את הטקסט בשדה הזיכרון וסמנו "אני מאשר/ת".',
    yourText: 'Your Text',
    by: 'By',
    steps: 'Steps',
    step1: 'Click "Copy Text" above',
    step2: 'Click "Continue to Tarasa"',
    step3: 'On Tarasa - paste the text (Ctrl+V / Cmd+V)',
    step4: 'Check "I agree" and click "Submit"',
    viewOriginalPost: 'View original Facebook post',
    footer: 'Tarasa Platform - Preserving community history for future generations',
    errorOccurred: 'Error',
    postNotFound: 'Post not found',
    redirecting: 'Redirecting to Tarasa...',
  },
  search: {
    advancedSearch: 'Advanced Search',
    searchByAuthor: 'Search by author',
    searchByText: 'Search by text',
    dateRange: 'Date Range',
    fromDate: 'From Date',
    toDate: 'To Date',
    selectGroup: 'Select Group',
    allGroups: 'All Groups',
    classificationStatus: 'Classification Status',
    qualityRating: 'Quality Rating',
    minRating: 'Minimum Rating',
    applyFilters: 'Apply Filters',
    clearFilters: 'Clear Filters',
    results: 'Results',
    noResults: 'No results found',
  },
  quality: {
    rating: 'Quality Rating',
    excellent: 'Excellent',
    good: 'Good',
    average: 'Average',
    belowAverage: 'Below Average',
    poor: 'Poor',
    notRated: 'Not Rated',
    rateStory: 'Rate Story',
    factors: 'Rating Factors',
    narrative: 'Narrative Quality',
    emotional: 'Emotional Impact',
    historical: 'Historical Value',
    uniqueness: 'Uniqueness',
  },
  duplicates: {
    title: 'Duplicate Detection',
    subtitle: 'Review potential duplicate stories',
    potential: 'Potential Duplicates',
    similarity: 'Similarity',
    primary: 'Primary Post',
    duplicate: 'Duplicate',
    markAsDuplicate: 'Mark as Duplicate',
    dismiss: 'Dismiss',
    merge: 'Merge',
    reviewed: 'Reviewed',
  },
  reports: {
    title: 'Reports',
    subtitle: 'Automated reporting configuration',
    weeklyReport: 'Weekly Report',
    emailRecipients: 'Email Recipients',
    addRecipient: 'Add Recipient',
    reportFrequency: 'Report Frequency',
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    lastSent: 'Last Sent',
    sendNow: 'Send Now',
    reportHistory: 'Report History',
  },
  abTesting: {
    title: 'A/B Testing',
    subtitle: 'Message variant testing',
    variants: 'Variants',
    createVariant: 'Create Variant',
    variantName: 'Variant Name',
    promptTemplate: 'Prompt Template',
    weight: 'Weight',
    metrics: 'Metrics',
    totalSent: 'Total Sent',
    responses: 'Responses',
    clicks: 'Clicks',
    responseRate: 'Response Rate',
    clickRate: 'Click Rate',
  },
  // Cross-page UI strings wired in this pass. `en` is exhaustive; he/ar fall
  // back to these English values for any key they don't translate.
  ui: {
    // generic
    retry: 'Retry',
    retryNow: 'Retry now',
    updated: 'Updated',
    never: 'Never',
    lastRefreshed: 'Last refreshed',
    connectionError: 'Connection Error',
    transientHint: 'Usually transient — most often happens during a Railway redeploy. The page will auto-retry.',
    status: 'Status',
    sentAt: 'Sent At',
    created: 'Created',
    profile: 'Profile',
    openChat: 'Open chat',
    viewPost: 'View post',
    apiKeyNeeded: 'API Key needed',
    // dashboard
    dashboardSubtitle: 'Overview of your automation system',
    postsScraped: 'Posts Scraped',
    totalCollected: 'Total collected',
    aiClassified: 'AI Classified',
    complete: 'complete',
    historicPosts: 'Historic Posts',
    ofClassified: 'of classified',
    inQueue: 'In Queue',
    awaitingDispatch: 'Awaiting dispatch',
    activityOverview: 'Activity Overview',
    last7Days: 'Last 7 days',
    classificationResults: 'Classification Results',
    confidenceDistribution: 'Confidence Distribution',
    dailyQuota: 'Daily quota',
    sentToday: 'Sent today',
    remaining: 'Remaining',
    database: 'Database',
    facebookSession: 'Facebook Session',
    openaiApi: 'OpenAI API',
    apifyToken: 'Apify Token',
    uptime: 'Uptime',
    lastScrape: 'Last scrape',
    lastMessage: 'Last message',
    adminLink: 'Admin',
    logsLink: 'Logs',
    viewAllErrors: 'View all errors',
    recentErrors: 'Recent Errors',
    recentActivity: 'Recent Activity',
    systemHealth: 'System Health',
    messages: 'Messages',
    // posts
    postsSubtitle: 'Manage and analyze collected posts',
    totalPosts: 'total posts',
    filtered: 'filtered',
    onThisPage: 'On This Page',
    withProfileLink: 'With Profile Link',
    searchPostsPlaceholder: 'Search posts by text, author, or group...',
    allPosts: 'All Posts',
    historicAboveThreshold: 'Historic (above threshold)',
    belowThresholdFilter: 'Below Threshold',
    notHistoricFilter: 'Not Historic',
    unclassified: 'Unclassified',
    withProfileLinkFilter: 'With Profile Link',
    postPreview: 'Post Preview',
    classification: 'Classification',
    confidence: 'Confidence',
    scraped: 'Scraped',
    actions: 'Actions',
    view: 'View',
    historic: 'Historic',
    pending: 'Pending',
    belowThreshold: 'Below threshold',
    notHistoric: 'Not Historic',
    noPostsMatch: 'No posts match your criteria',
    noPostsFound: 'No posts found',
    adjustFilters: 'Try adjusting your search or filter settings',
    openOnFacebook: 'Open on Facebook',
    deletePost: 'Delete this post',
    threshold: 'Threshold',
    // messages
    messagesSubtitle: 'Manage queue and monitor delivery',
    messagingOn: 'Messaging ON',
    messagingOff: 'Messaging OFF',
    queueSize: 'Queue Size',
    sent24h: 'Sent (24h)',
    successful: 'Successful',
    failed: 'Failed',
    messageQueue: 'Message Queue',
    sentHistory: 'Sent History',
    messagesWaiting: 'messages waiting',
    messagesSentCount: 'messages sent',
    queueEmpty: 'Queue is empty',
    noQueueSub: 'No messages waiting to be sent',
    noSentYet: 'No messages sent yet',
    noSentSub: 'Sent messages will appear here',
    author: 'Author',
    messageColumn: 'Message',
    postColumn: 'Post',
    chatProfile: 'Chat / Profile',
    errorColumn: 'Error',
    pausedTitle: 'Messaging is Paused (safe default)',
    pausedBody: 'Messages are queued but NOT sent. Click the green button above to turn dispatching on — it’s off by default so messages can’t go out by accident.',
    last24Hours: 'Last 24 hours',
    deliveredSuccessfully: 'Delivered successfully',
    deliveryFailed: 'Delivery failed',
    sendsNextCycle: 'Sends in next 5-min cycle',
    pausedToggle: 'Paused — toggle ON to dispatch',
    noMessageText: 'No message text stored',
    // groups
    groupsSubtitle: 'Manage Facebook groups',
    total: 'total',
    resetAll: 'Reset All',
    refreshing: 'Refreshing…',
    addNewGroup: 'Add New Group',
    addGroupSub: 'Paste a Facebook group URL to start tracking',
    addGroup: 'Add Group',
    adding: 'Adding...',
    configuredGroups: 'Configured Groups',
    searchGroupsPlaceholder: 'Search groups...',
    totalGroups: 'Total Groups',
    accessible: 'Accessible',
    publicGroups: 'Public Groups',
    privateGroups: 'Private Groups',
    successRate: 'success rate',
    noGroupsConfigured: 'No groups configured',
    noGroupsMatch: 'No groups match your search',
    addToStart: 'Add a group above to get started',
    tryDifferent: 'Try a different search term',
    members: 'members',
    lastScrapedColon: 'Last scraped:',
    openInFacebook: 'Open in Facebook',
    resetDetection: 'Reset detection cache',
    removeGroup: 'Remove group',
    pendingBadge: 'Pending',
    inaccessible: 'Inaccessible',
    publicBadge: 'Public',
    privateBadge: 'Private',
    unknownBadge: 'Unknown',
    // logs
    logsSubtitle: 'Monitor system activity and events',
    totalEntries: 'total entries',
    errors: 'Errors',
    scrapes: 'Scrapes',
    auth: 'Auth',
    searchLogsPlaceholder: 'Search logs by message or type...',
    allTypes: 'All Types',
    type: 'Type',
    message: 'Message',
    timestamp: 'Timestamp',
    noLogsMatch: 'No logs match your criteria',
    noLogsFound: 'No logs found',
    couldntLoadLogs: 'Couldn’t load logs',
    // admin
    adminDashboard: 'Admin Dashboard',
    controlCenter: 'System management and control center',
    postsToday: 'Posts Today',
    messagesSentStat: 'Messages Sent',
    systemPipeline: 'System Pipeline',
    systemInfo: 'System Info',
    facebookGroups: 'Facebook Groups',
    systemInformation: 'System Information',
    emailApprovedPosts: 'Email approved posts',
    emailApprovedSub: 'Sends an HTML table + CSV attachment of every post above the current threshold to the admin email saved in Settings.',
    quotaToday: 'Quota Today',
    // settings
    settingsSubtitle: 'Configure your system preferences',
    messageLimits: 'Message Limits',
    maximumPerDay: 'Maximum per day',
    rateLimited: 'Rate-limited to prevent account restrictions',
    tarasaUrl: 'Tarasa URL',
    configured: 'Configured',
    emailAlerts: 'Email Alerts',
    notConfigured: 'Not Configured',
    dashboardApiKey: 'Dashboard API Key',
    apiKeyHelp: 'Authenticates your dashboard with the backend. Stored locally in your browser only — never sent anywhere except this app’s API.',
    saveApiKey: 'Save API Key',
    clear: 'Clear',
    resetOpenaiBreaker: 'Reset OpenAI Breaker',
    classificationThreshold: 'Classification Threshold',
    thresholdCardSub: 'Minimum confidence for a post to be treated as historic',
    systemSpeed: 'System Speed',
    systemSpeedSub: 'How often the scrape, classify, and message crons run',
    facebookSessionCard: 'Facebook Session',
    manageAuth: 'Manage your Facebook authentication',
    sessionStatus: 'Session Status',
    active: 'Active',
    expired: 'Expired',
    sessionDetails: 'Session Details',
    userId: 'User ID',
    lastChecked: 'Last Checked',
    accessibleVal: 'Accessible',
    limitedVal: 'Limited',
    renewSession: 'Renew Session',
    renewing: 'Logging in… (checking every 3 s)',
    dangerZone: 'Danger Zone',
    dangerSub: 'Irreversible actions - proceed with caution',
    cleanPhantomPosts: 'Clean Phantom Posts',
    cleanPhantomSub: 'Removes posts that the current scraper filter would reject (operator-self chrome, group rules, no-author rows).',
    runPhantomCleanup: 'Run phantom cleanup',
    resetAllData: 'Reset All Data',
    language: 'Language',
    languageSub: 'Dashboard display language (English / עברית / العربية)',
    // prompts
    promptsSubtitle: 'Customize AI classification and message generation prompts',
    classifierPrompt: 'Classifier Prompt',
    generatorPrompt: 'Generator Prompt',
    currentPrompt: 'Current Prompt',
    editPrompt: 'Edit Prompt',
    revertToDefault: 'Revert to Default',
    versionNameOptional: 'Version Name (optional)',
    promptContent: 'Prompt Content',
    saveAndActivate: 'Save & Activate',
    saveAsDraft: 'Save as Draft',
    testPrompt: 'Test Prompt',
    samplePostText: 'Sample Post Text',
    authorNameLabel: 'Author Name',
    testWithSample: 'Test with sample',
    testing: 'Testing...',
    previewResults: 'Preview Results',
    historicLabel: 'Historic',
    confidenceLabel: 'Confidence',
    reasonLabel: 'Reason',
    generatedMessageLabel: 'Generated Message',
    promptHistory: 'Prompt History',
    noHistory: 'No prompt history yet',
    activate: 'Activate',
    copy: 'Copy',
    tokens: 'Tokens',
    // debug
    debugConsole: 'Debug Console',
    debugSubtitle: 'Real-time monitoring and diagnostics',
    autoRefresh: 'Auto-refresh',
    overviewTab: 'Overview',
    requestsTab: 'Requests',
    errorsTab: 'Errors',
    selfHealingTab: 'Self-Healing',
    diagnosticsTab: 'Diagnostics',
    cpuUsage: 'CPU Usage',
    memoryUsed: 'Memory Used',
    eventLoop: 'Event Loop',
    systemResources: 'System Resources',
    requestStatistics: 'Request Statistics',
    totalRequests: 'Total Requests',
    requestsPerMin: 'Requests/min',
    avgResponse: 'Avg Response',
    errorRate: 'Error Rate',
    quickActions: 'Quick Actions',
    triggerGC: 'Trigger GC',
    runHealingChecks: 'Run Healing Checks',
    runFullDiagnostics: 'Run Full Diagnostics',
    runningTests: 'Running Tests...',
    noDiagnostics: 'No Diagnostics Run Yet',
    circuitBreakers: 'Circuit Breakers',
    recentHealingActions: 'Recent Healing Actions',
    method: 'Method',
    path: 'Path',
    duration: 'Duration',
    noRequests: 'No requests logged yet',
    noUnresolvedErrors: 'No Unresolved Errors',
    allSmooth: 'All systems running smoothly',
    resolve: 'Resolve',
    // login gate
    siteLocked: 'Enter password to continue',
    passwordPlaceholder: 'Password',
    unlock: 'Unlock',
    incorrectPassword: 'Incorrect password.',
  },
};

export type TranslationKeys = TranslationSchema;
