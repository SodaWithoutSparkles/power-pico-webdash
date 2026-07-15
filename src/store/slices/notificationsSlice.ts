import type { StoreSlice } from '../storeTypes';

export const createNotificationsSlice: StoreSlice = (set, get) => ({
    notifications: [],
    addNotification: (notification) => {
        const id = notification.id ?? Math.random().toString(36).slice(2, 10);
        const existing = get().notifications.find((n) => n.id === id);
        if (existing) {
            // Dedup: bump count so component remounts with fresh dismiss timer
            set((state) => ({
                notifications: state.notifications.map((n) =>
                    n.id === id
                        ? { ...n, count: (n.count ?? 1) + 1 }
                        : n,
                ),
            }));
        } else {
            set((state) => ({
                notifications: [
                    ...state.notifications,
                    { ...notification, id, count: 0 },
                ],
            }));
        }
        return id;
    },
    removeNotification: (id) => set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id)
    })),
    clearNotifications: () => set({ notifications: [] })
});
