import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Telegram HTTP layer so we can assert what the bot would send without
// touching the network. The control module talks to Telegram exclusively via
// `axios.post(<api>/<method>, payload)`.
const post = vi.fn().mockResolvedValue({ data: { ok: true } });
const get = vi.fn().mockResolvedValue({ data: { ok: true } });
vi.mock('axios', () => ({
  default: { post, get, isAxiosError: () => false },
  isAxiosError: () => false,
}));

// A bot token must be present at import time, otherwise the API url is null and
// the module short-circuits every send. Set it before the dynamic import below.
process.env.TELEGRAM_BOT_TOKEN = 'test:token';
process.env.TELEGRAM_CHAT_ID = '999000999';

// Find the most recent call to a given Telegram method.
const lastCallTo = (method: string): any => {
  const calls = post.mock.calls.filter((c) => String(c[0]).endsWith(`/${method}`));
  return calls.length ? calls[calls.length - 1][1] : undefined;
};

describe('telegramControl — callback routing (mocked Telegram API)', () => {
  let mod: typeof import('../src/utils/telegramControl');

  beforeEach(async () => {
    post.mockClear();
    get.mockClear();
    mod = await import('../src/utils/telegramControl');
  });

  it('opening a menu edits the message with that menu\'s content', async () => {
    const cbq = {
      id: 'cb1',
      data: 'm:settings_speed',
      from: { id: 999000999 },
      message: { message_id: 42, chat: { id: 999000999 } },
    };
    await mod.handleControlCallback(cbq, true);

    // It should answer the callback and edit the message text.
    expect(lastCallTo('answerCallbackQuery')).toBeTruthy();
    const edit = lastCallTo('editMessageText');
    expect(edit).toBeTruthy();
    expect(edit.message_id).toBe(42);
    expect(String(edit.text)).toContain('speed preset');
  });

  it('blocks an admin-only action for a non-admin chat and starts no job', async () => {
    const cbq = {
      id: 'cb2',
      data: 'a:run_scrape',
      from: { id: 111 },
      message: { message_id: 7, chat: { id: 111 } },
    };
    await mod.handleControlCallback(cbq, false /* not admin */);

    const answer = lastCallTo('answerCallbackQuery');
    expect(answer).toBeTruthy();
    expect(String(answer.text)).toContain('Admin only');
    // No "started…" message and no editMessageText running the job.
    const sends = post.mock.calls.filter((c) => String(c[0]).endsWith('/sendMessage'));
    expect(sends.some((c) => String(c[1].text).includes('started'))).toBe(false);
  });

  it('a confirm-gated action shows a Confirm button instead of executing', async () => {
    const cbq = {
      id: 'cb3',
      data: 'a:danger_reset',
      from: { id: 999000999 },
      message: { message_id: 8, chat: { id: 999000999 } },
    };
    await mod.handleControlCallback(cbq, true);

    const edit = lastCallTo('editMessageText');
    expect(edit).toBeTruthy();
    // The confirm screen must offer an execute (x:) button.
    const buttons = edit.reply_markup.inline_keyboard.flat();
    expect(buttons.some((b: any) => b.callback_data === 'x:danger_reset')).toBe(true);
  });

  it('/menu via tryHandleControlMessage sends the main catalog', async () => {
    const handled = await mod.tryHandleControlMessage('999000999', '/menu', true, 1);
    expect(handled).toBe(true);
    const send = lastCallTo('sendMessage');
    expect(String(send.text)).toContain('Control Panel');
    expect(send.reply_markup.inline_keyboard.length).toBeGreaterThan(3);
  });

  it('a normal chat message is NOT consumed (falls through to AI chat)', async () => {
    const handled = await mod.tryHandleControlMessage('999000999', 'how are we doing today?', true);
    expect(handled).toBe(false);
  });
});
