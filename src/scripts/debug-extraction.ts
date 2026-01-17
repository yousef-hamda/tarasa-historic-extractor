/**
 * Debug Script: Comprehensive Facebook Post Extraction Analysis
 *
 * This script analyzes the actual DOM structure of Facebook posts
 * to understand how to properly extract:
 * - Post text (full, without "See more/less")
 * - Author name and profile link
 * - Post URL/permalink
 * - Post ID
 *
 * Usage: npx ts-node src/scripts/debug-extraction.ts [groupId]
 */

import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');
const DEBUG_OUTPUT_DIR = path.resolve(process.cwd(), 'debug-output');

const testGroupId = process.argv[2] || process.env.GROUP_IDS?.split(',')[0] || '';

if (!testGroupId) {
  console.error('Error: Please provide a group ID');
  process.exit(1);
}

interface PostAnalysis {
  index: number;
  containerInfo: {
    tagName: string;
    className: string;
    dataAttributes: Record<string, string>;
    hasRoleArticle: boolean;
  };
  authorInfo: {
    foundName: string | null;
    foundLink: string | null;
    foundPhoto: string | null;
    allLinksInPost: string[];
    allNamesFound: string[];
  };
  textInfo: {
    rawText: string;
    textLength: number;
    hasSeeMore: boolean;
    hasSeeLess: boolean;
    firstDirAutoText: string | null;
  };
  urlInfo: {
    permalinks: string[];
    allLinks: string[];
  };
  idInfo: {
    possibleIds: string[];
    dataFt: string | null;
  };
}

async function analyzePostStructure(page: Page): Promise<PostAnalysis[]> {
  console.log('\n=== ANALYZING POST DOM STRUCTURE ===\n');

  const analysis = await page.evaluate(() => {
    const results: PostAnalysis[] = [];

    // Find all article containers
    const articles = document.querySelectorAll('div[role="article"]');
    console.log(`Found ${articles.length} articles`);

    // FIRST: Filter out loading placeholders AND comments
    const realArticles: Element[] = [];
    let commentCount = 0;
    let loadingCount = 0;

    for (const article of articles) {
      const ariaLabel = article.getAttribute('aria-label') || '';
      const hasLoadingLabel = !!article.querySelector('[aria-label="Loading..."]');
      const hasLoadingState = !!article.querySelector('[data-visualcompletion="loading-state"]');
      const textContent = article.textContent || '';

      // Skip loading placeholders
      if (hasLoadingLabel || hasLoadingState) {
        loadingCount++;
        continue;
      }

      // Skip comments
      if (ariaLabel.toLowerCase().includes('comment')) {
        commentCount++;
        continue;
      }

      // Real main post
      if (textContent.length > 100) {
        realArticles.push(article);
      }
    }

    console.log(`Found ${realArticles.length} MAIN POSTS, ${commentCount} comments, ${loadingCount} loading`);

    // Use realArticles instead of articles
    realArticles.forEach((article, index) => {
      if (index >= 10) return; // Limit to first 10 for analysis

      const analysis: PostAnalysis = {
        index,
        containerInfo: {
          tagName: article.tagName,
          className: article.className.substring(0, 200),
          dataAttributes: {},
          hasRoleArticle: true,
        },
        authorInfo: {
          foundName: null,
          foundLink: null,
          foundPhoto: null,
          allLinksInPost: [],
          allNamesFound: [],
        },
        textInfo: {
          rawText: '',
          textLength: 0,
          hasSeeMore: false,
          hasSeeLess: false,
          firstDirAutoText: null,
        },
        urlInfo: {
          permalinks: [],
          allLinks: [],
        },
        idInfo: {
          possibleIds: [],
          dataFt: null,
        },
      };

      // Get all data attributes
      Array.from(article.attributes).forEach(attr => {
        if (attr.name.startsWith('data-')) {
          analysis.containerInfo.dataAttributes[attr.name] = attr.value.substring(0, 100);
        }
      });

      // === AUTHOR ANALYSIS ===
      // Strategy 0: Parse author from article aria-label (e.g., "Post by John Doe 2 days ago")
      const articleAriaLabel = article.getAttribute('aria-label') || '';
      const postByMatch = articleAriaLabel.match(/^(?:Post|Story) by ([^,]+?)(?:\s+(?:on|at|\d+)\s|,|$)/i);
      if (postByMatch && postByMatch[1]) {
        const authorFromLabel = postByMatch[1].trim();
        if (authorFromLabel.length > 1 && authorFromLabel.length < 100) {
          analysis.authorInfo.allNamesFound.push(`aria-label: ${authorFromLabel}`);
          if (!analysis.authorInfo.foundName) {
            analysis.authorInfo.foundName = authorFromLabel;
          }
        }
      }

      // Strategy 1: Look for the first h2/h3/h4 with a link (usually author name)
      const headerLinks = article.querySelectorAll('h2 a, h3 a, h4 a');
      headerLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        const text = (link as HTMLElement).innerText?.trim();
        if (text && text.length > 0 && text.length < 100) {
          analysis.authorInfo.allNamesFound.push(`header: ${text}`);
          if (!analysis.authorInfo.foundName &&
              (href.includes('/user/') || href.includes('profile.php') ||
               href.match(/facebook\.com\/[a-zA-Z0-9.]+\/?$/))) {
            analysis.authorInfo.foundName = text;
            analysis.authorInfo.foundLink = href;
          }
        }
      });

      // Strategy 2: Look for profile links with images
      const profileLinks = article.querySelectorAll('a[href*="/user/"], a[href*="profile.php"]');
      profileLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        analysis.authorInfo.allLinksInPost.push(href.substring(0, 100));

        // Check for profile image
        const svgImage = link.querySelector('svg image');
        const img = link.querySelector('img');

        if (svgImage) {
          const photoSrc = svgImage.getAttribute('href') ||
                          svgImage.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
          if (photoSrc && !analysis.authorInfo.foundPhoto) {
            analysis.authorInfo.foundPhoto = photoSrc.substring(0, 100);
          }
        }
        if (img) {
          const src = img.getAttribute('src');
          if (src && !analysis.authorInfo.foundPhoto) {
            analysis.authorInfo.foundPhoto = src.substring(0, 100);
          }
        }

        // Get name from aria-label or adjacent text
        const ariaLabel = link.getAttribute('aria-label');
        if (ariaLabel) {
          analysis.authorInfo.allNamesFound.push(`aria: ${ariaLabel}`);
          if (!analysis.authorInfo.foundName) {
            analysis.authorInfo.foundName = ariaLabel;
            analysis.authorInfo.foundLink = href;
          }
        }
      });

      // Strategy 3: Look for strong tags that might contain author name
      const strongTags = article.querySelectorAll('strong');
      strongTags.forEach(strong => {
        const link = strong.querySelector('a');
        if (link) {
          const text = (link as HTMLElement).innerText?.trim();
          const href = link.getAttribute('href') || '';
          if (text && text.length > 0 && text.length < 100) {
            analysis.authorInfo.allNamesFound.push(`strong: ${text}`);
          }
        }
      });

      // === TEXT ANALYSIS ===
      // Get all dir="auto" divs for text content
      const dirAutoDivs = article.querySelectorAll('div[dir="auto"]');
      let longestText = '';

      dirAutoDivs.forEach((div, i) => {
        const text = (div as HTMLElement).innerText?.trim() || '';
        if (i === 0) {
          analysis.textInfo.firstDirAutoText = text.substring(0, 200);
        }
        if (text.length > longestText.length && text.length > 20) {
          // Skip if it's just UI text
          if (!text.match(/^(Like|Comment|Share|Reply|\d+\s*(likes?|comments?|shares?))$/i)) {
            longestText = text;
          }
        }
      });

      analysis.textInfo.rawText = longestText.substring(0, 500);
      analysis.textInfo.textLength = longestText.length;
      analysis.textInfo.hasSeeMore = longestText.toLowerCase().includes('see more');
      analysis.textInfo.hasSeeLess = longestText.toLowerCase().includes('see less');

      // === URL ANALYSIS ===
      const allLinks = article.querySelectorAll('a[href]');
      allLinks.forEach(link => {
        const href = link.getAttribute('href') || '';

        // Check for permalinks
        if (href.includes('/posts/') || href.includes('/permalink/') ||
            href.includes('story_fbid=') || href.includes('pfbid')) {
          analysis.urlInfo.permalinks.push(href.substring(0, 150));
        }

        // Store all links for analysis
        if (href.includes('facebook.com') && analysis.urlInfo.allLinks.length < 10) {
          analysis.urlInfo.allLinks.push(href.substring(0, 100));
        }
      });

      // === ID ANALYSIS ===
      // Look for data-ft attribute
      const dataFt = article.getAttribute('data-ft');
      if (dataFt) {
        analysis.idInfo.dataFt = dataFt.substring(0, 200);
        try {
          const parsed = JSON.parse(dataFt);
          if (parsed.mf_story_key) analysis.idInfo.possibleIds.push(`mf_story_key: ${parsed.mf_story_key}`);
          if (parsed.top_level_post_id) analysis.idInfo.possibleIds.push(`top_level_post_id: ${parsed.top_level_post_id}`);
        } catch {}
      }

      // Extract IDs from permalinks
      analysis.urlInfo.permalinks.forEach(permalink => {
        const postIdMatch = permalink.match(/\/posts\/(\d+)/);
        const permalinkMatch = permalink.match(/\/permalink\/(\d+)/);
        const storyIdMatch = permalink.match(/story_fbid=(\d+)/);
        const pfbidMatch = permalink.match(/(pfbid[A-Za-z0-9]+)/);

        if (postIdMatch) analysis.idInfo.possibleIds.push(`posts: ${postIdMatch[1]}`);
        if (permalinkMatch) analysis.idInfo.possibleIds.push(`permalink: ${permalinkMatch[1]}`);
        if (storyIdMatch) analysis.idInfo.possibleIds.push(`story_fbid: ${storyIdMatch[1]}`);
        if (pfbidMatch) analysis.idInfo.possibleIds.push(`pfbid: ${pfbidMatch[1]}`);
      });

      results.push(analysis);
    });

    return results;
  });

  return analysis;
}

async function main() {
  console.log('\n========================================');
  console.log('  FACEBOOK POST EXTRACTION DEBUGGER');
  console.log('========================================\n');
  console.log(`Group ID: ${testGroupId}`);

  // Create debug output directory
  await fs.mkdir(DEBUG_OUTPUT_DIR, { recursive: true });

  // Clean up lock files
  const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
  for (const file of lockFiles) {
    try {
      await fs.unlink(path.join(BROWSER_DATA_DIR, file));
    } catch {}
  }

  let browser: BrowserContext | null = null;

  try {
    console.log('1. Launching browser...');
    browser = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
      headless: true,
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    // Navigate to group
    const groupUrl = `https://www.facebook.com/groups/${testGroupId}`;
    console.log(`\n2. Navigating to: ${groupUrl}`);
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for content - IMPROVED: Wait for ACTUAL content, not loading placeholders
    console.log('\n3. Waiting for feed to load...');
    try {
      await page.waitForSelector('div[role="feed"]', { timeout: 15000 });
      console.log('   ✓ Feed container found');
    } catch {
      console.log('   ⚠ Feed not found, trying articles...');
      await page.waitForSelector('div[role="article"]', { timeout: 10000 });
    }

    // Dismiss any popups/dialogs
    console.log('\n3a. Dismissing popups...');
    try {
      const popupButtons = await page.$$('[aria-label="Close"], [aria-label="Not now"], button:has-text("Not now"), button:has-text("Close"), button:has-text("Learn more")');
      for (const btn of popupButtons.slice(0, 3)) {
        try {
          await btn.click();
          await page.waitForTimeout(500);
          console.log('   ✓ Dismissed a popup');
        } catch {}
      }
    } catch (e) {
      console.log('   No popups to dismiss');
    }

    // CRITICAL: Wait for ACTUAL content, not loading placeholders
    // Loading placeholders have aria-label="Loading..." or data-visualcompletion="loading-state"
    // Also: Filter out COMMENTS - they have "Comment by" in aria-label
    console.log('\n3b. Waiting for actual MAIN POST content (excluding comments)...');

    const waitForRealContent = async (): Promise<boolean> => {
      const maxAttempts = 30; // Max 30 seconds
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const contentStatus = await page.evaluate(() => {
          const articles = document.querySelectorAll('div[role="article"]');
          let mainPostCount = 0;
          let commentCount = 0;
          let loadingCount = 0;
          let sampleText = '';

          for (const article of articles) {
            const ariaLabel = article.getAttribute('aria-label') || '';
            const hasLoadingLabel = !!article.querySelector('[aria-label="Loading..."]');
            const hasLoadingState = !!article.querySelector('[data-visualcompletion="loading-state"]');
            const textContent = article.textContent || '';
            const textLength = textContent.length;

            // Skip loading placeholders
            if (hasLoadingLabel || hasLoadingState) {
              loadingCount++;
              continue;
            }

            // Skip comments - they have "Comment by" in aria-label
            if (ariaLabel.toLowerCase().includes('comment')) {
              commentCount++;
              continue;
            }

            // Real post (not loading, not comment, has content)
            if (textLength > 100) {
              mainPostCount++;
              if (!sampleText && textLength > 50) {
                sampleText = textContent.substring(0, 100).replace(/\s+/g, ' ').trim();
              }
            }
          }

          return {
            total: articles.length,
            mainPosts: mainPostCount,
            comments: commentCount,
            loading: loadingCount,
            sampleText
          };
        });

        console.log(`   Attempt ${attempt + 1}: ${contentStatus.mainPosts} main posts / ${contentStatus.comments} comments / ${contentStatus.loading} loading / ${contentStatus.total} total`);

        if (contentStatus.mainPosts >= 3) {
          console.log(`   ✓ Found ${contentStatus.mainPosts} main posts`);
          console.log(`   Sample: "${contentStatus.sampleText}..."`);
          return true;
        }

        // Scroll a bit to trigger loading
        await page.evaluate('window.scrollBy(0, 500)');
        await page.waitForTimeout(1000);
      }

      console.log('   ⚠ Timed out waiting for main posts');
      return false;
    };

    const hasRealContent = await waitForRealContent();
    if (!hasRealContent) {
      console.log('   WARNING: May be extracting loading placeholders!');
    }

    // Scroll to load more posts
    console.log('\n4. Scrolling to load posts...');
    for (let i = 0; i < 5; i++) {
      await page.evaluate('window.scrollBy(0, 1500)');
      await page.waitForTimeout(1500);

      // Check content status after each scroll
      const status = await page.evaluate(() => {
        const articles = document.querySelectorAll('div[role="article"]');
        let real = 0;
        for (const a of articles) {
          const hasLoading = !!a.querySelector('[aria-label="Loading..."]');
          const text = (a.textContent || '').length;
          if (!hasLoading && text > 100) real++;
        }
        return { total: articles.length, real };
      });
      console.log(`   Scroll ${i + 1}/5: ${status.real} real articles of ${status.total} total`);
    }
    await page.waitForTimeout(2000);

    // Take screenshot before analysis
    const screenshotPath = path.join(DEBUG_OUTPUT_DIR, 'page-before-analysis.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`\n5. Screenshot saved: ${screenshotPath}`);

    // Analyze post structure
    console.log('\n6. Analyzing post structure...');
    const analysis = await analyzePostStructure(page);

    // Print analysis results
    console.log('\n========================================');
    console.log('  POST ANALYSIS RESULTS');
    console.log('========================================\n');

    for (const post of analysis) {
      console.log(`\n--- POST ${post.index + 1} ---`);
      console.log('\n[AUTHOR INFO]');
      console.log(`  Found Name: ${post.authorInfo.foundName || 'NOT FOUND'}`);
      console.log(`  Found Link: ${post.authorInfo.foundLink || 'NOT FOUND'}`);
      console.log(`  Found Photo: ${post.authorInfo.foundPhoto ? 'YES' : 'NO'}`);
      console.log(`  All Names Found: ${post.authorInfo.allNamesFound.join(', ') || 'NONE'}`);
      console.log(`  Profile Links: ${post.authorInfo.allLinksInPost.length}`);

      console.log('\n[TEXT INFO]');
      console.log(`  Text Length: ${post.textInfo.textLength} chars`);
      console.log(`  Has "See more": ${post.textInfo.hasSeeMore}`);
      console.log(`  Has "See less": ${post.textInfo.hasSeeLess}`);
      console.log(`  Preview: "${post.textInfo.rawText.substring(0, 100)}..."`);

      console.log('\n[URL INFO]');
      console.log(`  Permalinks Found: ${post.urlInfo.permalinks.length}`);
      post.urlInfo.permalinks.forEach(p => console.log(`    - ${p}`));

      console.log('\n[ID INFO]');
      console.log(`  Possible IDs: ${post.idInfo.possibleIds.join(', ') || 'NONE'}`);
    }

    // Save full analysis to JSON
    const analysisPath = path.join(DEBUG_OUTPUT_DIR, 'post-analysis.json');
    await fs.writeFile(analysisPath, JSON.stringify(analysis, null, 2));
    console.log(`\n\nFull analysis saved to: ${analysisPath}`);

    // Additional DOM inspection - get raw HTML of first article
    console.log('\n\n========================================');
    console.log('  RAW HTML OF FIRST ARTICLE (partial)');
    console.log('========================================\n');

    const firstArticleHtml = await page.evaluate(() => {
      const article = document.querySelector('div[role="article"]');
      if (!article) return 'No article found';

      // Get a cleaned version with key elements
      const clone = article.cloneNode(true) as HTMLElement;
      // Remove scripts and styles
      clone.querySelectorAll('script, style').forEach(el => el.remove());
      return clone.outerHTML.substring(0, 3000);
    });

    console.log(firstArticleHtml);

    // Save HTML for analysis
    const htmlPath = path.join(DEBUG_OUTPUT_DIR, 'first-article.html');
    const fullHtml = await page.evaluate(() => {
      const article = document.querySelector('div[role="article"]');
      return article?.outerHTML || '';
    });
    await fs.writeFile(htmlPath, fullHtml);
    console.log(`\nFull HTML saved to: ${htmlPath}`);

    // ALSO save the first feed child that has substantial content
    const feedChildHtmlPath = path.join(DEBUG_OUTPUT_DIR, 'first-feed-post.html');
    const feedChildHtml = await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (!feed) return 'NO FEED FOUND';

      const children = Array.from(feed.children);
      for (const child of children) {
        const text = (child as HTMLElement).innerText || '';
        // Look for a child with substantial text (a real post)
        if (text.length > 200) {
          return (child as HTMLElement).outerHTML;
        }
      }

      // If no substantial text found, return first few children's structure
      let result = '<!-- No substantial feed children found. First 5 children: -->\n\n';
      for (let i = 0; i < Math.min(5, children.length); i++) {
        const child = children[i] as HTMLElement;
        result += `<!-- Child ${i}: ${child.tagName}, text length: ${(child.innerText || '').length} -->\n`;
        result += child.outerHTML.substring(0, 2000) + '\n\n';
      }
      return result;
    });
    await fs.writeFile(feedChildHtmlPath, feedChildHtml);
    console.log(`Feed child HTML saved to: ${feedChildHtmlPath}`);

    // Check current page URL (to verify we're on the right page)
    console.log('\n\n========================================');
    console.log('  PAGE INFO');
    console.log('========================================\n');
    console.log(`Current URL: ${page.url()}`);
    console.log(`Page Title: ${await page.title()}`);

    // ADDITIONAL DEBUG: List ALL aria-labels on articles to understand structure
    console.log('\n\n========================================');
    console.log('  ALL ARTICLE ARIA-LABELS (for debugging)');
    console.log('========================================\n');
    const allArticleLabels = await page.evaluate(() => {
      const articles = document.querySelectorAll('div[role="article"]');
      return Array.from(articles).map((a, i) => {
        const label = a.getAttribute('aria-label') || 'NO LABEL';
        const textLen = (a.textContent || '').length;
        return `${i + 1}. [${textLen} chars] ${label}`;
      });
    });
    allArticleLabels.forEach(label => console.log(label));

    // Check for feed structure
    console.log('\n\n========================================');
    console.log('  FEED STRUCTURE DEBUG');
    console.log('========================================\n');
    const feedInfo = await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (!feed) return { hasFeed: false };

      // Count direct children of feed
      const directChildren = Array.from(feed.children);
      const childTypes: Record<string, number> = {};
      directChildren.forEach(child => {
        const tag = child.tagName;
        const role = child.getAttribute('role') || 'none';
        const key = `${tag}[role=${role}]`;
        childTypes[key] = (childTypes[key] || 0) + 1;
      });

      // Check for data-pagelet attributes (Facebook uses these for feed items)
      const pagelets = feed.querySelectorAll('[data-pagelet]');
      const pageletTypes: string[] = [];
      pagelets.forEach((p, i) => {
        if (i < 10) {
          const val = p.getAttribute('data-pagelet') || 'unknown';
          pageletTypes.push(val);
        }
      });

      // Look for div[dir="auto"] with substantial text (post content)
      const dirAutoWithText: string[] = [];
      const dirAutoDivs = document.querySelectorAll('div[dir="auto"]');
      for (const div of dirAutoDivs) {
        const text = (div as HTMLElement).innerText || '';
        if (text.length > 100 && text.length < 5000) {
          dirAutoWithText.push(text.substring(0, 150).replace(/\s+/g, ' ').trim());
        }
        if (dirAutoWithText.length >= 5) break;
      }

      return {
        hasFeed: true,
        feedChildCount: directChildren.length,
        childTypes,
        pageletTypes,
        dirAutoWithText
      };
    });

    console.log('Feed info:', JSON.stringify(feedInfo, null, 2));

    // NEW: Analyze feed children structure to find posts
    console.log('\n\n========================================');
    console.log('  FEED CHILDREN ANALYSIS');
    console.log('========================================\n');
    const feedChildrenInfo = await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (!feed) return [];

      const children = Array.from(feed.children);
      const results: Array<{
        index: number;
        hasTextContent: boolean;
        textLength: number;
        textPreview: string;
        hasProfilePhoto: boolean;
        hasPermalink: boolean;
        permalinkSample: string | null;
        innerStructure: string;
        authorName: string | null;
      }> = [];

      console.log(`DEBUG: Feed has ${children.length} direct children`);

      for (let i = 0; i < Math.min(children.length, 30); i++) {
        const child = children[i];
        const text = (child as HTMLElement).innerText || '';

        // Log every child's text length for debugging
        console.log(`DEBUG: Child ${i}: ${text.length} chars`);

        // Include items with any text for analysis (lowered threshold)
        if (text.length < 10) continue;

        // Look for profile photos (SVG images)
        const svgImages = child.querySelectorAll('svg image');
        let hasProfilePhoto = false;
        for (const img of svgImages) {
          const href = img.getAttribute('href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
          if (href.includes('scontent') || href.includes('fbcdn')) {
            hasProfilePhoto = true;
            break;
          }
        }

        // Look for permalinks
        let hasPermalink = false;
        let permalinkSample: string | null = null;
        const links = child.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="pfbid"]');
        if (links.length > 0) {
          hasPermalink = true;
          permalinkSample = links[0].getAttribute('href')?.substring(0, 80) || null;
        }

        // Get inner structure summary
        const roles = new Set<string>();
        child.querySelectorAll('[role]').forEach(el => {
          const role = el.getAttribute('role');
          if (role) roles.add(role);
        });

        // Try to extract author name
        let authorName: string | null = null;
        // Strategy 1: Look in h2/h3 links
        const headerLink = child.querySelector('h2 a, h3 a, h4 a');
        if (headerLink) {
          authorName = (headerLink as HTMLElement).innerText?.trim() || null;
        }
        // Strategy 2: Look for aria-label on profile links
        if (!authorName) {
          const profileLink = child.querySelector('a[aria-label][href*="/user/"], a[aria-label][href*="profile.php"]');
          if (profileLink) {
            authorName = profileLink.getAttribute('aria-label') || null;
          }
        }

        results.push({
          index: i,
          hasTextContent: text.length > 100,
          textLength: text.length,
          textPreview: text.substring(0, 150).replace(/\s+/g, ' ').trim(),
          hasProfilePhoto,
          hasPermalink,
          permalinkSample,
          innerStructure: Array.from(roles).join(', '),
          authorName
        });
      }

      return results;
    });

    for (const info of feedChildrenInfo) {
      console.log(`\n--- FEED CHILD ${info.index} ---`);
      console.log(`  Text: ${info.textLength} chars - "${info.textPreview}..."`);
      console.log(`  Author: ${info.authorName || 'NOT FOUND'}`);
      console.log(`  Profile Photo: ${info.hasProfilePhoto ? 'YES' : 'NO'}`);
      console.log(`  Permalink: ${info.hasPermalink ? 'YES' : 'NO'} ${info.permalinkSample || ''}`);
      console.log(`  Roles inside: ${info.innerStructure || 'none'}`);
    }

  } catch (error) {
    console.error('\n❌ Debug failed:', (error as Error).message);
    console.error(error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main().then(() => {
  console.log('\n\nDebug complete.');
  process.exit(0);
}).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
