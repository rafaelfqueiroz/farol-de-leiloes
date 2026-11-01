'use client';

import CloseOutlined from '@mui/icons-material/CloseOutlined';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import KeyboardDoubleArrowLeftOutlined from '@mui/icons-material/KeyboardDoubleArrowLeftOutlined';
import KeyboardDoubleArrowRightOutlined from '@mui/icons-material/KeyboardDoubleArrowRightOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import MenuOutlined from '@mui/icons-material/MenuOutlined';
import NotificationsOutlined from '@mui/icons-material/NotificationsOutlined';
import PersonOutlined from '@mui/icons-material/PersonOutlined';
import WorkspacePremiumOutlined from '@mui/icons-material/WorkspacePremiumOutlined';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useColorScheme, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Suspense,
  useCallback,
  useEffect,
  useId,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import Logo from '@/app/components/patterns/Logo';
import {
  currentItemId,
  formatCount,
  visibleGroups,
  type CountSource,
  type NavGroup,
} from '@/app/components/patterns/app-shell-navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import { useFavorites } from '@/app/contexts/FavoritesContext';
import { useReminders } from '@/app/contexts/RemindersContext';
import ColorSchemeControl from '@/app/theme/ColorSchemeControl';

export const MAIN_CONTENT_ID = 'app-content';
const DRAWER_ID = 'app-shell-drawer';
/** The md–lg "pin open" choice, per browser (DESIGN.md §6). */
export const RAIL_PINNED_STORAGE_KEY = 'farol.appShell.railPinned';

// Storage can be blocked (private windows, cleared site data): the shell works without it.
function readRailPinned(): boolean {
  try {
    return window.localStorage.getItem(RAIL_PINNED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeRailPinned(pinned: boolean) {
  try {
    window.localStorage.setItem(RAIL_PINNED_STORAGE_KEY, String(pinned));
  } catch {
    // the choice then lasts until the page is reloaded
  }
}

type Counts = Partial<Record<CountSource, number>>;

// Counts come only from what the contexts already hold; while they load there is no pill
// (formatCount also hides zero, which is what a failed load leaves).
function useCounts(): Counts {
  const { favorites, loading: favoritesLoading } = useFavorites();
  const { reminders, loading: remindersLoading } = useReminders();
  return {
    favorites: favoritesLoading ? undefined : favorites.length,
    upcomingReminders: remindersLoading
      ? undefined
      : reminders.filter((reminder) => reminder.status === 'PENDING').length,
  };
}

function CountPill({ children, corner = false }: { children: ReactNode; corner?: boolean }) {
  return (
    // the item's aria-label already carries the count, so the pill is not read twice
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({
        ...theme.typography.caption,
        // DS-12: counts line up
        fontVariantNumeric: 'tabular-nums',
        minWidth: theme.spacing(corner ? 2.5 : 3),
        px: corner ? 0.5 : 0.75,
        borderRadius: `${theme.shape.pillRadius}px`,
        // neutral, never brand-coloured: a count is not an action (DS-24)
        bgcolor: 'background.muted',
        color: 'text.primary',
        textAlign: 'center',
        ...(corner ? { position: 'absolute', top: theme.spacing(0.25), right: 0 } : { ml: 'auto' }),
      })}
    >
      {children}
    </Box>
  );
}

type NavVariant = 'full' | 'rail';

interface NavListsProps {
  groups: readonly NavGroup[];
  currentId: string | null;
  counts: Counts;
  variant: NavVariant;
  onNavigate?: () => void;
}

function NavLists({ groups, currentId, counts, variant, onNavigate }: NavListsProps) {
  const t = useTranslations('patterns.appShell');
  const idPrefix = useId();

  const itemName = (label: string, source: CountSource | undefined) => {
    const count = source ? counts[source] : undefined;
    if (!source || formatCount(count) === null || count === undefined) return undefined;
    return source === 'upcomingReminders'
      ? t('upcomingReminders', { label, count })
      : t('withCount', { label, count });
  };

  return (
    <>
      {groups.map((group, index) => {
        const groupLabel = t(`groups.${group.labelKey}`);
        const labelId = `${idPrefix}-${group.id}`;
        const items = group.items.map((item) => {
          const current = item.id === currentId;
          const label = t(`items.${item.labelKey}`);
          const count = item.count ? formatCount(counts[item.count]) : null;
          const Icon = current ? item.CurrentIcon : item.Icon;
          const button = (
            <ListItemButton
              component={Link}
              href={item.href}
              onClick={onNavigate}
              aria-current={current ? 'page' : undefined}
              aria-label={variant === 'rail' ? (itemName(label, item.count) ?? label) : itemName(label, item.count)}
              sx={(theme) => ({
                // DS-16: 44px targets
                minHeight: theme.spacing(5.5),
                borderRadius: 1,
                gap: 1.5,
                // DS-24: the current destination is primary on primary.soft
                color: current ? 'primary.main' : 'text.primary',
                bgcolor: current ? 'primary.soft' : 'transparent',
                '&:hover': { bgcolor: current ? 'primary.soft' : 'action.hover' },
                ...(variant === 'rail'
                  ? {
                      width: theme.spacing(6),
                      flexGrow: 0,
                      justifyContent: 'center',
                      px: 0,
                      position: 'relative',
                    }
                  : { mx: 1, px: 2 }),
              })}
            >
              <ListItemIcon
                sx={{ minWidth: 0, color: current ? 'primary.main' : 'text.secondary' }}
              >
                <Icon />
              </ListItemIcon>
              {variant === 'full' && (
                <ListItemText primary={label} slotProps={{ primary: { variant: 'subtitle2' } }} />
              )}
              {count && <CountPill corner={variant === 'rail'}>{count}</CountPill>}
            </ListItemButton>
          );
          return (
            <ListItem
              key={item.id}
              disablePadding
              sx={variant === 'rail' ? { justifyContent: 'center' } : undefined}
            >
              {variant === 'rail' ? (
                // the rail has no visible labels: the name shows on hover and on focus
                <Tooltip title={label} placement="right">
                  {button}
                </Tooltip>
              ) : (
                button
              )}
            </ListItem>
          );
        });

        if (variant === 'rail') {
          return (
            <Box key={group.id}>
              {index > 0 && (
                <Divider aria-hidden sx={{ width: (theme) => theme.spacing(4), mx: 'auto', my: 1 }} />
              )}
              <List disablePadding aria-label={groupLabel}>
                {items}
              </List>
            </Box>
          );
        }
        return (
          <Box key={group.id} sx={{ pt: 2 }}>
            <Typography
              id={labelId}
              variant="overline"
              component="div"
              sx={{ px: 3, pb: 0.5, color: 'text.secondary' }}
            >
              {groupLabel}
            </Typography>
            <List disablePadding aria-labelledby={labelId}>
              {items}
            </List>
          </Box>
        );
      })}
    </>
  );
}

// useSearchParams needs a Suspense boundary for static prerendering; the fallback is the same
// list with no current item.
function LocatedNavLists(props: Omit<NavListsProps, 'currentId'>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentId = currentItemId(props.groups, pathname ?? '', searchParams ?? new URLSearchParams());
  return <NavLists {...props} currentId={currentId} />;
}

function Navigation(props: Omit<NavListsProps, 'currentId'>) {
  return (
    <Suspense fallback={<NavLists {...props} currentId={null} />}>
      <LocatedNavLists {...props} />
    </Suspense>
  );
}

function HomeLink({
  variant,
  size,
  onClick,
}: {
  variant: 'lockup' | 'mark';
  size: number;
  onClick?: () => void;
}) {
  const t = useTranslations('patterns.appShell');
  const tLogo = useTranslations('patterns.logo');
  return (
    <Box
      component={Link}
      href="/"
      onClick={onClick}
      aria-label={t('home', { name: tLogo('name') })}
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: theme.spacing(5.5),
        minWidth: theme.spacing(5.5),
        borderRadius: 1,
        color: 'inherit',
        textDecoration: 'none',
      })}
    >
      <Logo variant={variant} size={size} />
    </Box>
  );
}

// DS-07: the existing light / dark / system control, opened from a top-bar icon button.
function ThemeMenu() {
  const tScheme = useTranslations('patterns.colorScheme');
  const { colorScheme } = useColorScheme();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const id = useId();
  const open = anchor !== null;

  return (
    <>
      <IconButton
        aria-label={tScheme('label')}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        {colorScheme === 'dark' ? <LightModeOutlined /> : <DarkModeOutlined />}
      </IconButton>
      <Popover
        id={id}
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 1, p: 1.5 } } }}
      >
        <ColorSchemeControl />
      </Popover>
    </>
  );
}

type PlanKey = 'admin' | 'premium' | 'standard' | 'free';

function planOf(role: string, hasSubscription: boolean): PlanKey {
  if (role === 'admin') return 'admin';
  if (role === 'premium') return 'premium';
  if (role === 'standard' && hasSubscription) return 'standard';
  return 'free';
}

// DS-24: amber (secondary) is never text on light, so paid plans use primary
const PLAN_COLOR: Record<PlanKey, 'default' | 'primary' | 'success'> = {
  admin: 'primary',
  premium: 'success',
  standard: 'primary',
  free: 'default',
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

interface AccountMenuProps {
  name: string;
  email: string;
  plan: PlanKey;
  onSignOut: () => void;
}

function AccountMenu({ name, email, plan, onSignOut }: AccountMenuProps) {
  const t = useTranslations('patterns.appShell');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const id = useId();
  const open = anchor !== null;
  const close = () => setAnchor(null);
  const initials = initialsOf(name);

  return (
    <>
      <IconButton
        aria-label={t('account', { name })}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget)}
      >
        <Avatar
          aria-hidden
          sx={(theme) => ({
            ...theme.typography.subtitle2,
            width: theme.spacing(4.5),
            height: theme.spacing(4.5),
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
          })}
        >
          {initials || <PersonOutlined fontSize="small" />}
        </Avatar>
      </IconButton>
      <Popover
        id={id}
        open={open}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: (theme) => ({ mt: 1, minWidth: theme.spacing(29) }) } }}
      >
        {/* the plan chip lives in this header, not in the bar */}
        <Box
          sx={{
            px: 2,
            py: 1.5,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Typography variant="subtitle2">{name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {email}
          </Typography>
          <Chip
            label={t('plan', { plan })}
            color={PLAN_COLOR[plan]}
            size="small"
            variant="outlined"
            sx={{ alignSelf: 'flex-start' }}
          />
        </Box>
        <MenuList autoFocusItem={open} aria-label={t('account', { name })}>
          <MenuItem component={Link} href="/profile" onClick={close}>
            <ListItemIcon>
              <PersonOutlined fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('items.profile')}</ListItemText>
          </MenuItem>
          <MenuItem component={Link} href="/plans" onClick={close}>
            <ListItemIcon>
              <WorkspacePremiumOutlined fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('items.subscription')}</ListItemText>
          </MenuItem>
          <Divider />
          <MenuItem
            onClick={() => {
              close();
              onSignOut();
            }}
          >
            <ListItemIcon>
              <LogoutOutlined fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('signOut')}</ListItemText>
          </MenuItem>
        </MenuList>
      </Popover>
    </>
  );
}

function SkipLink() {
  const t = useTranslations('patterns.appShell');
  return (
    // DS-21: the first focusable element at every width; off-screen until focused
    <Box
      component="a"
      href={`#${MAIN_CONTENT_ID}`}
      sx={(theme) => ({
        ...theme.typography.button,
        position: 'absolute',
        top: theme.spacing(1),
        left: theme.spacing(1),
        zIndex: theme.zIndex.tooltip + 1,
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: theme.spacing(5.5),
        px: 2,
        borderRadius: 1,
        bgcolor: 'background.paper',
        color: 'primary.main',
        boxShadow: theme.shadows[4],
        textDecoration: 'none',
        transform: 'translateY(-200%)',
        '&:focus': { transform: 'none' },
      })}
    >
      {t('skipToContent')}
    </Box>
  );
}

export interface AppShellProps {
  children: ReactNode;
}

/**
 * The frame of every page in the (shell) route group (DESIGN.md §6, frame AppShellFrame): top bar,
 * sidebar / rail / drawer navigation and the single `<main>`. Signed out it is the guest top bar
 * (logo, theme, "Entrar") with no navigation.
 */
export default function AppShell({ children }: AppShellProps) {
  const t = useTranslations('patterns.appShell');
  const theme = useTheme();
  const router = useRouter();
  // DS-14: theme breakpoints only. JS only where behaviour differs (drawer vs rail vs sidebar,
  // tooltips, the pin); the navigation renders only once auth has resolved on the client, so
  // server markup never depends on these.
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const isLgUp = useMediaQuery(theme.breakpoints.up('lg'));
  const { user, loading, isAuthenticated, role, hasSubscription, logout } = useAuth();
  const counts = useCounts();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railPinned, setRailPinned] = useState(false);

  // read after mount: storage does not exist during server rendering
  useEffect(() => {
    setRailPinned(readRailPinned());
  }, []);

  // while auth loads, only the logo and theme show, so a member never sees "Entrar" flash
  const status = loading ? 'pending' : isAuthenticated && user ? 'member' : 'guest';
  const groups = status === 'member' ? visibleGroups(role) : [];
  const showReminders = groups.some((group) => group.items.some((item) => item.id === 'reminders'));
  const mode = isLgUp ? 'sidebar' : isMdUp ? 'rail' : 'drawer';
  const sidebarExpanded = mode === 'sidebar' || (mode === 'rail' && railPinned);

  const toggleRailPinned = () => {
    const next = !railPinned;
    setRailPinned(next);
    writeRailPinned(next);
  };

  const closeDrawer = () => setDrawerOpen(false);
  // stable, so it runs once each time the drawer content mounts (the drawer unmounts when closed)
  const focusOnMount = useCallback((node: HTMLButtonElement | null) => node?.focus(), []);

  // Sign-out is deterministic: the page (and its RequireAuthentication) unmounts first, so
  // clearing the user cannot trigger the guard's redirect to /login; once auth reports a guest,
  // the one navigation is to `/`.
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    setSigningOut(true);
    await logout();
  };
  useEffect(() => {
    if (signingOut && status === 'guest') router.push('/');
  }, [signingOut, status, router]);

  const upcomingReminders = counts.upcomingReminders;
  const remindersLabel = t('items.reminders');
  const remindersName =
    upcomingReminders !== undefined && formatCount(upcomingReminders) !== null
      ? t('upcomingReminders', { label: remindersLabel, count: upcomingReminders })
      : remindersLabel;

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <SkipLink />

      <AppBar
        position="sticky"
        color="inherit"
        elevation={0}
        sx={(theme) => ({
          bgcolor: 'background.paper',
          color: 'text.primary',
          // the border is inside the bar's height (56 / 64), so everything placed under the bar
          // (sidebar, search filters) offsets by theme.layout's value alone
          boxSizing: 'border-box',
          height: theme.layout.topbarCompactHeight,
          borderBottom: 1,
          borderColor: 'divider',
          [theme.breakpoints.up('md')]: { height: theme.layout.topbarHeight },
        })}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            height: '100%',
            px: { xs: 0.5, md: 2 },
          }}
        >
          {status === 'member' && mode === 'drawer' && (
            <IconButton
              aria-label={t('openMenu')}
              aria-expanded={drawerOpen}
              aria-controls={DRAWER_ID}
              onClick={() => setDrawerOpen(true)}
            >
              <MenuOutlined />
            </IconButton>
          )}
          {/* DS-13: the lockup would crowd a 360px bar, so below md only the mark shows. A
              theme-breakpoint display (DS-14), not useMediaQuery, so the server markup is already
              right and nothing swaps after hydration; display:none leaves one name exposed. */}
          <Box sx={{ display: { xs: 'flex', md: 'none' } }}>
            <HomeLink variant="mark" size={28} />
          </Box>
          <Box sx={{ display: { xs: 'none', md: 'flex' } }}>
            <HomeLink variant="lockup" size={32} />
          </Box>
          <Box sx={{ flex: 1 }} />
          <ThemeMenu />
          {status === 'member' && user && (
            <>
              {showReminders && (
                <IconButton component={Link} href="/reminders" aria-label={remindersName}>
                  <NotificationsOutlined />
                </IconButton>
              )}
              <AccountMenu
                name={user.name}
                email={user.email}
                plan={planOf(role, hasSubscription)}
                onSignOut={signOut}
              />
            </>
          )}
          {status === 'guest' && (
            <Button
              variant="contained"
              size="small"
              component={Link}
              href="/login"
              sx={{ ml: 0.5, mr: { xs: 1, md: 0 } }}
            >
              {t('signIn')}
            </Button>
          )}
        </Box>
      </AppBar>

      <Box sx={{ display: 'flex', flex: 1 }}>
        {status === 'member' && mode !== 'drawer' && (
          <Box
            component="nav"
            aria-label={t('navigation')}
            sx={(theme) => ({
              // pinning open pushes the content instead of overlaying it
              width: sidebarExpanded ? theme.layout.sidebarWidth : theme.layout.railWidth,
              flexShrink: 0,
              alignSelf: 'flex-start',
              position: 'sticky',
              top: theme.layout.topbarHeight,
              height: `calc(100dvh - ${theme.layout.topbarHeight}px)`,
              display: 'flex',
              flexDirection: 'column',
              overflowX: 'hidden',
              overflowY: 'auto',
              bgcolor: 'background.paper',
              borderRight: 1,
              borderColor: 'divider',
              transition: theme.transitions.create('width', {
                duration: theme.transitions.duration.shorter,
              }),
            })}
          >
            <Box sx={{ flex: 1, pt: sidebarExpanded ? 0 : 1.5, pb: 2 }}>
              <Navigation
                groups={groups}
                counts={counts}
                variant={sidebarExpanded ? 'full' : 'rail'}
              />
            </Box>
            {mode === 'rail' && (
              <Box sx={{ p: 1, display: 'flex', justifyContent: railPinned ? 'flex-start' : 'center' }}>
                {railPinned ? (
                  <Button
                    variant="text"
                    color="inherit"
                    onClick={toggleRailPinned}
                    startIcon={<KeyboardDoubleArrowLeftOutlined />}
                    sx={{ color: 'text.secondary' }}
                  >
                    {t('collapseMenu')}
                  </Button>
                ) : (
                  <Tooltip title={t('expandMenu')} placement="right">
                    <IconButton
                      aria-label={t('expandMenu')}
                      onClick={toggleRailPinned}
                      sx={{ color: 'text.secondary' }}
                    >
                      <KeyboardDoubleArrowRightOutlined />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            )}
          </Box>
        )}

        <Box component="main" id={MAIN_CONTENT_ID} tabIndex={-1} sx={{ flex: 1, minWidth: 0 }}>
          {signingOut ? null : children}
        </Box>
      </Box>

      {status === 'member' && mode === 'drawer' && (
        <Drawer
          variant="temporary"
          anchor="left"
          open={drawerOpen}
          onClose={closeDrawer}
          slotProps={{
            paper: {
              id: DRAWER_ID,
              role: 'dialog',
              'aria-modal': true,
              'aria-label': t('menu'),
              sx: (theme) => ({
                width: theme.spacing(37.5),
                maxWidth: '100%',
                // DS-09: a layer above the page, so raised in dark
                bgcolor: 'background.raised',
              }),
            },
          }}
        >
          <Box
            sx={(theme) => ({
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              height: theme.layout.topbarCompactHeight,
              pl: 1.5,
              pr: 0.5,
            })}
          >
            <HomeLink variant="lockup" size={28} onClick={closeDrawer} />
            {/* DS-21: focus lands here when the drawer opens; MUI traps it inside and returns it
                to the menu button on close */}
            <IconButton aria-label={t('closeMenu')} onClick={closeDrawer} ref={focusOnMount}>
              <CloseOutlined />
            </IconButton>
          </Box>
          <Box component="nav" aria-label={t('navigation')} sx={{ pb: 2 }}>
            <Navigation groups={groups} counts={counts} variant="full" onNavigate={closeDrawer} />
          </Box>
        </Drawer>
      )}
    </Box>
  );
}
