import type { BrowserContext } from 'playwright';
import type { CompatiblePlaywrightPlugin } from 'playwright-extra/dist/types';

const applyStealthScripts = async (context: BrowserContext) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // Add a basic chrome runtime stub
    // @ts-expect-error chrome is not part of Navigator in TS lib
    if (!window.chrome) {
      // @ts-expect-error chrome is not part of Navigator in TS lib
      window.chrome = { runtime: {} };
    }

    // Mock permissions query to avoid webdriver hints
    const permissions = window.navigator.permissions;
    const originalQuery = permissions?.query?.bind(permissions);
    if (originalQuery && permissions) {
      permissions.query = ((parameters: PermissionDescriptor) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission } as PermissionStatus);
        }
        return originalQuery(parameters);
      }) as typeof permissions.query;
    }

    // Reduce chance of detection via plugins length
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });

    // Spoof languages if missing
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
  });
};

const stealthPlugin: CompatiblePlaywrightPlugin = {
  name: 'local-stealth',
  _isPlaywrightExtraPlugin: true,
  async onContextCreated(context) {
    await applyStealthScripts(context);
  },
};

export default stealthPlugin;
