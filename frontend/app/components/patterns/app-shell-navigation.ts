import type { SvgIconComponent } from '@mui/icons-material';
import Apartment from '@mui/icons-material/Apartment';
import ApartmentOutlined from '@mui/icons-material/ApartmentOutlined';
import ConfirmationNumber from '@mui/icons-material/ConfirmationNumber';
import ConfirmationNumberOutlined from '@mui/icons-material/ConfirmationNumberOutlined';
import Favorite from '@mui/icons-material/Favorite';
import FavoriteBorderOutlined from '@mui/icons-material/FavoriteBorderOutlined';
import Notifications from '@mui/icons-material/Notifications';
import NotificationsOutlined from '@mui/icons-material/NotificationsOutlined';
import Person from '@mui/icons-material/Person';
import PersonOutlined from '@mui/icons-material/PersonOutlined';
import PrivacyTip from '@mui/icons-material/PrivacyTip';
import PrivacyTipOutlined from '@mui/icons-material/PrivacyTipOutlined';
import Search from '@mui/icons-material/Search';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import SupportAgent from '@mui/icons-material/SupportAgent';
import SupportAgentOutlined from '@mui/icons-material/SupportAgentOutlined';
import WorkspacePremium from '@mui/icons-material/WorkspacePremium';
import WorkspacePremiumOutlined from '@mui/icons-material/WorkspacePremiumOutlined';
import { hasMinimumPlan, type PlanTier } from '@/app/components/RequireRole';
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
  /**
   * Who sees the item: a plan tier and above, the admin capability alone (SPEC-002 BR-002-23: an
   * admin is no plan, and a plan is no admin), or a persona (`advisor`: a member of an office,
   * SPEC-002 BR-002-14). UX only; the server checks (AR-51).
   */
  requires: { plan: PlanTier } | { admin: true } | { persona: 'advisor' };
  /**
   * Where the item goes for an office member instead of `href` (SPEC-012 owner decision 2:
   * "Assinatura" opens the office's plan for its members and the catalogue for everyone else).
   */
  advisorHref?: string;
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
        requires: { plan: 'free' },
        // a signed-in visitor of a property page is still "in" the search
        match: { paths: ['/search', '/auction'] },
      },
      {
        id: 'favorites',
        labelKey: 'favorites',
        href: '/search?view=favorites',
        Icon: FavoriteBorderOutlined,
        CurrentIcon: Favorite,
        requires: { plan: 'standard' },
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
        requires: { plan: 'standard' },
        count: 'upcomingReminders',
        match: { paths: ['/reminders'] },
      },
    ],
  },
  // Investidores and Equipe join when their specs ship. The group renders only for an office member.
  {
    id: 'office',
    labelKey: 'office',
    items: [
      {
        id: 'officePlan',
        labelKey: 'officePlan',
        href: '/office/plan',
        Icon: ApartmentOutlined,
        CurrentIcon: Apartment,
        requires: { persona: 'advisor' },
        match: { paths: ['/office/plan'] },
      },
    ],
  },
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
        requires: { plan: 'free' },
        match: { paths: ['/profile'] },
      },
      {
        id: 'subscription',
        labelKey: 'subscription',
        href: '/plans',
        advisorHref: '/office/plan',
        Icon: WorkspacePremiumOutlined,
        CurrentIcon: WorkspacePremium,
        requires: { plan: 'free' },
        match: { paths: ['/plans'] },
      },
      {
        // SPEC-010 BR-010-05, BR-010-08..13: the rights page. More specific than Perfil, so it
        // wins the match for /profile/privacidade.
        id: 'privacy',
        labelKey: 'privacy',
        href: '/profile/privacidade',
        Icon: PrivacyTipOutlined,
        CurrentIcon: PrivacyTip,
        requires: { plan: 'free' },
        match: { paths: ['/profile/privacidade'] },
      },
      {
        id: 'support',
        labelKey: 'support',
        href: '/support',
        Icon: SupportAgentOutlined,
        CurrentIcon: SupportAgent,
        requires: { plan: 'free' },
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
        requires: { admin: true },
        match: { paths: ['/admin/coupons'] },
      },
    ],
  },
];

/** What /api/auth/me says the account may see: its plan tier, the admin capability and its personas. */
export interface NavCapabilities {
  role: string;
  isAdmin: boolean;
  personas?: readonly string[];
}

function canSee(item: NavItem, { role, isAdmin, personas = [] }: NavCapabilities): boolean {
  if ('plan' in item.requires) return hasMinimumPlan(role, item.requires.plan);
  if ('persona' in item.requires) return personas.includes(item.requires.persona);
  return isAdmin;
}

/** Whether the account is a member of an office (the `advisor` persona, SPEC-002 BR-002-14). */
export function isOfficeMember({ personas = [] }: NavCapabilities): boolean {
  return personas.includes('advisor');
}

/** "Assinatura": the office's plan for its members, the catalogue for everyone else (SPEC-012). */
export function subscriptionHref(capabilities: NavCapabilities): string {
  return isOfficeMember(capabilities) ? '/office/plan' : '/plans';
}

/** The groups an account can use, in the fixed order; a group left with no item is dropped. */
export function visibleGroups(
  capabilities: NavCapabilities,
  groups: readonly NavGroup[] = NAV_GROUPS,
): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => canSee(item, capabilities))
        .map((item) =>
          item.advisorHref !== undefined && isOfficeMember(capabilities)
            ? { ...item, href: item.advisorHref }
            : item,
        ),
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
