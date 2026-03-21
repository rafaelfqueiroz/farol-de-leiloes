'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Box,
  Tooltip,
  Popover,
  IconButton,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import SearchIcon from '@mui/icons-material/Search';
import FavoriteIcon from '@mui/icons-material/Favorite';
import CardMembershipIcon from '@mui/icons-material/CardMembership';
import NotificationsIcon from '@mui/icons-material/Notifications';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import MenuIcon from '@mui/icons-material/Menu';
import { useAuth } from '../contexts/AuthContext';
import { useSidebar } from '../contexts/SidebarContext';

interface SidebarProps {
  activeView?: string;
  onViewChange?: (view: string) => void;
}

const baseMenuItems = [
  { id: 'home', icon: <HomeIcon />, label: 'Inicio' },
  { id: 'search', icon: <SearchIcon />, label: 'Buscar' },
  { id: 'favorites', icon: <FavoriteIcon />, label: 'Favoritos' },
  { id: 'reminders', icon: <NotificationsIcon />, label: 'Lembretes' },
  { id: 'plans', icon: <CardMembershipIcon />, label: 'Planos' },
];

const adminSubMenuItems = [
  { id: 'admin-coupons', icon: <ConfirmationNumberIcon />, label: 'Cupons', path: '/admin/coupons' },
];

export default function Sidebar({ activeView = 'home', onViewChange }: SidebarProps) {
  const router = useRouter();
  const { role } = useAuth();
  const { isExpanded, toggleSidebar, sidebarWidth } = useSidebar();
  const [adminAnchorEl, setAdminAnchorEl] = useState<HTMLElement | null>(null);

  const menuItems = [
    ...baseMenuItems,
    ...(role === 'admin'
      ? [{ id: 'admin', icon: <AdminPanelSettingsIcon />, label: 'Admin' }]
      : []),
  ];

  const handleNavigation = (itemId: string) => {
    if (itemId === 'home') {
      router.push('/');
    } else if (itemId === 'search') {
      if (onViewChange) {
        onViewChange(itemId);
      } else {
        router.push('/search');
      }
    } else if (itemId === 'plans') {
      router.push('/plans');
    } else if (itemId === 'favorites') {
      if (onViewChange) {
        onViewChange(itemId);
      } else {
        router.push('/search?view=favorites');
      }
    } else if (itemId === 'reminders') {
      router.push('/reminders');
    } else {
      onViewChange?.(itemId);
    }
  };

  const handleAdminClick = (event: React.MouseEvent<HTMLElement>) => {
    setAdminAnchorEl(event.currentTarget);
  };

  const handleAdminSubMenuClick = (path: string) => {
    setAdminAnchorEl(null);
    router.push(path);
  };

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: sidebarWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: sidebarWidth,
          boxSizing: 'border-box',
          backgroundColor: '#5A6C7D',
          borderRight: '1px solid #B8BEBD',
          overflow: 'hidden',
          transition: 'width 0.3s ease',
        },
      }}
    >
      {/* Header with Logo and Toggle */}
      <Box
        sx={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: isExpanded ? 'space-between' : 'center',
          backgroundColor: '#2D3436',
          borderBottom: '1px solid #B8BEBD',
          px: isExpanded ? 2 : 0,
        }}
      >
        {isExpanded && (
          <Box
            component="span"
            sx={{
              color: 'white',
              fontWeight: 700,
              fontSize: 14,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            Farol dos Leilões
          </Box>
        )}
        <IconButton
          onClick={toggleSidebar}
          sx={{
            color: 'white',
            '&:hover': { backgroundColor: 'rgba(255,255,255,0.1)' },
          }}
        >
          {isExpanded ? <ChevronLeftIcon /> : <MenuIcon />}
        </IconButton>
      </Box>

      {/* Menu Items */}
      <List sx={{ py: 2, px: 1 }}>
        {menuItems.map((item) => (
          <ListItem key={item.id} disablePadding sx={{ mb: 1 }}>
            <Tooltip
              title={isExpanded ? '' : (item.id === 'admin' ? '' : item.label)}
              placement="right"
            >
              <ListItemButton
                onClick={item.id === 'admin' ? handleAdminClick : () => handleNavigation(item.id)}
                sx={{
                  borderRadius: 2,
                  minHeight: 48,
                  justifyContent: isExpanded ? 'initial' : 'center',
                  px: 2,
                  backgroundColor: activeView === item.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                  '&:hover': {
                    backgroundColor: 'rgba(255,255,255,0.15)',
                  },
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 0,
                    justifyContent: 'center',
                    color: 'white',
                    mr: isExpanded ? 2 : 0,
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                {isExpanded && (
                  <ListItemText
                    primary={item.label}
                    sx={{
                      '& .MuiListItemText-primary': {
                        color: 'white',
                        fontSize: 14,
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                      },
                    }}
                  />
                )}
              </ListItemButton>
            </Tooltip>
          </ListItem>
        ))}
      </List>

      {/* Admin Submenu Popover */}
      <Popover
        open={Boolean(adminAnchorEl)}
        anchorEl={adminAnchorEl}
        onClose={() => setAdminAnchorEl(null)}
        anchorOrigin={{ vertical: 'center', horizontal: 'right' }}
        transformOrigin={{ vertical: 'center', horizontal: 'left' }}
        sx={{
          '& .MuiPopover-paper': {
            backgroundColor: '#5A6C7D',
            borderRadius: 2,
            ml: 0.5,
            minWidth: 160,
          },
        }}
      >
        <List sx={{ py: 0.5 }}>
          {adminSubMenuItems.map((subItem) => (
            <ListItem key={subItem.id} disablePadding>
              <ListItemButton
                onClick={() => handleAdminSubMenuClick(subItem.path)}
                sx={{
                  px: 2,
                  py: 1,
                  '&:hover': {
                    backgroundColor: 'rgba(255,255,255,0.15)',
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 32, color: 'white' }}>
                  {subItem.icon}
                </ListItemIcon>
                <ListItemText
                  primary={subItem.label}
                  sx={{ '& .MuiListItemText-primary': { color: 'white', fontSize: 14 } }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Popover>
    </Drawer>
  );
}
