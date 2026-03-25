import { createTheme } from '@mui/material/styles';

// V2 Color Palette
const colors = {
  maroon: '#5E0006',
  red: '#9B0F06',
  beige: '#EED9B9',
  black: '#091413',
  white: '#FFF8F0',
  offWhite: '#FFF4EA',
};
//beige: '#EED9B9',
const theme = createTheme({
  palette: {
    primary: {
      main: colors.red,
      dark: colors.maroon,
      light: colors.beige,
      contrastText: colors.white,
    },
    secondary: {
      main: colors.beige,
      light: colors.white,
      contrastText: colors.black,
    },
    text: {
      primary: colors.black,
      secondary: 'rgba(9, 20, 19, 0.6)',
    },
    background: {
      default: '#FFFFFF',
      paper: '#FFFFFF',
    },
    divider: colors.beige,
    grey: {
      100: colors.white,
      200: colors.beige,
      300: colors.beige,
      400: 'rgba(9, 20, 19, 0.4)',
      500: 'rgba(9, 20, 19, 0.6)',
      600: colors.red,
      700: colors.black,
    },
    error: {
      main: '#D32F2F',
    },
    success: {
      main: '#4CAF50',
    },
  },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    h1: {
      fontWeight: 700,
      color: colors.black,
    },
    h2: {
      fontWeight: 600,
      color: colors.black,
    },
    h3: {
      fontWeight: 600,
      color: colors.black,
    },
    h4: {
      fontWeight: 600,
      color: colors.black,
    },
    h5: {
      fontWeight: 600,
      color: colors.black,
    },
    h6: {
      fontWeight: 600,
      color: colors.black,
    },
    body1: {
      color: 'rgba(9, 20, 19, 0.6)',
    },
    body2: {
      color: 'rgba(9, 20, 19, 0.6)',
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
          backgroundColor: colors.red,
          '&:hover': {
            backgroundColor: colors.maroon,
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: '1px solid #FFF8F0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 8,
            '&:hover fieldset': {
              borderColor: colors.red,
            },
            '&.Mui-focused fieldset': {
              borderColor: colors.red,
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
          backgroundColor: colors.red,
          color: colors.white,
        },
      },
    },
  },
});

export default theme;
