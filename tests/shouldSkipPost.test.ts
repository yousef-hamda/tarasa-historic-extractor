/**
 * Tests for the phantom-post filter in src/scraper/orchestrator.ts.
 *
 * The four posts the QA pass found in the prod DB after the session-zombie
 * bug were:
 *   - A group rule starting "Please refrain from hate speech..."
 *   - A pinned welcome starting "Welcome to History of Israel..."
 *   - A guideline starting "Our group has several guidelines..."
 *   - The user's own profile chrome with authorName "Yousef OfTarasa's profile"
 *
 * Every single one of these should be rejected by `shouldSkipPost` going
 * forward, regardless of whether the cookie-based self-id is available. These
 * tests pin that contract.
 */
import { describe, it, expect } from 'vitest';
import { _shouldSkipPostForTests as shouldSkipPost } from '../src/scraper/orchestrator';

interface Post {
  fbPostId: string;
  groupId: string;
  authorName: string | null;
  authorLink: string | null;
  authorPhoto: string | null;
  text: string;
  postUrl: string | null;
}

const basePost = (overrides: Partial<Post> = {}): Post => ({
  fbPostId: '123456789',
  groupId: '136596023614231',
  authorName: 'Real Person',
  authorLink: 'https://www.facebook.com/profile.php?id=200002399000000',
  authorPhoto: null,
  text: 'A perfectly legitimate post about my grandfather in 1947 Tel Aviv.',
  postUrl: 'https://www.facebook.com/groups/136596023614231/posts/123456789',
  ...overrides,
});

const noSelf = { userId: null, userName: null };

describe('shouldSkipPost — legitimate posts pass through', () => {
  it('keeps a real post with all fields populated', () => {
    expect(shouldSkipPost(basePost(), noSelf).skip).toBe(false);
  });
});

describe('shouldSkipPost — Filter 1: self-author by cookie id', () => {
  it('drops posts whose authorLink contains the operator\'s profile id', () => {
    const post = basePost({
      authorLink: 'https://www.facebook.com/profile.php?id=61590486385909',
    });
    const result = shouldSkipPost(post, { userId: '61590486385909', userName: null });
    expect(result.skip).toBe(true);
    expect(result.reason).toMatch(/logged-in scraping account/);
  });
});

describe('shouldSkipPost — Filter 2: no author', () => {
  it('drops posts with neither name nor link', () => {
    const post = basePost({ authorName: null, authorLink: null });
    expect(shouldSkipPost(post, noSelf).skip).toBe(true);
  });
});

describe('shouldSkipPost — Filter 3: group-rule patterns', () => {
  it('drops "Please refrain from hate speech..." (observed in prod row 417)', () => {
    const post = basePost({
      text: 'Please refrain from hate speech. This includes racism, xenophobia...',
    });
    const result = shouldSkipPost(post, noSelf);
    expect(result.skip).toBe(true);
    expect(result.reason).toMatch(/group-rule/);
  });

  it('drops "Welcome to History of Israel!" (observed in prod row 415)', () => {
    const post = basePost({
      text: 'Welcome to History of Israel! Please share your historical pictures...',
    });
    expect(shouldSkipPost(post, noSelf).skip).toBe(true);
  });

  it('drops "Our group has several guidelines..." (observed in prod row 416)', () => {
    const post = basePost({
      text: 'Our group has several guidelines in place to encourage fruitful discussions.',
    });
    expect(shouldSkipPost(post, noSelf).skip).toBe(true);
  });

  it('drops the Hebrew "הקבוצה מיועדת" group-description starter', () => {
    const post = basePost({ text: 'הקבוצה מיועדת לחברים בלבד...' });
    expect(shouldSkipPost(post, noSelf).skip).toBe(true);
  });
});

describe('shouldSkipPost — Filter 4: chrome-artifact name suffix', () => {
  it('drops authorName ending in "\'s profile" (the exact prod symptom)', () => {
    const post = basePost({ authorName: "Yousef OfTarasa's profile" });
    const result = shouldSkipPost(post, noSelf);
    expect(result.skip).toBe(true);
    expect(result.reason).toMatch(/chrome-artifact/);
  });

  it('drops authorName ending in "\'s timeline"', () => {
    const post = basePost({ authorName: "Someone's timeline" });
    expect(shouldSkipPost(post, noSelf).skip).toBe(true);
  });

  it('keeps a real name that just happens to contain "profile" elsewhere', () => {
    const post = basePost({ authorName: 'Professional Photographer' });
    expect(shouldSkipPost(post, noSelf).skip).toBe(false);
  });
});

describe('shouldSkipPost — Filter 5: name matches operator userName', () => {
  it('drops posts when the author name exactly equals the operator name from SessionState', () => {
    const post = basePost({ authorName: 'Yousef Hamda' });
    const result = shouldSkipPost(post, { userId: null, userName: 'Yousef Hamda' });
    expect(result.skip).toBe(true);
    expect(result.reason).toMatch(/operator/);
  });

  it('does NOT drop a different name even when userName is known', () => {
    const post = basePost({ authorName: 'David Matlow' });
    expect(
      shouldSkipPost(post, { userId: null, userName: 'Yousef Hamda' }).skip,
    ).toBe(false);
  });

  it('tolerates whitespace around the name', () => {
    const post = basePost({ authorName: '  Yousef Hamda  ' });
    expect(
      shouldSkipPost(post, { userId: null, userName: 'Yousef Hamda' }).skip,
    ).toBe(true);
  });
});

describe('shouldSkipPost — Filter 7: triple-null structural signature (the bullet-rules bug)', () => {
  it('drops a triple-null row even when its text does NOT match any rule pattern', () => {
    // Use generic non-rule text to ISOLATE Filter 7 from Filter 3. In
    // production, the same post would also match Filter 3 (rule pattern)
    // and Filter 3 would catch it first — but Filter 7 is the safety net
    // for any rule text we haven't added a regex for yet.
    const post = basePost({
      authorName: null,
      authorLink: 'https://www.facebook.com/profile.php?id=1553358724',
      fbPostId: 'hash_07bf3aac73f7514bcc8a',
      postUrl: null,
      text: 'some random text that no pattern matches',
    });
    const result = shouldSkipPost(post, { userId: null, userName: null });
    expect(result.skip).toBe(true);
    expect(result.reason).toMatch(/triple-null/);
  });

  it('also drops the exact prod row 657 (matches Filter 3 or 7 — either way, skip)', () => {
    const post = basePost({
      authorName: null,
      authorLink: 'https://www.facebook.com/profile.php?id=1553358724',
      fbPostId: 'hash_07bf3aac73f7514bcc8a',
      postUrl: null,
      text: '• לא נאפשר פרסום הפוגע ומעליב אישית במישהו...',
    });
    expect(shouldSkipPost(post, { userId: null, userName: null }).skip).toBe(true);
  });

  it('keeps a hash-id post if it has a real authorName (e.g. extractor got author but not id)', () => {
    const post = basePost({
      authorName: 'מיטל קליין-גז',
      fbPostId: 'hash_a433ea3c504dd7e0038c',
      postUrl: null,
      text: 'היום לפני 80 שנה, התקיימה הפעולה הגדולה...',
    });
    expect(shouldSkipPost(post, { userId: null, userName: null }).skip).toBe(false);
  });

  it('keeps a null-name post if it at least has a postUrl', () => {
    const post = basePost({
      authorName: null,
      fbPostId: 'hash_x',
      postUrl: 'https://www.facebook.com/groups/X/posts/123456789',
      text: 'Some text',
    });
    expect(shouldSkipPost(post, { userId: null, userName: null }).skip).toBe(false);
  });

  it('keeps a null-name post if it at least has a numeric id', () => {
    const post = basePost({
      authorName: null,
      fbPostId: '2017717945502020',
      postUrl: null,
      text: 'Some text',
    });
    expect(shouldSkipPost(post, { userId: null, userName: null }).skip).toBe(false);
  });
});

describe('shouldSkipPost — Filter 3 extended: Hebrew bullet-rule patterns', () => {
  it('drops "• לא נאפשר" (won\'t allow ...)', () => {
    const post = basePost({ text: '• לא נאפשר פרסום הפוגע במישהו...' });
    expect(shouldSkipPost(post, noSelf).skip).toBe(true);
  });

  it('drops "• זוהי קבוצה" (this is a group ...)', () => {
    const post = basePost({ text: '• זוהי קבוצה ללא מטרות רווח...' });
    expect(shouldSkipPost(post, noSelf).skip).toBe(true);
  });

  it('drops "קבענו כמה כללי יסוד" (we set basic rules)', () => {
    const post = basePost({ text: 'קבענו כמה כללי יסוד למשתתפים...' });
    expect(shouldSkipPost(post, noSelf).skip).toBe(true);
  });

  it('drops "רצוי שהרשומות" (recommended posts ...)', () => {
    const post = basePost({ text: 'רצוי שהרשומות (הפוסטים) המועלים לקבוצה...' });
    expect(shouldSkipPost(post, noSelf).skip).toBe(true);
  });

  it('drops "מי שהוא בעל זכויות" (whoever owns rights ...)', () => {
    const post = basePost({ text: 'מי שהוא בעל זכויות על תמונה...' });
    expect(shouldSkipPost(post, noSelf).skip).toBe(true);
  });

  it('drops "מאחר והתמונות" (since the photos ...)', () => {
    const post = basePost({ text: 'מאחר והתמונות הן תמונות היסטוריות...' });
    expect(shouldSkipPost(post, noSelf).skip).toBe(true);
  });

  it('keeps a legitimate Hebrew historical story that starts with a date', () => {
    const post = basePost({
      authorName: 'מיטל קליין-גז',
      text: 'היום לפני 80 שנה, בי"ט בסיוון תש"ו (1946), התקיימה הפעולה הגדולה...',
    });
    expect(shouldSkipPost(post, noSelf).skip).toBe(false);
  });

  it('keeps a Hebrew post whose bullet point is just a list inside (not at start)', () => {
    const post = basePost({
      authorName: 'David Cohen',
      text: 'מה שראיתי בילדותי הזכיר לי את:\n• הסיפור של סבא\n• המסע שלנו לכפר',
    });
    expect(shouldSkipPost(post, noSelf).skip).toBe(false);
  });
});

describe('shouldSkipPost — Filter 6: skeptical bundle (hash id + no url + self link)', () => {
  it('drops the exact phantom-post signature seen in prod', () => {
    const post = basePost({
      fbPostId: 'hash_d640c3dd86ab3717e672f5f4a3638306',
      postUrl: null,
      authorLink: 'https://www.facebook.com/profile.php?id=61590486385909',
      authorName: 'Some Legitimate-Looking Name',
      text: 'This text would not match any pattern.',
    });
    const result = shouldSkipPost(post, { userId: '61590486385909', userName: null });
    // Filter 1 fires first since the link matches; the skip is still correct.
    expect(result.skip).toBe(true);
  });

  it('keeps a hash-id post when authorLink is NOT the operator (could be a real public post without a permalink)', () => {
    const post = basePost({
      fbPostId: 'hash_abcdef',
      postUrl: null,
      authorLink: 'https://www.facebook.com/profile.php?id=999999999',
      authorName: 'Random User',
      text: 'Real story about Jerusalem in 1968...',
    });
    expect(shouldSkipPost(post, { userId: '111111111', userName: null }).skip).toBe(false);
  });
});
