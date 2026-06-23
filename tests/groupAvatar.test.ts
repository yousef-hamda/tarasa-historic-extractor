/**
 * Tests for pickGroupAvatar — choosing the group's OWN avatar from the anchors
 * collected on a Facebook group feed page (and never a member's picture).
 */

import { describe, it, expect } from 'vitest';
import { pickGroupAvatar, AvatarCandidate } from '../src/scraper/groupAvatar';

const CDN = 'https://scontent.fbcdn.net';
const groupAvatar = `${CDN}/group-avatar.jpg`;
const memberPhoto = `${CDN}/member-123.jpg`;
const postPhoto = `${CDN}/post-thumb.jpg`;

describe('pickGroupAvatar', () => {
  it('returns null for empty / non-array input', () => {
    expect(pickGroupAvatar([], { groupId: '123' })).toBeNull();
    // @ts-expect-error intentionally wrong type
    expect(pickGroupAvatar(null, { groupId: '123' })).toBeNull();
  });

  it('picks the group-root avatar, NOT the first post-author (member) avatar', () => {
    // The bug: a post author's link comes first in DOM order.
    const candidates: AvatarCandidate[] = [
      {
        href: '/groups/123/user/999/', // member / post author — must be rejected
        src: memberPhoto,
        alt: 'Some Member',
        ariaLabel: null,
        top: 200,
        width: 40,
      },
      {
        href: '/groups/123', // the group's own avatar
        src: groupAvatar,
        alt: 'My Group',
        ariaLabel: 'My Group',
        top: 80,
        width: 60,
      },
    ];
    expect(pickGroupAvatar(candidates, { groupId: '123', groupName: 'My Group' }))
      .toBe(groupAvatar);
  });

  it('rejects every group sub-resource (user, posts, media)', () => {
    const candidates: AvatarCandidate[] = [
      { href: '/groups/123/user/1/', src: memberPhoto, top: 100, width: 40 },
      { href: '/groups/123/posts/abc/', src: postPhoto, top: 300, width: 50 },
      { href: '/groups/123/media/', src: `${CDN}/media.jpg`, top: 500, width: 80 },
    ];
    expect(pickGroupAvatar(candidates, { groupId: '123' })).toBeNull();
  });

  it('matches the canonical numeric link when the page was scraped by vanity name', () => {
    // groupId is a vanity slug; the avatar anchor uses the numeric id.
    const candidates: AvatarCandidate[] = [
      { href: '/groups/999888/user/5/', src: memberPhoto, top: 220, width: 40 },
      {
        href: '/groups/999888', // numeric group root, segment != vanity gid
        src: groupAvatar,
        alt: 'Tarasa History',
        ariaLabel: 'Tarasa History',
        top: 70,
        width: 56,
      },
    ];
    expect(
      pickGroupAvatar(candidates, { groupId: 'tarasa.history', groupName: 'Tarasa History' })
    ).toBe(groupAvatar);
  });

  it('prefers the matching-segment group root over an unrelated suggested group', () => {
    const suggested = `${CDN}/suggested-group.jpg`;
    const candidates: AvatarCandidate[] = [
      // Suggested group in the sidebar — group root but different id, lower down.
      { href: '/groups/777', src: suggested, alt: 'Other Group', top: 600, width: 48 },
      // The real group.
      { href: '/groups/123', src: groupAvatar, alt: 'My Group', top: 80, width: 60 },
    ];
    expect(pickGroupAvatar(candidates, { groupId: '123', groupName: 'My Group' }))
      .toBe(groupAvatar);
  });

  it('ignores non-CDN and protocol-relative junk srcs', () => {
    const candidates: AvatarCandidate[] = [
      { href: '/groups/123', src: 'data:image/png;base64,xxx', top: 80, width: 60 },
      { href: '/groups/123', src: '/local/relative.png', top: 80, width: 60 },
      { href: '/groups/123', src: groupAvatar, alt: 'My Group', top: 80, width: 60 },
    ];
    expect(pickGroupAvatar(candidates, { groupId: '123', groupName: 'My Group' }))
      .toBe(groupAvatar);
  });

  it('works with absolute hrefs and query strings', () => {
    const candidates: AvatarCandidate[] = [
      {
        href: 'https://www.facebook.com/groups/123/user/9/?__cft__=abc',
        src: memberPhoto,
        top: 150,
        width: 40,
      },
      {
        href: 'https://www.facebook.com/groups/123/?ref=group_header',
        src: groupAvatar,
        alt: 'My Group',
        top: 80,
        width: 60,
      },
    ];
    expect(pickGroupAvatar(candidates, { groupId: '123', groupName: 'My Group' }))
      .toBe(groupAvatar);
  });

  it('falls back to a name-matched root even without position/size hints', () => {
    const candidates: AvatarCandidate[] = [
      { href: '/groups/123/user/9/', src: memberPhoto },
      { href: '/groups/123', src: groupAvatar, ariaLabel: 'My Group', alt: null },
    ];
    expect(pickGroupAvatar(candidates, { groupId: '123', groupName: 'My Group' }))
      .toBe(groupAvatar);
  });

  it('returns null when only member/sub-resource photos exist', () => {
    const candidates: AvatarCandidate[] = [
      { href: '/groups/123/user/9/', src: memberPhoto, top: 100, width: 40 },
    ];
    expect(pickGroupAvatar(candidates, { groupId: '123', groupName: 'My Group' }))
      .toBeNull();
  });
});
