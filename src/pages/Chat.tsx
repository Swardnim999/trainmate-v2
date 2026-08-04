import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  ArrowLeft, Send, MoreVertical, Ban, AlertTriangle, Trash2,
  Smile, Paperclip, Image as ImageIcon, FileText, Check, CheckCheck, X,
  Download,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useChat, AttachmentInput } from '@/hooks/useChat';
import { usePresence } from '@/hooks/usePresence';
import { useBlockedUsers } from '@/hooks/useBlockedUsers';
import { TypingIndicator } from '@/components/TypingIndicator';
import { ReportDialog } from '@/components/ReportDialog';
import { SkeletonMessage } from '@/components/SkeletonCard';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import EmojiPicker, { Theme, EmojiClickData } from 'emoji-picker-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatMessageTime, formatDateSeparator, isSameDay } from '@/lib/chatFormat';
import dashboardBg from '@/assets/dashboard-bg.png';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
const ALLOWED_FILE_EXT = ['pdf', 'doc', 'docx', 'txt'];

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const Chat = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const location = useLocation();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newMessage, setNewMessage] = useState('');
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [showUnblockConfirm, setShowUnblockConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<AttachmentInput | null>(null);
  const [uploading, setUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const { otherUser, trainNumber, travelDate } = location.state || {};
  const otherUserId = otherUser?.id;

  const {
    messages, sendMessage, markAsRead, loading, deleteChat,
    uploadAttachment, otherUserLastRead,
  } = useChat(conversationId, otherUserId);
  const { typingUsers, sendTypingIndicator, isUserOnline } = usePresence(conversationId);
  const { blockUser, unblockUser, isBlocked } = useBlockedUsers();

  const isOtherUserBlocked = otherUserId ? isBlocked(otherUserId) : false;

  useEffect(() => {
    document.body.classList.add('dashboard-body');
    document.body.style.backgroundImage = `url(${dashboardBg})`;
    return () => {
      document.body.classList.remove('dashboard-body');
      document.body.style.backgroundImage = '';
    };
  }, []);

  useEffect(() => {
    if (conversationId && user) markAsRead(conversationId);
  }, [conversationId, user, markAsRead]);

  // Auto-scroll on open and on every new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, typingUsers.length]);

  // Mark as read again whenever a new message arrives while chat is open
  useEffect(() => {
    if (!conversationId || !user || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.sender_id !== user.id) {
      markAsRead(conversationId);
    }
  }, [messages, conversationId, user, markAsRead]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    sendTypingIndicator();
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOtherUserBlocked || !conversationId) return;
    if (!newMessage.trim() && !pendingAttachment) return;

    const text = newMessage;
    const attachment = pendingAttachment;
    setNewMessage('');
    setPendingAttachment(null);

    try {
      await sendMessage(conversationId, text, attachment || undefined);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.message || 'Failed to send message. Please try again.',
        variant: 'destructive',
      });
      // Restore on failure
      setNewMessage(text);
      setPendingAttachment(attachment);
    }
  };

  const handleEmojiSelect = (data: EmojiClickData) => {
    setNewMessage((prev) => prev + data.emoji);
    setEmojiOpen(false);
  };

  const handlePickImage = () => imageInputRef.current?.click();
  const handlePickFile = () => fileInputRef.current?.click();

  const uploadAndAttach = async (file: File, kind: 'image' | 'file') => {
    if (!conversationId) return;
    if (file.size > MAX_FILE_BYTES) {
      toast({ title: 'File too large', description: 'Maximum size is 10 MB.', variant: 'destructive' });
      return;
    }
    if (kind === 'file') {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (!ALLOWED_FILE_TYPES.includes(file.type) && !ALLOWED_FILE_EXT.includes(ext)) {
        toast({
          title: 'Unsupported file',
          description: 'Only PDF, DOCX, DOC, and TXT files are allowed.',
          variant: 'destructive',
        });
        return;
      }
    }
    setUploading(true);
    try {
      const attachment = await uploadAttachment(conversationId, file);
      setPendingAttachment(attachment);
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err?.message || 'Try again.', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleBlockUser = async () => {
    if (!otherUserId) return;
    const success = await blockUser(otherUserId);
    if (success) {
      toast({ title: 'User blocked', description: 'You will no longer receive messages from them.' });
      setShowBlockConfirm(false);
    } else {
      toast({ title: 'Error', description: 'Failed to block user. Please try again.', variant: 'destructive' });
    }
  };

  const handleUnblockUser = async () => {
    if (!otherUserId) return;
    const success = await unblockUser(otherUserId);
    if (success) {
      toast({ title: 'User unblocked', description: 'You can now message this user again.' });
      setShowUnblockConfirm(false);
    } else {
      toast({ title: 'Error', description: 'Failed to unblock user. Please try again.', variant: 'destructive' });
    }
  };

  const handleDeleteChat = async () => {
    if (!conversationId) return;
    try {
      await deleteChat(conversationId);
      setShowDeleteConfirm(false);
      toast({ title: 'Chat deleted' });
      navigate('/chats', { replace: true });
    } catch (error) {
      setShowDeleteConfirm(false);
      toast({ title: 'Error', description: 'Failed to delete chat. Please try again.', variant: 'destructive' });
    }
  };

  if (!conversationId || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card>
          <CardContent className="p-6">
            <p>Invalid chat. Please go back to your chats.</p>
            <Button onClick={() => navigate('/chats', { replace: true })} className="mt-4">
              Go to Chats
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isOnline = otherUserId ? isUserOnline(otherUserId) : false;
  const otherReadAt = otherUserLastRead ? new Date(otherUserLastRead).getTime() : 0;

  return (
    <div className="dashboard-bg h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <div className="relative z-10 px-4 pt-4 pb-2 shrink-0">
        <div className="max-w-4xl mx-auto">
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-lg px-4 py-3 flex items-center gap-3">
            <button onClick={() => navigate('/chats', { replace: true })} className="glass-icon-button shrink-0">
              <ArrowLeft className="h-5 w-5 text-white/80" />
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold text-white truncate">
                  {otherUser?.name || 'Travel Companion'}
                </h1>
                {otherUserId && (
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${isOnline ? 'bg-blue-400' : 'bg-gray-500'}`} />
                    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isOnline ? 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]' : 'bg-gray-500'}`} />
                  </span>
                )}
                <span className="text-xs text-white/40">{isOnline ? 'Online' : 'Offline'}</span>
              </div>
              <p className="text-xs text-white/40 mt-0.5">Train {trainNumber} • {travelDate}</p>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="glass-icon-button shrink-0">
                  <MoreVertical className="h-5 w-5 text-white/80" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-black/60 backdrop-blur-xl border border-white/10 text-white">
                <DropdownMenuItem onClick={() => setShowDeleteConfirm(true)} className="focus:bg-white/10 focus:text-white">
                  <Trash2 className="h-4 w-4 mr-2" />Delete Chat
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem onClick={() => setShowReportDialog(true)} className="text-amber-400 focus:bg-white/10 focus:text-amber-400">
                  <AlertTriangle className="h-4 w-4 mr-2" />Report User
                </DropdownMenuItem>
                {isOtherUserBlocked ? (
                  <DropdownMenuItem onClick={() => setShowUnblockConfirm(true)} className="focus:bg-white/10 focus:text-white">
                    <Ban className="h-4 w-4 mr-2" />Unblock User
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => setShowBlockConfirm(true)} className="text-red-400 focus:bg-white/10 focus:text-red-400">
                    <Ban className="h-4 w-4 mr-2" />Block User
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto relative z-10 px-4 py-6 min-h-0">
        <div className="max-w-4xl mx-auto space-y-3">
          {loading && messages.length === 0 ? (
            <>
              <SkeletonMessage />
              <SkeletonMessage isOwn />
              <SkeletonMessage />
            </>
          ) : messages.length === 0 ? (
            <div className="text-center text-white/40 py-16">
              <p className="text-sm">No messages yet. Start the conversation!</p>
            </div>
          ) : (
            messages.map((message, idx) => {
              const isOwn = message.sender_id === user.id;
              const prev = messages[idx - 1];
              const showDateSeparator = !prev || !isSameDay(prev.created_at, message.created_at);

              const sentAt = new Date(message.created_at).getTime();
              const isRead = isOwn && otherReadAt >= sentAt;

              return (
                <div key={message.id}>
                  {showDateSeparator && (
                    <div className="flex justify-center my-4">
                      <span className="text-[11px] uppercase tracking-wider text-white/50 bg-white/5 backdrop-blur-md border border-white/10 px-3 py-1 rounded-full">
                        {formatDateSeparator(message.created_at)}
                      </span>
                    </div>
                  )}

                  <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`
                        max-w-xs lg:max-w-md px-3 py-2 rounded-2xl transition-all duration-200 ease-out cursor-default
                        ${isOwn
                          ? 'bg-gradient-to-br from-blue-500/80 to-blue-700/80 shadow-lg hover:shadow-[0_0_20px_rgba(59,130,246,0.35)]'
                          : 'bg-white/5 backdrop-blur-md border border-white/10 shadow-md hover:bg-white/8'
                        }
                      `}
                    >
                      {/* Image attachment */}
                      {message.attachment_url && message.attachment_type?.startsWith('image/') && (
                        <button
                          type="button"
                          onClick={() => setLightboxUrl(message.attachment_url!)}
                          className="block mb-1 rounded-xl overflow-hidden border border-white/10 max-w-[260px]"
                        >
                          <img
                            src={message.attachment_url}
                            alt={message.attachment_name || 'image'}
                            className="block w-full h-auto max-h-[300px] object-cover"
                            loading="lazy"
                          />
                        </button>
                      )}

                      {/* File attachment */}
                      {message.attachment_url && !message.attachment_type?.startsWith('image/') && (
                        <a
                          href={message.attachment_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          download={message.attachment_name || true}
                          className="flex items-center gap-3 mb-1 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 transition-colors"
                        >
                          <div className="shrink-0 w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
                            <FileText className="h-5 w-5 text-white/80" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-white truncate">{message.attachment_name || 'File'}</p>
                            {message.attachment_size != null && (
                              <p className="text-[11px] text-white/50">{formatBytes(message.attachment_size)}</p>
                            )}
                          </div>
                          <Download className="h-4 w-4 text-white/60 shrink-0" />
                        </a>
                      )}

                      {message.text && (
                        <p className="text-sm text-white leading-relaxed whitespace-pre-wrap break-words">{message.text}</p>
                      )}

                      <div className={`flex items-center gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                        <p className={`text-[10px] ${isOwn ? 'text-blue-100/70' : 'text-white/40'}`}>
                          {formatMessageTime(message.created_at)}
                        </p>
                        {isOwn && (
                          isRead
                            ? <CheckCheck className="h-3.5 w-3.5 text-sky-300" aria-label="Read" />
                            : <CheckCheck className="h-3.5 w-3.5 text-blue-100/60" aria-label="Delivered" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {typingUsers.length > 0 && <TypingIndicator userName={otherUser?.name} />}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="relative z-10 p-4 shrink-0">
        <div className="max-w-4xl mx-auto">
          {isOtherUserBlocked ? (
            <div className="backdrop-blur-xl bg-black/40 border border-red-400/30 rounded-2xl px-6 py-4 text-center space-y-2">
              <p className="text-sm text-white/80">
                You blocked {otherUser?.name || 'this user'}. Messaging and attachments are disabled.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowUnblockConfirm(true)}
                className="border-white/20 bg-white/5 text-white hover:bg-white/10"
              >
                Unblock User
              </Button>
            </div>
          ) : (
            <>
              {/* Pending attachment preview */}
              {pendingAttachment && (
                <div className="mb-2 backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl px-3 py-2 flex items-center gap-3">
                  {pendingAttachment.type.startsWith('image/') ? (
                    <img src={pendingAttachment.url} alt="" className="h-12 w-12 object-cover rounded-lg" />
                  ) : (
                    <div className="h-12 w-12 rounded-lg bg-white/10 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-white/80" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{pendingAttachment.name}</p>
                    <p className="text-[11px] text-white/50">{formatBytes(pendingAttachment.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingAttachment(null)}
                    className="glass-icon-button shrink-0"
                    aria-label="Remove attachment"
                  >
                    <X className="h-4 w-4 text-white/80" />
                  </button>
                </div>
              )}

              <form
                onSubmit={handleSendMessage}
                className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-full px-2 py-1.5 shadow-lg flex items-center gap-1"
              >
                {/* Emoji */}
                <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                      aria-label="Emoji"
                    >
                      <Smile className="h-5 w-5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="start"
                    className="p-0 w-auto border-white/10 bg-transparent shadow-xl"
                  >
                    <EmojiPicker
                      onEmojiClick={handleEmojiSelect}
                      theme={Theme.DARK}
                      lazyLoadEmojis
                      width={320}
                      height={380}
                    />
                  </PopoverContent>
                </Popover>

                {/* Attachment */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={uploading}
                      className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
                      aria-label="Attach"
                    >
                      <Paperclip className="h-5 w-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="start" className="bg-black/60 backdrop-blur-xl border border-white/10 text-white">
                    <DropdownMenuItem onClick={handlePickImage} className="focus:bg-white/10 focus:text-white">
                      <ImageIcon className="h-4 w-4 mr-2" />Image
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handlePickFile} className="focus:bg-white/10 focus:text-white">
                      <FileText className="h-4 w-4 mr-2" />File (PDF, DOCX, TXT)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadAndAttach(f, 'image');
                    e.target.value = '';
                  }}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadAndAttach(f, 'file');
                    e.target.value = '';
                  }}
                />

                <input
                  value={newMessage}
                  onChange={handleInputChange}
                  placeholder={uploading ? 'Uploading…' : 'Type your message...'}
                  disabled={uploading}
                  className="flex-1 bg-transparent text-white placeholder:text-white/30 text-sm outline-none focus:ring-0 border-none px-2"
                />

                <button
                  type="submit"
                  disabled={loading || uploading || (!newMessage.trim() && !pendingAttachment)}
                  className="shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg transition-all duration-200 hover:shadow-[0_0_16px_rgba(59,130,246,0.5)] hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none"
                >
                  <Send className="h-4 w-4 text-white" />
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Image Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 glass-icon-button"
            onClick={() => setLightboxUrl(null)}
            aria-label="Close"
          >
            <X className="h-5 w-5 text-white" />
          </button>
          <img src={lightboxUrl} alt="" className="max-h-full max-w-full rounded-xl shadow-2xl" />
        </div>
      )}

      <ReportDialog
        isOpen={showReportDialog}
        onClose={() => setShowReportDialog(false)}
        reportedUserId={otherUserId || ''}
        reportedUserName={otherUser?.name}
      />

      <AlertDialog open={showBlockConfirm} onOpenChange={setShowBlockConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block User?</AlertDialogTitle>
            <AlertDialogDescription>
              This user will not be able to message you or appear in your matches. You can unblock them later from settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBlockUser} className="bg-destructive text-destructive-foreground">Block</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This chat will be hidden from your list. It will reappear if a new message arrives.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteChat}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showUnblockConfirm} onOpenChange={setShowUnblockConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unblock User?</AlertDialogTitle>
            <AlertDialogDescription>
              This will allow you to send messages to and receive messages from this user again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleUnblockUser}>Unblock</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Chat;
