export const selectors = {
  loginEmail: 'input[name="email"]',
  loginPassword: 'input[name="pass"]',
  loginButton: 'button[name="login"]',
  loginText: 'text="Log into Facebook"',
  postContainer: 'div[role="article"]',
  postTextCandidates: ['div[data-ad-comet-preview]', 'div[dir="auto"]'],
  authorLink: 'strong a[href*="facebook.com"]',
  authorName: 'strong a',
  messengerButtons: ['[aria-label="Message"]', 'button:has-text("Message")', 'a[href*="messages"]'],
  messengerTextarea: 'textarea',
};
