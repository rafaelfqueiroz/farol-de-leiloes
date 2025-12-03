import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    primary: {
      main: '#5A6C7D', // Steel Blue
      dark: '#2D3436', // Dark Charcoal
      light: '#B8BEBD', // Medium Gray
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#E8DCC8', // Warm Beige
      light: '#FAFAF9', // Off White
      contrastText: '#2D3436',
    },
    text: {
      primary: '#2D3436', // Dark Charcoal
      secondary: '#6B7280', // Cool Gray
    },
    background: {
      default: '#FAFAF9', // Off White
      paper: '#FFFFFF',
    },
    divider: '#B8BEBD', // Medium Gray
    grey: {
      100: '#FAFAF9',
      200: '#E8DCC8',
      300: '#B8BEBD',
      400: '#95A5A6',
      500: '#6B7280',
      600: '#5A6C7D',
      700: '#2D3436',
    },
  },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    h1: {
      fontWeight: 700,
      color: '#2D3436',
    },
    h2: {
      fontWeight: 600,
      color: '#2D3436',
    },
    h3: {
      fontWeight: 600,
      color: '#2D3436',
    },
    h4: {
      fontWeight: 600,
      color: '#2D3436',
    },
    h5: {
      fontWeight: 600,
      color: '#2D3436',
    },
    h6: {
      fontWeight: 600,
      color: '#2D3436',
    },
    body1: {
      color: '#6B7280',
    },
    body2: {
      color: '#6B7280',
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 8,
          fontWeight: 500,
        },
        contained: {
          boxShadow: 'none',
          '&:hover': {
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          },
        },
        containedPrimary: {
          backgroundColor: '#5A6C7D',
          '&:hover': {
            backgroundColor: '#2D3436',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: '1px solid #B8BEBD',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 8,
            '& fieldset': {
              borderColor: '#B8BEBD',
            },
            '&:hover fieldset': {
              borderColor: '#5A6C7D',
            },
            '&.Mui-focused fieldset': {
              borderColor: '#5A6C7D',
            },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 16,
        },
        filled: {
          backgroundColor: '#5A6C7D',
          color: '#FFFFFF',
        },
      },
    },
  },
});

export default theme;
