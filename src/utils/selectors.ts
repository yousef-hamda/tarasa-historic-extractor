export const selectors = {
  loginEmail: 'input[name="email"]',
  loginPassword: 'input[name="pass"]',
  loginButton: 'button[name="login"]',
  loginText: 'text="Log into Facebook"',
  twoFactorInput: 'input[name="approvals_code"]',
  twoFactorText: 'text="Two-factor authentication"',
  captchaText: 'text="security check"',
  postContainers: ['div[role="article"]', 'div[data-ad-comet-preview="message"]', 'div.userContentWrapper'],
  postTextCandidates: [
    'div[data-ad-comet-preview]',
    'div[dir="auto"]',
    'div[data-ad-preview="message"]',
    'span[dir="auto"]',
  ],
  authorLinkCandidates: [
    'strong a[href*="facebook.com"]',
    'h4 a[href*="facebook.com"]',
    'a[data-hovercard-prefer-more-content-show]'
  ],
  authorNameCandidates: ['strong a', 'h4 a', 'a[role="link"] span'],
  messengerButtons: ['[aria-label="Message"]', 'button:has-text("Message")', 'a[href*="messages"]'],
  messengerTextarea: 'textarea',
};
