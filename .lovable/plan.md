## What I found

### Where blocking is implemented
- `src/hooks/useBlockedUsers.ts` — `blockUser()` inserts into `blocked_users`, `unblockUser()` deletes, `isBlocked(userId)` checks the local list.
- `src/pages/Matched.tsx` — `handleBlockUser()` (line ~259) and match filtering at line 89: `matches.filter(match => !blockedUsers.includes(match.userId))`.
- `src/pages/Chat.tsx` — already has `isOtherUserBlocked`, a blocked banner (line ~388), disabled composer, and `handleBlockUser` / `handleUnblockUser`.

### Why the chat disappears from "My Chats" (the exact cause)
`src/pages/Chats.tsx` does **not** filter blocked users itself. The list comes from `useAcceptedCompanions()` (`src/hooks/useAcceptedCompanions.ts`), which queries `requests` where `status = 'accepted'`.

The hiding happens in the database, in the `requests` SELECT policy (migration `20260106151017_...sql`, section 2c):

```sql
CREATE POLICY "Users can view requests they sent or received"
ON public.requests FOR SELECT
USING (
  (auth.uid() = from_user_id OR auth.uid() = to_user_id)
  AND NOT public.is_blocked(from_user_id, to_user_id)
);
```

Once a block row exists, `is_blocked()` returns true, the accepted request rows vanish from the query, `companions` becomes empty, and `Chats.tsx` renders the "No accepted companions yet" empty state. The conversation itself is untouched — the `conversations` SELECT policy is participant-based only (no block check), so the conversation row **is still readable**.

### Why there's no way to unblock
The only unblock entry point lives inside `Chat.tsx`, which is unreachable once the row disappears from `Chats.tsx`. `Matched.tsx` also filters blocked users out of matches, so there is no other surface exposing `unblockUser()`.

## Implementation plan (frontend only, no DB/Supabase changes)

1. **`src/pages/Chats.tsx` — build the list from two sources.**
   Keep `useAcceptedCompanions()` as the primary source, and additionally derive entries from `conversations` (already fetched by `useChat()`) whose other participant is in `blockedUsers`. Merge by `otherUserId`, preferring the companion record when both exist. This restores blocked chats without any policy change, since conversations stay visible.

2. **Read block state in `Chats.tsx`** via `useBlockedUsers()` (`blockedUsers`, `unblockUser`). Derive names/train/date for blocked-only rows from `conversation.participant_names`, `train_number`, `travel_date`.

3. **Mark blocked rows in the list UI** with a small "Blocked" chip next to the name, keeping the existing card layout, glow, unread badge and click-to-open behaviour intact.

4. **Ensure the chat opens for blocked rows.** For blocked entries, navigate directly to the existing `conversationId` and skip `createConversation()` (the INSERT policy rejects blocked pairs), so no error toast can occur.

5. **`src/pages/Chat.tsx` — verify and keep current behaviour**: banner shown when blocked, composer + attachment button disabled, menu item toggles between "Block User" and "Unblock User", unblock removes the row from `blocked_users` and restores the input. No changes expected here beyond confirming the state updates re-enable the composer immediately.

6. **Optional secondary unblock surface**: add "Unblock" to the blocked chat row's overflow/banner in `Chats.tsx` so users can unblock without opening the chat.

7. **Regression check**: non-blocked chats, unread counts, deleted chats (`deleted_for`), empty state, and Matched-page filtering must all behave exactly as today.

### Technical notes
- No migration, RLS, auth, env, or schema change is required — the fix relies on `conversations` remaining readable to participants.
- Server-side blocking stays enforced: message INSERT is still rejected by `is_blocked_in_conversation()`, so a blocked user cannot send even if the UI were bypassed.
- Accepted-request metadata (train/date) may be unavailable for blocked rows because the `requests` rows are hidden; the conversation's own `train_number` / `travel_date` columns are used as the fallback.
