'use client';

import { AppBar, Toolbar, Typography, Box, Avatar, IconButton, Menu, MenuItem, Button, Chip } from '@mui/material';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';
import { useSidebar } from '../contexts/SidebarContext';

export default function TopBar() {
  const router = useRouter();
  const { user, logout, isAuthenticated, role, hasSubscription } = useAuth();
  const { sidebarWidth } = useSidebar();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    handleClose();
    await logout();
    router.push('/');
  };

  const getPlanLabel = () => {
    if (role === 'admin') return 'Admin';
    if (role === 'standard' && hasSubscription) return 'Standard';
    if (role === 'premium') return 'Premium';
    return 'Gratuito';
  };

  const getPlanColor = (): 'default' | 'primary' | 'secondary' | 'success' => {
    if (role === 'admin') return 'secondary';
    if (role === 'standard' && hasSubscription) return 'primary';
    if (role === 'premium') return 'success';
    return 'default';
  };

  const getUserInitials = () => {
    if (!user?.name) return '?';
    const names = user.name.split(' ');
    if (names.length >= 2) {
      return (names[0][0] + names[names.length - 1][0]).toUpperCase();
    }
    return names[0][0].toUpperCase();
  };

  return (
    <AppBar
      position="fixed"
      elevation={0}
      sx={{
        backgroundColor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        left: sidebarWidth,
        width: `calc(100% - ${sidebarWidth}px)`,
        transition: 'left 0.3s ease, width 0.3s ease',
      }}
    >
      <Toolbar sx={{ justifyContent: 'space-between' }}>
        {/* App Title */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            component="span"
            sx={{
              fontSize: 20,
              fontWeight: 700,
              color: 'text.primary',
            }}
          >
            🏠 Farol dos leilões
          </Box>
        </Box>

        {/* User Profile */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {isAuthenticated && user ? (
            <>
              <Chip
                label={getPlanLabel()}
                color={getPlanColor()}
                size="small"
                variant="outlined"
                sx={{ fontWeight: 600, fontSize: 11 }}
              />
              <IconButton
                onClick={handleClick}
                sx={{
                  p: 0.5,
                  '&:hover': {
                    backgroundColor: 'action.hover',
                  },
                }}
              >
                <Avatar
                  sx={{
                    width: 36,
                    height: 36,
                    backgroundColor: 'primary.main',
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  {getUserInitials()}
                </Avatar>
              </IconButton>

              <Menu
                anchorEl={anchorEl}
                open={open}
                onClose={handleClose}
                PaperProps={{
                  elevation: 3,
                  sx: {
                    mt: 1.5,
                    minWidth: 200,
                    borderRadius: 2,
                  },
                }}
                transformOrigin={{ horizontal: 'right', vertical: 'top' }}
                anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
              >
                <MenuItem disabled>
                  <Typography variant="body2" fontWeight={600} color="text.primary">
                    {user.name}
                  </Typography>
                </MenuItem>
                <MenuItem onClick={() => { handleClose(); router.push('/profile'); }}>
                  Perfil
                </MenuItem>
                <MenuItem onClick={() => { handleClose(); router.push('/plans'); }}>
                  Planos
                </MenuItem>
                <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
                  Sair
                </MenuItem>
              </Menu>
            </>
          ) : (
            <Button
              variant="contained"
              size="small"
              onClick={() => router.push('/login')}
            >
              Entrar
            </Button>
          )}
        </Box>
      </Toolbar>
    </AppBar>
  );
}
