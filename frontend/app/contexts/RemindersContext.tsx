'use client';

import { createContext, useContext, useState, useRef, ReactNode, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useReloadOnUserChange } from './use-reload-on-user-change';
import { reportClientError } from '@/lib/report-client-error';

export type ReminderChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';
export type ReminderStatus = 'PENDING' | 'SENT';

export interface Reminder {
  _id: string;
  channel: ReminderChannel;
  scheduledAt: string;
  description: string | null;
  status: ReminderStatus;
  createdAt: string;
  auction: {
    _id: string;
    code: string;
    title: string | null;
    city: string | null;
    state: string | null;
    detailsUrl: string | null;
  };
}

export interface CreateReminderData {
  auctionId: string;
  channel: ReminderChannel;
  scheduledAt: string;
  description?: string;
}

export interface UpdateReminderData {
  channel?: ReminderChannel;
  scheduledAt?: string;
  description?: string;
}

interface RemindersContextType {
  reminders: Reminder[];
  loading: boolean;
  hasReminderForAuction: (auctionCode: string) => boolean;
  getReminderForAuction: (auctionCode: string) => Reminder | undefined;
  createReminder: (data: CreateReminderData) => Promise<Reminder | null>;
  updateReminder: (id: string, data: UpdateReminderData) => Promise<boolean>;
  deleteReminder: (id: string) => Promise<boolean>;
  refreshReminders: () => Promise<void>;
}

const RemindersContext = createContext<RemindersContextType | undefined>(undefined);

export function RemindersProvider({ children }: { children: ReactNode }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('token');
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  };

  // #42: only the latest load (or clear) may write, so a slow response for a previous user
  // cannot overwrite the current one's reminders
  const latestRequest = useRef(0);
  // #42: bumped on every account change (sign-out, another user). A mutation started under an
  // older generation must not touch state: its response belongs to the previous account.
  const accountGeneration = useRef(0);

  const loadReminders = useCallback(async () => {
    const request = ++latestRequest.current;
    const isLatest = () => request === latestRequest.current;
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setReminders([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      const response = await fetch('/api/reminders', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        if (isLatest()) setReminders(data);
      } else if (response.status === 401 && isLatest()) {
        setReminders([]);
      }
    } catch (error) {
      if (isLatest()) reportClientError(error, { where: 'RemindersContext.load' });
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, []);

  const clearReminders = useCallback(() => {
    latestRequest.current++;
    accountGeneration.current++;
    setReminders([]);
    setLoading(false);
  }, []);

  // #42: fetch at once when a token exists, reload on a change of user, clear on sign-out, so
  // the AppShell's Lembretes count matches the page
  useReloadOnUserChange(loadReminders, clearReminders);

  const hasReminderForAuction = (auctionCode: string): boolean => {
    return reminders.some((r) => r.auction.code === auctionCode);
  };

  const getReminderForAuction = (auctionCode: string): Reminder | undefined => {
    return reminders.find((r) => r.auction.code === auctionCode);
  };

  const createReminder = async (data: CreateReminderData): Promise<Reminder | null> => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return null;
    }
    const generation = accountGeneration.current;
    const sameAccount = () => generation === accountGeneration.current;

    try {
      const response = await fetch('/api/reminders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(data),
      });

      // #42: started by an account that has since signed out — its response is not this one's
      if (!sameAccount()) return null;

      if (response.ok) {
        const newReminder = await response.json();
        if (!sameAccount()) return null;
        setReminders((prev) => [...prev, newReminder]);
        return newReminder;
      } else if (response.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
      } else {
        reportClientError(new Error(`Creating a reminder failed with HTTP ${response.status}`), {
          where: 'RemindersContext.createReminder',
        });
      }
    } catch (error) {
      reportClientError(error, { where: 'RemindersContext.createReminder' });
    }

    return null;
  };

  const updateReminder = async (id: string, data: UpdateReminderData): Promise<boolean> => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return false;
    }
    const generation = accountGeneration.current;
    const sameAccount = () => generation === accountGeneration.current;

    try {
      const response = await fetch(`/api/reminders/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(data),
      });

      // #42: started by an account that has since signed out — its response is not this one's
      if (!sameAccount()) return false;

      if (response.ok) {
        const updatedReminder = await response.json();
        if (!sameAccount()) return false;
        setReminders((prev) => prev.map((r) => (r._id === id ? updatedReminder : r)));
        return true;
      } else if (response.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
      } else {
        reportClientError(new Error(`Updating a reminder failed with HTTP ${response.status}`), {
          where: 'RemindersContext.updateReminder',
        });
      }
    } catch (error) {
      reportClientError(error, { where: 'RemindersContext.updateReminder' });
    }

    return false;
  };

  const deleteReminder = async (id: string): Promise<boolean> => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return false;
    }
    const generation = accountGeneration.current;
    const sameAccount = () => generation === accountGeneration.current;

    try {
      const response = await fetch(`/api/reminders/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      // #42: started by an account that has since signed out — its response is not this one's
      if (!sameAccount()) return false;

      if (response.ok || response.status === 204) {
        setReminders((prev) => prev.filter((r) => r._id !== id));
        return true;
      } else if (response.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
      }
    } catch (error) {
      reportClientError(error, { where: 'RemindersContext.deleteReminder' });
    }

    return false;
  };

  const refreshReminders = async () => {
    setLoading(true);
    await loadReminders();
  };

  return (
    <RemindersContext.Provider
      value={{
        reminders,
        loading,
        hasReminderForAuction,
        getReminderForAuction,
        createReminder,
        updateReminder,
        deleteReminder,
        refreshReminders,
      }}
    >
      {children}
    </RemindersContext.Provider>
  );
}

export function useReminders() {
  const context = useContext(RemindersContext);
  if (context === undefined) {
    throw new Error('useReminders must be used within a RemindersProvider');
  }
  return context;
}
