// Helpers for formatting message times and date separators.

export const formatMessageTime = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
};

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const formatDateSeparator = (iso: string): string => {
  const msgDay = startOfDay(new Date(iso));
  const today = startOfDay(new Date());
  const diffDays = Math.round((today.getTime() - msgDay.getTime()) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7 && diffDays > 0) {
    return msgDay.toLocaleDateString([], { weekday: 'long' });
  }
  return msgDay.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

export const isSameDay = (a: string, b: string) => {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};
