'use client';

import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import SettingsBrightnessOutlined from '@mui/icons-material/SettingsBrightnessOutlined';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { useColorScheme } from '@mui/material/styles';
import { useTranslations } from 'next-intl';

const modes = [
  { mode: 'light', Icon: LightModeOutlined },
  { mode: 'dark', Icon: DarkModeOutlined },
  { mode: 'system', Icon: SettingsBrightnessOutlined },
] as const;

type Mode = (typeof modes)[number]['mode'];

export interface ColorSchemeControlProps {
  fullWidth?: boolean;
}

// DS-07: light, dark or system; the choice is persisted by MUI's ThemeProvider.
export default function ColorSchemeControl({ fullWidth = false }: ColorSchemeControlProps) {
  const t = useTranslations('patterns.colorScheme');
  const { mode, setMode } = useColorScheme();
  // `mode` is undefined until the provider has read the stored choice after hydration
  const ready = mode !== undefined;

  return (
    <ToggleButtonGroup
      exclusive
      fullWidth={fullWidth}
      value={mode ?? null}
      disabled={!ready}
      aria-label={t('label')}
      onChange={(_, next: Mode | null) => {
        if (next) setMode(next);
      }}
    >
      {modes.map(({ mode: value, Icon }) => (
        <ToggleButton key={value} value={value} sx={{ gap: 1 }}>
          <Icon fontSize="small" />
          {t(value)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
