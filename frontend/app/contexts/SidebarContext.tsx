'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export const SIDEBAR_WIDTH_COLLAPSED = 72;
export const SIDEBAR_WIDTH_EXPANDED = 240;

interface SidebarContextType {
  isExpanded: boolean;
  toggleSidebar: () => void;
  sidebarWidth: number;
}

const SidebarContext = createContext<SidebarContextType>({
  isExpanded: true,
  toggleSidebar: () => {},
  sidebarWidth: SIDEBAR_WIDTH_EXPANDED,
});

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(true);

  const toggleSidebar = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const sidebarWidth = isExpanded ? SIDEBAR_WIDTH_EXPANDED : SIDEBAR_WIDTH_COLLAPSED;

  return (
    <SidebarContext.Provider value={{ isExpanded, toggleSidebar, sidebarWidth }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
