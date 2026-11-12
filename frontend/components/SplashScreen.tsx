"use client";

interface SplashScreenProps {
  isLoading: boolean;
}

/**
 * Вимкнено блокуючий повноекранний сплэш-оверлей:
 * у PWA використовується нативний системний екран запуску ОС,
 * а розклад миттєво читається з localStorage без затримки в 1 секунду.
 */
export function SplashScreen(_props: SplashScreenProps) {
  return null;
}
