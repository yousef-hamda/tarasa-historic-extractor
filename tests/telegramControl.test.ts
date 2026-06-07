import { describe, it, expect } from 'vitest';
import {
  parseCb,
  buildCb,
  MENUS,
  ACTIONS,
  ACTION_PARENT,
  esc,
  isAdminChat,
  type InlineButton,
} from '../src/utils/telegramControl';

// Collect every button across every menu, with the menu it lives in.
const allButtons = (): Array<{ menu: string; btn: InlineButton }> => {
  const out: Array<{ menu: string; btn: InlineButton }> = [];
  for (const [menu, def] of Object.entries(MENUS)) {
    for (const row of def.rows) {
      for (const btn of row) out.push({ menu, btn });
    }
  }
  return out;
};

describe('telegramControl — callback codec', () => {
  it('round-trips menu callbacks', () => {
    const data = buildCb('m', 'posts');
    expect(data).toBe('m:posts');
    expect(parseCb(data)).toEqual({ kind: 'm', key: 'posts' });
  });

  it('round-trips action callbacks without an arg', () => {
    const data = buildCb('a', 'run_scrape');
    expect(parseCb(data)).toEqual({ kind: 'a', key: 'run_scrape' });
  });

  it('round-trips action callbacks with an arg', () => {
    const data = buildCb('a', 'set_threshold', '80');
    expect(data).toBe('a:set_threshold~80');
    expect(parseCb(data)).toEqual({ kind: 'a', key: 'set_threshold', arg: '80' });
  });

  it('round-trips confirmed (x:) callbacks with an arg', () => {
    const data = buildCb('x', 'posts_delete', '123');
    expect(parseCb(data)).toEqual({ kind: 'x', key: 'posts_delete', arg: '123' });
  });

  it('treats noop specially', () => {
    expect(buildCb('noop')).toBe('noop');
    expect(parseCb('noop')).toEqual({ kind: 'noop', key: '' });
    expect(parseCb('')).toEqual({ kind: 'noop', key: '' });
  });

  it('keeps every generated callback within Telegram\'s 64-byte limit', () => {
    for (const { btn } of allButtons()) {
      if (btn.callback_data) {
        expect(btn.callback_data.length).toBeLessThanOrEqual(64);
      }
    }
  });
});

describe('telegramControl — catalog integrity', () => {
  it('has a main menu', () => {
    expect(MENUS.main).toBeDefined();
    expect(MENUS.main.rows.length).toBeGreaterThan(0);
  });

  it('every menu button is either a url, a valid menu link, or a valid action', () => {
    for (const { menu, btn } of allButtons()) {
      if (btn.url) continue;
      expect(btn.callback_data, `button "${btn.text}" in menu "${menu}" has no callback_data`).toBeTruthy();
      const parsed = parseCb(btn.callback_data!);
      if (parsed.kind === 'm') {
        expect(MENUS[parsed.key], `menu link "${parsed.key}" (button "${btn.text}" in "${menu}") points to a missing menu`).toBeDefined();
      } else if (parsed.kind === 'a') {
        expect(ACTIONS[parsed.key], `action "${parsed.key}" (button "${btn.text}" in "${menu}") is not registered`).toBeDefined();
      } else if (parsed.kind !== 'noop') {
        throw new Error(`Unexpected button kind "${parsed.kind}" in menu "${menu}"`);
      }
    }
  });

  it('every menu (except main) is reachable from some other menu', () => {
    const reachable = new Set<string>(['main']);
    for (const { btn } of allButtons()) {
      if (btn.callback_data) {
        const p = parseCb(btn.callback_data);
        if (p.kind === 'm') reachable.add(p.key);
      }
    }
    for (const key of Object.keys(MENUS)) {
      expect(reachable.has(key), `menu "${key}" is defined but unreachable`).toBe(true);
    }
  });

  it('every action has a parent menu that exists', () => {
    for (const actionKey of Object.keys(ACTIONS)) {
      const parent = ACTION_PARENT[actionKey];
      expect(parent, `action "${actionKey}" has no parent menu mapping`).toBeTruthy();
      expect(MENUS[parent], `action "${actionKey}" parent "${parent}" is not a real menu`).toBeDefined();
    }
  });
});

describe('telegramControl — safety gating', () => {
  it('all destructive/danger actions are admin-only AND require confirmation', () => {
    const mustGuard = ['danger_reset', 'danger_cleanup', 'msg_enable', 'sys_cb_reset', 'groups_reset_all', 'posts_email'];
    for (const key of mustGuard) {
      expect(ACTIONS[key], `${key} missing`).toBeDefined();
      expect(ACTIONS[key].admin, `${key} must be admin-only`).toBe(true);
      expect(ACTIONS[key].confirm, `${key} must require confirmation`).toBeTruthy();
    }
  });

  it('every trigger/run action is admin-only', () => {
    const runKeys = Object.keys(ACTIONS).filter((k) => k.startsWith('run_'));
    expect(runKeys.length).toBeGreaterThan(0);
    for (const k of runKeys) {
      expect(ACTIONS[k].admin, `${k} should be admin-only`).toBe(true);
    }
  });

  it('every mutating action (set_/groups_add/remove/reset, prompt_activate, delete) is admin-only', () => {
    const mutating = [
      'set_threshold', 'set_threshold_custom', 'set_speed', 'set_email',
      'groups_add', 'groups_remove', 'groups_reset_one', 'groups_reset_all',
      'prompt_activate', 'posts_delete', 'session_renew', 'session_upload', 'session_validate',
    ];
    for (const k of mutating) {
      expect(ACTIONS[k]?.admin, `${k} should be admin-only`).toBe(true);
    }
  });

  it('pure read actions are available to non-admins', () => {
    const reads = ['status_overview', 'posts_recent', 'msg_queue', 'groups_list', 'session_status', 'logs_recent', 'sys_health', 'settings_show'];
    for (const k of reads) {
      expect(ACTIONS[k]?.admin, `${k} should be a read (non-admin)`).toBe(false);
    }
  });
});

describe('telegramControl — helpers', () => {
  it('escapes HTML metacharacters', () => {
    expect(esc('<b>&"x"')).toBe('&lt;b&gt;&amp;&quot;x&quot;');
    expect(esc(null)).toBe('');
    expect(esc(123)).toBe('123');
  });

  it('isAdminChat matches the configured TELEGRAM_CHAT_ID', () => {
    // tests/setup.ts may or may not set TELEGRAM_CHAT_ID; assert the contract
    // holds either way without depending on a specific env value.
    const admin = process.env.TELEGRAM_CHAT_ID;
    if (admin) {
      expect(isAdminChat(admin)).toBe(true);
      expect(isAdminChat(`${admin}9999`)).toBe(false);
    } else {
      expect(isAdminChat('anything')).toBe(false);
    }
  });
});
