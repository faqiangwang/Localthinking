import { ChatSession } from '../../../types';

export interface GroupedSessionEntry {
  session: ChatSession;
  label: string;
}

export type GroupedSessions = Map<string, GroupedSessionEntry[]>;

const FIXED_GROUP_ORDER = ['今天', '昨天', '七天内', '三十天内', '半年内'];

export function groupSessionsByTimeline(
  sessions: ChatSession[],
  nowDate: Date = new Date()
): GroupedSessions {
  const today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const halfYearAgo = new Date(today);
  halfYearAgo.setMonth(halfYearAgo.getMonth() - 6);

  const groups: GroupedSessions = new Map();
  FIXED_GROUP_ORDER.forEach(label => groups.set(label, []));

  sessions.forEach(session => {
    const sessionDate = new Date(session.updatedAt);

    if (sessionDate >= today) {
      groups.get('今天')!.push({ session, label: '今天' });
      return;
    }

    if (sessionDate >= yesterday) {
      groups.get('昨天')!.push({ session, label: '昨天' });
      return;
    }

    if (sessionDate >= sevenDaysAgo) {
      groups.get('七天内')!.push({ session, label: '七天内' });
      return;
    }

    if (sessionDate >= thirtyDaysAgo) {
      groups.get('三十天内')!.push({ session, label: '三十天内' });
      return;
    }

    if (sessionDate >= halfYearAgo) {
      groups.get('半年内')!.push({ session, label: '半年内' });
      return;
    }

    const year = sessionDate.getFullYear();
    const month = String(sessionDate.getMonth() + 1).padStart(2, '0');
    const monthLabel = `${year}.${month}`;

    if (!groups.has(monthLabel)) {
      groups.set(monthLabel, []);
    }

    groups.get(monthLabel)!.push({ session, label: monthLabel });
  });

  groups.forEach(entries => {
    entries.sort((a, b) => b.session.updatedAt - a.session.updatedAt);
  });

  return groups;
}

export function sortSessionGroupEntries(
  groups: GroupedSessions
): Array<[string, GroupedSessionEntry[]]> {
  return Array.from(groups.entries())
    .filter(([, entries]) => entries.length > 0)
    .sort(([labelA], [labelB]) => {
      const indexA = FIXED_GROUP_ORDER.indexOf(labelA);
      const indexB = FIXED_GROUP_ORDER.indexOf(labelB);

      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }

      if (indexA !== -1) {
        return -1;
      }

      if (indexB !== -1) {
        return 1;
      }

      return labelB.localeCompare(labelA);
    });
}
