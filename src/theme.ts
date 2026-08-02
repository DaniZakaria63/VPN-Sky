export interface AppColors {
  primary: string;
  secondary: string;
  tertiary: string;
  background: string;
  surface: string;
  surfaceVariant: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
}

export interface AppTheme extends AppColors {
  isDark: boolean;
}

export const lightColors: AppColors = {
  primary: '#6650A4',
  secondary: '#625B71',
  tertiary: '#7D5260',
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceVariant: '#E7E0EC',
  onSurface: '#1C1B1F',
  onSurfaceVariant: '#49454F',
  outline: '#79747E',
};

export const darkColors: AppColors = {
  primary: '#D0BCFF',
  secondary: '#CCC2DC',
  tertiary: '#EFB8C8',
  background: '#1C1B1F',
  surface: '#1C1B1F',
  surfaceVariant: '#49454F',
  onSurface: '#E6E1E5',
  onSurfaceVariant: '#CAC4D0',
  outline: '#938F99',
};

export const accentColors = {
  green: '#34BBF7',
  connecting: '#FF9F0A',
  error: '#FF3B30',
} as const;

export function getTheme(isDark: boolean): AppTheme {
  return isDark
    ? { ...darkColors, isDark }
    : { ...lightColors, isDark };
}