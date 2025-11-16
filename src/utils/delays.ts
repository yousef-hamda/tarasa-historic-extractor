export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const humanDelay = async (min = 2000, max = 6000) => {
  const duration = Math.floor(Math.random() * (max - min + 1)) + min;
  await delay(duration);
};
