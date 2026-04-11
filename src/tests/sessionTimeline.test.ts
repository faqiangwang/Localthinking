import { describe, expect, it } from 'vitest';
import type { ChatSession } from '../types';
import {
  groupSessionsByTimeline,
  sortSessionGroupEntries,
} from '../components/Chat/ChatSidebar/sessionTimeline';

function createSession(id: string, updatedAt: number): ChatSession {
  return {
    id,
    name: id,
    messages: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('sessionTimeline', () => {
  const now = new Date('2026-04-11T12:00:00.000Z');

  it('应按时间线分组会话', () => {
    const sessions = [
      createSession('today', new Date('2026-04-11T03:00:00.000Z').getTime()),
      createSession('yesterday', new Date('2026-04-10T03:00:00.000Z').getTime()),
      createSession('week', new Date('2026-04-06T03:00:00.000Z').getTime()),
      createSession('month', new Date('2026-03-20T03:00:00.000Z').getTime()),
      createSession('half-year', new Date('2025-11-20T03:00:00.000Z').getTime()),
      createSession('old', new Date('2025-01-20T03:00:00.000Z').getTime()),
    ];

    const grouped = groupSessionsByTimeline(sessions, now);

    expect(grouped.get('今天')?.[0].session.id).toBe('today');
    expect(grouped.get('昨天')?.[0].session.id).toBe('yesterday');
    expect(grouped.get('七天内')?.[0].session.id).toBe('week');
    expect(grouped.get('三十天内')?.[0].session.id).toBe('month');
    expect(grouped.get('半年内')?.[0].session.id).toBe('half-year');
    expect(grouped.get('2025.01')?.[0].session.id).toBe('old');
  });

  it('应保证固定分组排在年月分组之前', () => {
    const sessions = [
      createSession('old', new Date('2025-01-20T03:00:00.000Z').getTime()),
      createSession('today', new Date('2026-04-11T03:00:00.000Z').getTime()),
    ];

    const sorted = sortSessionGroupEntries(groupSessionsByTimeline(sessions, now));

    expect(sorted[0][0]).toBe('今天');
    expect(sorted[1][0]).toBe('2025.01');
  });
});
