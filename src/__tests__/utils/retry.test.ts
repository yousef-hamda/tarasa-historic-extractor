import { retry } from '../../utils/retry';

describe('retry utility', () => {
  it('resolves on first attempt', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(retry(fn, 3, 10)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockResolvedValue('ok');

    await expect(retry(fn, 3, 10)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after exceeding attempts', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('nope'));
    await expect(retry(fn, 2, 5)).rejects.toThrow('nope');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
