'use client';

import { useRouter } from 'next/navigation';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  Box,
  Tooltip,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import SearchIcon from '@mui/icons-material/Search';
import FavoriteIcon from '@mui/icons-material/Favorite';

const DRAWER_WIDTH = 72;

interface SidebarProps {
  activeView?: string;
  onViewChange?: (view: string) => void;
}

const menuItems = [
  { id: 'home', icon: <HomeIcon />, label: 'Início', color: '#5A6C7D' },
  { id: 'search', icon: <SearchIcon />, label: 'Buscar', color: '#5A6C7D' },
  { id: 'favorites', icon: <FavoriteIcon />, label: 'Favoritos', color: '#5A6C7D' },
];

export default function Sidebar({ activeView = 'home', onViewChange }: SidebarProps) {
  const router = useRouter();

  const handleNavigation = (itemId: string) => {
    if (itemId === 'home') {
      router.push('/');
    } else if (itemId === 'search') {
      router.push('/search');
    } else {
      onViewChange?.(itemId);
    }
  };

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: DRAWER_WIDTH,
          boxSizing: 'border-box',
          backgroundColor: '#5A6C7D', // Steel Blue
          borderRight: '1px solid #B8BEBD',
          overflow: 'hidden',
        },
      }}
    >
      {/* Logo */}
      <Box
        sx={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#2D3436', // Dark Charcoal
          borderBottom: '1px solid #B8BEBD',
        }}
      >
        <HomeIcon sx={{ color: 'white', fontSize: 32 }} />
      </Box>

      {/* Menu Items */}
      <List sx={{ py: 2, px: 1 }}>
        {menuItems.map((item) => (
          <ListItem key={item.id} disablePadding sx={{ mb: 1 }}>
            <Tooltip title={item.label} placement="right">
              <ListItemButton
                onClick={() => handleNavigation(item.id)}
                sx={{
                  borderRadius: 2,
                  minHeight: 48,
                  justifyContent: 'center',
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
                  }}
                >
                  {item.icon}
                </ListItemIcon>
              </ListItemButton>
            </Tooltip>
          </ListItem>
        ))}
      </List>
    </Drawer>
  );
}
