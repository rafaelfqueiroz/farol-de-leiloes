import type { SvgIconComponent } from '@mui/icons-material';
import ConfirmationNumber from '@mui/icons-material/ConfirmationNumber';
import ConfirmationNumberOutlined from '@mui/icons-material/ConfirmationNumberOutlined';
import Favorite from '@mui/icons-material/Favorite';
import FavoriteBorderOutlined from '@mui/icons-material/FavoriteBorderOutlined';
import Notifications from '@mui/icons-material/Notifications';
import NotificationsOutlined from '@mui/icons-material/NotificationsOutlined';
import Person from '@mui/icons-material/Person';
import PersonOutlined from '@mui/icons-material/PersonOutlined';
import Search from '@mui/icons-material/Search';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import SupportAgent from '@mui/icons-material/SupportAgent';
import SupportAgentOutlined from '@mui/icons-material/SupportAgentOutlined';
import WorkspacePremium from '@mui/icons-material/WorkspacePremium';
import WorkspacePremiumOutlined from '@mui/icons-material/WorkspacePremiumOutlined';
import { hasMinimumRole, type UserRole } from '@/app/components/RequireRole';
import type messages from '@/messages/pt-BR.json';

// DESIGN.md §6: the navigation model (groups, items, permission, count source) is this one file,
// owned by the shell. No component keeps its own list of destinations.

type AppShellMessages = (typeof messages)['patterns']['appShell'];
export type NavGroupKey = keyof AppShellMessages['groups'];
export type NavItemKey = keyof AppShellMessages['items'];

/** A count the shell can show next to an item, from what FavoritesContext / RemindersContext hold. */
export type CountSource = 'favorites' | 'upcomingReminders';

export interface NavMatch {
  /** Paths the item is current on: the path itself or anything nested below it. */
  paths: readonly string[];
  /** Query parameters that must hold these values. More parameters make a more specific match. */
  query?: Readonly<Record<string, string>>;
}

export interface NavItem {
  id: string;
  labelKey: NavItemKey;
  href: string;
  /** DS-25: outlined at rest. */
  Icon: SvgIconComponent;
  /** DS-25: filled only for the current item. */
  CurrentIcon: SvgIconComponent;
  minimumRole: UserRole;
  count?: CountSource;
  match: NavMatch;
}

export interface NavGroup {
  id: NavGroupKey;
  labelKey: NavGroupKey;
  items: readonly NavItem[];
}

/**
 * Fixed order: groups never reorder between roles, so a shared destination is always in the same
 * place. "Início" is not a destination (`/` sends signed-in users to /search).
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'search',
    labelKey: 'search',
    items: [
      {
        id: 'search',
        labelKey: 'search',
        href: '/search',
        Icon: SearchOutlined,
        CurrentIcon: Search,
        minimumRole: 'free',
        // a signed-in visitor of a property page is still "in" the search
        match: { paths: ['/search', '/auction'] },
      },
      {
        id: 'favorites',
        labelKey: 'favorites',
        href: '/search?view=favorites',
        Icon: FavoriteBorderOutlined,
        CurrentIcon: Favorite,
        minimumRole: 'standard',
        count: 'favorites',
        match: { paths: ['/search'], query: { view: 'favorites' } },
      },
    ],
  },
  {
    id: 'tracking',
    labelKey: 'tracking',
    items: [
      {
        id: 'reminders',
        labelKey: 'reminders',
        href: '/reminders',
        Icon: NotificationsOutlined,
        CurrentIcon: Notifications,
        minimumRole: 'standard',
        count: 'upcomingReminders',
        match: { paths: ['/reminders'] },
      },
    ],
  },
  // Reserved: Investidores and Equipe join when their specs ship. Empty, so it never renders.
  { id: 'office', labelKey: 'office', items: [] },
  {
    id: 'account',
    labelKey: 'account',
    items: [
      {
        id: 'profile',
        labelKey: 'profile',
        href: '/profile',
        Icon: PersonOutlined,
        CurrentIcon: Person,
        minimumRole: 'free',
        match: { paths: ['/profile'] },
      },
      {
        id: 'subscription',
        labelKey: 'subscription',
        href: '/plans',
        Icon: WorkspacePremiumOutlined,
        CurrentIcon: WorkspacePremium,
        minimumRole: 'free',
        match: { paths: ['/plans'] },
      },
      {
        id: 'support',
        labelKey: 'support',
        href: '/support',
        Icon: SupportAgentOutlined,
        CurrentIcon: SupportAgent,
        minimumRole: 'free',
        match: { paths: ['/support'] },
      },
    ],
  },
  {
    id: 'admin',
    labelKey: 'admin',
    items: [
      {
        id: 'coupons',
        labelKey: 'coupons',
        href: '/admin/coupons',
        Icon: ConfirmationNumberOutlined,
        CurrentIcon: ConfirmationNumber,
        minimumRole: 'admin',
        match: { paths: ['/admin/coupons'] },
      },
    ],
  },
];

/** The groups a role can use, in the fixed order; a group left with no item is dropped. */
export function visibleGroups(role: string, groups: readonly NavGroup[] = NAV_GROUPS): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => hasMinimumRole(role, item.minimumRole)),
    }))
    .filter((group) => group.items.length > 0);
}

function pathMatches(path: string, pathname: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

interface QueryReader {
  get(name: string): string | null;
}

/**
 * The id of the item the location belongs to, or null. When several match, the most specific
 * wins: more query parameters first, then the longer path — so /search?view=favorites is
 * Favoritos and /search is Buscar imóveis.
 */
export function currentItemId(
  groups: readonly NavGroup[],
  pathname: string,
  query: QueryReader,
): string | null {
  let best: { id: string; score: number } | null = null;
  for (const item of groups.flatMap((group) => group.items)) {
    const queryEntries = Object.entries(item.match.query ?? {});
    if (!queryEntries.every(([name, value]) => query.get(name) === value)) continue;
    for (const path of item.match.paths) {
      if (!pathMatches(path, pathname)) continue;
      // a query parameter outweighs any path length
      const score = queryEntries.length * 10_000 + path.length;
      if (!best || score > best.score) best = { id: item.id, score };
    }
  }
  return best?.id ?? null;
}

/** The pill text for a count: none for a missing or zero count, "99+" above 99. */
export function formatCount(count: number | undefined): string | null {
  if (count === undefined || count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}
