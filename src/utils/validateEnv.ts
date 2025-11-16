const requiredKeys = ['FB_EMAIL', 'FB_PASSWORD', 'OPENAI_API_KEY', 'POSTGRES_URL'];

export const validateEnv = () => {
  const missing = requiredKeys.filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (!process.env.GROUP_IDS || !process.env.GROUP_IDS.trim()) {
    // eslint-disable-next-line no-console
    console.warn('Warning: GROUP_IDS is empty. Scraper will not run without configured groups.');
  }
};
