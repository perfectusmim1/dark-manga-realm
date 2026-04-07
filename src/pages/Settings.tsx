import React, { useEffect, useMemo, useState } from 'react';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';
import {
    User,
    Lock,
    Mail,
    Camera,
    Save,
    ShieldCheck,
    Bell,
    Eye,
    EyeOff,
    ShieldAlert,
    SlidersHorizontal,
    Loader2,
    WifiOff,
    Smartphone,
    ShieldOff,
    Copy,
    TriangleAlert,
    Monitor,
    Tablet,
    Globe,
    LogOut,
    Clock,
    Link2,
    RefreshCcw,
    ArrowDownToLine,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { getBlockedUsers, unblockUser } from '@/lib/profile';
import { getUserSessions, revokeUserSession, revokeAllOtherSessions, type UserSession } from '@/lib/database';
import { refreshFavoritesCache } from '@/lib/storage';
import { useOfflinePreferences } from '@/hooks/useOfflinePreferences';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { PASSWORD_MIN_LENGTH, getPasswordRequirementError, getPasswordRequirementStatus } from '@/lib/auth/passwordPolicy';
import type { User as AppUser } from '@/lib/types';
import type { ExternalSyncProvider } from '@/lib/types';
import {
    beginExternalProviderAuth,
    disconnectExternalProvider,
    getExternalSyncStatuses,
    importLibraryFromExternalProvider,
    normalizeExternalSyncPreferences,
    syncLibraryToExternalProviders,
} from '@/lib/externalSync';
import { useLocation } from 'react-router-dom';

type PreferenceState = {
    notifications: {
        new_chapter: boolean;
        replies: boolean;
        likes: boolean;
        follows: boolean;
    };
    comments: {
        auto_show_media: boolean;
        auto_show_gifs: boolean;
        auto_show_replies: boolean;
        show_page_comments: boolean;
    };
    appearance: {
        manga_hover_preview: boolean;
        show_header_offline_toggle: boolean;
        show_chapter_card_images: boolean;
    };
    privacy: {
        visibility: NonNullable<NonNullable<AppUser['preferences']>['privacy']>['visibility'];
        reading_history_visibility: NonNullable<NonNullable<AppUser['preferences']>['privacy']>['reading_history_visibility'];
        comments_visibility: NonNullable<NonNullable<AppUser['preferences']>['privacy']>['comments_visibility'];
        reading_lists_visibility: NonNullable<NonNullable<AppUser['preferences']>['privacy']>['reading_lists_visibility'];
        tier_lists_visibility: NonNullable<NonNullable<AppUser['preferences']>['privacy']>['tier_lists_visibility'];
        followed_manga_visibility: NonNullable<NonNullable<AppUser['preferences']>['privacy']>['followed_manga_visibility'];
    };
    externalSync: NonNullable<NonNullable<AppUser['preferences']>['externalSync']>;
};

type PrivacyVisibility = NonNullable<NonNullable<AppUser['preferences']>['privacy']>['visibility'];

const PRIVACY_VISIBILITY_OPTIONS: Array<{ value: PrivacyVisibility; label: string }> = [
    { value: 'public', label: 'Herkese Açık' },
    { value: 'members', label: 'Sadece Üyeler' },
    { value: 'mutuals', label: 'Karşılıklı Takip' },
    { value: 'private', label: 'Gizli' },
];

type BlockedUser = {
    id: string;
    username: string;
    avatar?: string | null;
};

type ExternalProviderStatus = {
    connected: boolean;
    providerUserId?: string | null;
    connectedAt?: string | null;
    updatedAt?: string | null;
    lastSyncAt?: string | null;
    lastError?: string | null;
    lastErrorAt?: string | null;
};

const EMPTY_EXTERNAL_PROVIDER_STATUS: ExternalProviderStatus = {
    connected: false,
    providerUserId: null,
    connectedAt: null,
    updatedAt: null,
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
};

const getExternalProviderLabel = (provider: ExternalSyncProvider) => (
    provider === 'myanimelist' ? 'MyAnimeList' : 'AniList'
);

const buildPreferenceState = (preferences?: AppUser['preferences']): PreferenceState => ({
    notifications: {
        new_chapter: preferences?.notifications?.new_chapter ?? true,
        replies: preferences?.notifications?.replies ?? true,
        likes: preferences?.notifications?.likes ?? true,
        follows: preferences?.notifications?.follows ?? true,
    },
    comments: {
        auto_show_media: preferences?.comments?.auto_show_media ?? false,
        auto_show_gifs: preferences?.comments?.auto_show_gifs ?? false,
        auto_show_replies: preferences?.comments?.auto_show_replies ?? false,
        show_page_comments: preferences?.comments?.show_page_comments ?? false,
    },
    appearance: {
        manga_hover_preview: preferences?.appearance?.manga_hover_preview ?? false,
        show_header_offline_toggle: preferences?.appearance?.show_header_offline_toggle ?? true,
        show_chapter_card_images: preferences?.appearance?.show_chapter_card_images ?? false,
    },
    privacy: {
        visibility: preferences?.privacy?.visibility ?? 'public',
        reading_history_visibility: preferences?.privacy?.reading_history_visibility ?? 'public',
        comments_visibility: preferences?.privacy?.comments_visibility ?? 'public',
        reading_lists_visibility: preferences?.privacy?.reading_lists_visibility ?? 'public',
        tier_lists_visibility: preferences?.privacy?.tier_lists_visibility ?? 'public',
        followed_manga_visibility: preferences?.privacy?.followed_manga_visibility ?? 'public',
    },
    externalSync: normalizeExternalSyncPreferences(preferences),
});

const sanitizeTotpCode = (value: string) => value.replace(/\D/g, '').slice(0, 6);

const getTotpQrImageSrc = (qrCode: string | undefined) => {
    const normalized = qrCode?.trim();

    if (!normalized) {
        return null;
    }

    if (normalized.startsWith('data:image/')) {
        return normalized;
    }

    if (normalized.startsWith('<svg') || normalized.startsWith('<?xml')) {
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalized)}`;
    }

    return normalized;
};

const getNextUsernameChangeDate = (usernameChangedAt?: string) => {
    if (!usernameChangedAt) {
        return null;
    }

    const nextDate = new Date(usernameChangedAt);
    if (Number.isNaN(nextDate.getTime())) {
        return null;
    }

    nextDate.setDate(nextDate.getDate() + 7);
    return nextDate;
};

const Settings: React.FC = () => {
    const location = useLocation();
    const {
        user,
        supabaseUser,
        mfaState,
        updateProfile,
        updatePassword,
        resetPassword,
        updatePreferences,
        enrollTwoFactor,
        cancelTwoFactorEnrollment,
        verifyTwoFactorEnrollment,
        disableTwoFactor,
    } = useAuth();
    const { preferences: offlinePreferences, updatePreferences: updateOfflinePreferences } = useOfflinePreferences();
    const { isOnline } = useEffectiveOnlineStatus();

    // Profile state
    const [username, setUsername] = useState(user?.username || '');
    const [avatar, setAvatar] = useState(user?.avatar || '');
    const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

    // Password state
    const [currentPassword, setCurrentPassword] = useState('');
    const [passwordChangeMfaCode, setPasswordChangeMfaCode] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
    const [isSendingRecoveryLink, setIsSendingRecoveryLink] = useState(false);
    const newPasswordStatus = getPasswordRequirementStatus(newPassword, PASSWORD_MIN_LENGTH);

    // MFA state
    const [disableDialogOpen, setDisableDialogOpen] = useState(false);
    const [setupCode, setSetupCode] = useState('');
    const [disableCode, setDisableCode] = useState('');
    const [pendingEnrollment, setPendingEnrollment] = useState<{
        factorId: string;
        friendlyName?: string;
        qrCodeSvg: string;
        secret: string;
        uri: string;
    } | null>(null);
    const [isTwoFactorBusy, setIsTwoFactorBusy] = useState(false);

    // Notification state
    const [prefs, setPrefs] = useState<PreferenceState>(buildPreferenceState(user?.preferences));
    const [isUpdatingPrefs, setIsUpdatingPrefs] = useState(false);
    const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
    const [isBlockedUsersLoading, setIsBlockedUsersLoading] = useState(true);
    const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);
    const [sessions, setSessions] = useState<UserSession[]>([]);
    const [isSessionsLoading, setIsSessionsLoading] = useState(false);
    const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
    const [isRevokingAll, setIsRevokingAll] = useState(false);
    const [externalStatuses, setExternalStatuses] = useState<Record<ExternalSyncProvider, ExternalProviderStatus>>({
        myanimelist: EMPTY_EXTERNAL_PROVIDER_STATUS,
        anilist: EMPTY_EXTERNAL_PROVIDER_STATUS,
    });
    const [isExternalStatusesLoading, setIsExternalStatusesLoading] = useState(false);
    const [providerBusyState, setProviderBusyState] = useState<Record<ExternalSyncProvider, 'idle' | 'connecting' | 'disconnecting' | 'syncing' | 'importing'>>({
        myanimelist: 'idle',
        anilist: 'idle',
    });
    const onlineRequiredMessage = 'Bu işlem için internete bağlanın';
    const getPreferenceSuccessMessage = (message: string) =>
        isOnline ? message : `${message}, tekrar çevrimiçi olduğunda eşitlenecek`;
    const nextUsernameChangeAt = getNextUsernameChangeDate(user?.usernameChangedAt);
    const isUsernameCooldownActive = Boolean(
        nextUsernameChangeAt && nextUsernameChangeAt.getTime() > Date.now()
    );
    const normalizedExternalPrefs = useMemo(() => normalizeExternalSyncPreferences(prefs), [prefs]);
    const requestedTabFromQuery = useMemo(() => {
        const tab = new URLSearchParams(location.search).get('tab');
        const allowedTabs = new Set(['profile', 'security', 'notifications', 'privacy', 'sync', 'devices', 'preferences', 'blocked']);
        return allowedTabs.has(tab || '') ? (tab as string) : 'profile';
    }, [location.search]);
    const [activeSettingsTab, setActiveSettingsTab] = useState(requestedTabFromQuery);

    useEffect(() => {
        if (!user?.id || !isOnline) {
            setBlockedUsers([]);
            setIsBlockedUsersLoading(false);
            return;
        }

        setIsBlockedUsersLoading(true);
        getBlockedUsers(user.id).then(({ users }) => {
            setBlockedUsers((users || []) as BlockedUser[]);
            setIsBlockedUsersLoading(false);
        });
    }, [isOnline, user?.id]);

    useEffect(() => {
        setUsername(user?.username || '');
        setAvatar(user?.avatar || '');
    }, [user?.username, user?.avatar]);

    useEffect(() => {
        setPrefs(buildPreferenceState(user?.preferences));
    }, [user?.preferences]);

    const loadExternalStatuses = async () => {
        if (!user?.id || !isOnline) {
            setExternalStatuses({
                myanimelist: EMPTY_EXTERNAL_PROVIDER_STATUS,
                anilist: EMPTY_EXTERNAL_PROVIDER_STATUS,
            });
            setIsExternalStatusesLoading(false);
            return;
        }

        try {
            setIsExternalStatusesLoading(true);
            const response = await getExternalSyncStatuses();
            const nextStatuses: Record<ExternalSyncProvider, ExternalProviderStatus> = {
                myanimelist: EMPTY_EXTERNAL_PROVIDER_STATUS,
                anilist: EMPTY_EXTERNAL_PROVIDER_STATUS,
            };

            for (const item of response?.providers || []) {
                if (item.provider === 'myanimelist' || item.provider === 'anilist') {
                    nextStatuses[item.provider] = {
                        connected: Boolean(item.account?.connected),
                        providerUserId: item.account?.providerUserId || null,
                        connectedAt: item.account?.connectedAt || null,
                        updatedAt: item.account?.updatedAt || null,
                        lastSyncAt: item.account?.lastSyncAt || null,
                        lastError: item.account?.lastError || null,
                        lastErrorAt: item.account?.lastErrorAt || null,
                    };
                }
            }

            setExternalStatuses(nextStatuses);
        } catch (error) {
            console.error('External sync status load error:', error);
        } finally {
            setIsExternalStatusesLoading(false);
        }
    };

    useEffect(() => {
        void loadExternalStatuses();
    }, [isOnline, user?.id]);

    useEffect(() => {
        const query = new URLSearchParams(location.search);
        const provider = query.get('sync_provider');
        const status = query.get('sync_status');
        const message = query.get('sync_message');

        if (!provider || !status) {
            return;
        }

        if (status === 'connected') {
            toast.success(provider === 'myanimelist' ? 'MyAnimeList hesabı bağlandı' : 'AniList hesabı bağlandı');
            void loadExternalStatuses();
        } else if (status === 'error') {
            toast.error(message || 'Harici hesap bağlantısı tamamlanamadı');
            void loadExternalStatuses();
        }

        const nextQuery = new URLSearchParams(location.search);
        nextQuery.delete('sync_provider');
        nextQuery.delete('sync_status');
        nextQuery.delete('sync_message');
        const queryString = nextQuery.toString();
        const nextUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ''}${window.location.hash || ''}`;
        window.history.replaceState({}, document.title, nextUrl);
    }, [location.search]);

    useEffect(() => {
        setActiveSettingsTab(requestedTabFromQuery);
    }, [requestedTabFromQuery]);

    const handleUpdateProfile = async () => {
        if (!username.trim()) {
            toast.error('Kullanıcı adı boş olamaz');
            return;
        }
        if (!isOnline) {
            toast.error(onlineRequiredMessage);
            return;
        }

        try {
            setIsUpdatingProfile(true);
            const { success, error } = await updateProfile({ username, avatar });
            if (success) {
                toast.success('Profil güncellendi');
            } else {
                toast.error(error || 'Profil güncellenemedi');
            }
        } catch (err) {
            toast.error('İşlem başarısız oldu');
        } finally {
            setIsUpdatingProfile(false);
        }
    };

    const handleUpdatePassword = async () => {
        if (!isOnline) {
            toast.error(onlineRequiredMessage);
            return;
        }
        const passwordError = getPasswordRequirementError(newPassword, PASSWORD_MIN_LENGTH);
        if (passwordError) {
            toast.error(passwordError);
            return;
        }
        if (newPassword !== confirmPassword) {
            toast.error('Şifreler uyuşmuyor');
            return;
        }
        if (user.twoFactorEnabled && passwordChangeMfaCode.length !== 6) {
            toast.error('Authenticator kodunu girin');
            return;
        }
        if (!user.twoFactorEnabled && !currentPassword.trim()) {
            toast.error('Mevcut şifrenizi girin');
            return;
        }

        try {
            setIsUpdatingPassword(true);
            const { success, error } = await updatePassword(newPassword, user.twoFactorEnabled
                ? { mfaCode: passwordChangeMfaCode }
                : { currentPassword });
            if (success) {
                toast.success('Şifre başarıyla güncellendi');
                setCurrentPassword('');
                setPasswordChangeMfaCode('');
                setNewPassword('');
                setConfirmPassword('');
            } else {
                toast.error(error || 'Şifre güncellenemedi');
            }
        } catch (err) {
            toast.error('İşlem başarısız oldu');
        } finally {
            setIsUpdatingPassword(false);
        }
    };

    const handleSendPasswordRecoveryLink = async () => {
        if (!isOnline) {
            toast.error(onlineRequiredMessage);
            return;
        }
        if (!user.email) {
            toast.error('E-posta adresi bulunamadı');
            return;
        }

        try {
            setIsSendingRecoveryLink(true);
            const { success, error } = await resetPassword(user.email);
            if (!success) {
                toast.error(error || 'Şifre sıfırlama bağlantısı gönderilemedi');
                return;
            }

            toast.success('Şifre sıfırlama bağlantısı e-posta adresinize gönderildi');
        } finally {
            setIsSendingRecoveryLink(false);
        }
    };

    const closeSetupDialog = async () => {
        if (pendingEnrollment?.factorId) {
            await cancelTwoFactorEnrollment(pendingEnrollment.factorId);
        }

        setPendingEnrollment(null);
        setSetupCode('');
    };

    const handleStartTwoFactorSetup = async () => {
        if (!isOnline) {
            toast.error(onlineRequiredMessage);
            return;
        }
        try {
            setIsTwoFactorBusy(true);
            const { success, error, enrollment } = await enrollTwoFactor();

            if (!success || !enrollment) {
                toast.error(error || '2FA kurulumu başlatılamadı');
                return;
            }

            setPendingEnrollment(enrollment);
            setSetupCode('');
        } finally {
            setIsTwoFactorBusy(false);
        }
    };

    const handleVerifyTwoFactorSetup = async () => {
        if (!isOnline) {
            toast.error(onlineRequiredMessage);
            return;
        }
        if (!pendingEnrollment) {
            toast.error('Aktif bir kurulum bulunamadı');
            return;
        }

        try {
            setIsTwoFactorBusy(true);
            const { success, error } = await verifyTwoFactorEnrollment(pendingEnrollment.factorId, setupCode);

            if (!success) {
                toast.error(error || 'Doğrulama başarısız oldu');
                return;
            }

            toast.success('Google Authenticator başarıyla etkinleştirildi');
            setPendingEnrollment(null);
            setSetupCode('');
        } finally {
            setIsTwoFactorBusy(false);
        }
    };

    const handleDisableTwoFactor = async () => {
        if (!isOnline) {
            toast.error(onlineRequiredMessage);
            return;
        }
        try {
            setIsTwoFactorBusy(true);
            const { success, error } = await disableTwoFactor(disableCode);

            if (!success) {
                toast.error(error || '2FA kapatılamadı');
                return;
            }

            toast.success('2FA kapatıldı');
            setDisableCode('');
            setDisableDialogOpen(false);
        } finally {
            setIsTwoFactorBusy(false);
        }
    };

    const handleUpdatePreferences = async (
        newPrefs: typeof prefs,
        successMessage = 'Tercihler güncellendi'
    ) => {
        const previousPrefs = prefs;

        try {
            setPrefs(newPrefs);
            setIsUpdatingPrefs(true);
            const { success, error } = await updatePreferences(newPrefs);
            if (success) {
                toast.success(getPreferenceSuccessMessage(successMessage));
            } else {
                setPrefs(previousPrefs);
                toast.error(error || 'Güncellenemedi');
            }
        } catch (err) {
            setPrefs(previousPrefs);
            toast.error('Bir hata oluştu');
        } finally {
            setIsUpdatingPrefs(false);
        }
    };

    const handleToggleProviderEnabled = async (provider: ExternalSyncProvider, checked: boolean) => {
        await handleUpdatePreferences({
            ...prefs,
            externalSync: {
                ...prefs.externalSync,
                providers: {
                    ...prefs.externalSync.providers,
                    [provider]: {
                        ...prefs.externalSync.providers[provider],
                        enabled: checked,
                    },
                },
            },
        }, checked ? 'Sağlayıcı senkronu açıldı' : 'Sağlayıcı senkronu kapatıldı');
    };

    const handleToggleProviderField = async (
        provider: ExternalSyncProvider,
        field: 'status' | 'progress' | 'score' | 'dates' | 'favorite',
        checked: boolean,
    ) => {
        const currentProviderPrefs = prefs.externalSync.providers[provider];
        const nextProviderPrefs = {
            ...currentProviderPrefs,
            fieldToggles: {
                ...currentProviderPrefs.fieldToggles,
                [field]: checked,
            },
        };

        await handleUpdatePreferences({
            ...prefs,
            externalSync: {
                ...prefs.externalSync,
                providers: {
                    ...prefs.externalSync.providers,
                    [provider]: nextProviderPrefs,
                },
            },
        }, 'Senkron alanları güncellendi');
    };

    const handleConnectProvider = async (provider: ExternalSyncProvider) => {
        if (!isOnline) {
            toast.error(onlineRequiredMessage);
            return;
        }

        try {
            setProviderBusyState((current) => ({ ...current, [provider]: 'connecting' }));
            await beginExternalProviderAuth(provider);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Bağlantı başlatılamadı');
            setProviderBusyState((current) => ({ ...current, [provider]: 'idle' }));
        }
    };

    const handleDisconnectProvider = async (provider: ExternalSyncProvider) => {
        if (!isOnline) {
            toast.error(onlineRequiredMessage);
            return;
        }

        try {
            setProviderBusyState((current) => ({ ...current, [provider]: 'disconnecting' }));
            await disconnectExternalProvider(provider);
            setExternalStatuses((current) => ({
                ...current,
                [provider]: EMPTY_EXTERNAL_PROVIDER_STATUS,
            }));
            toast.success(provider === 'myanimelist' ? 'MyAnimeList bağlantısı kesildi' : 'AniList bağlantısı kesildi');
            await loadExternalStatuses();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Bağlantı kesilemedi');
        } finally {
            setProviderBusyState((current) => ({ ...current, [provider]: 'idle' }));
        }
    };

    const handleImportProviderLibrary = async (provider: ExternalSyncProvider) => {
        if (!isOnline) {
            toast.error(onlineRequiredMessage);
            return;
        }

        const providerLabel = getExternalProviderLabel(provider);

        try {
            setProviderBusyState((current) => ({ ...current, [provider]: 'importing' }));
            const response = await importLibraryFromExternalProvider(provider);
            if (user?.id) {
                try {
                    await refreshFavoritesCache(user.id);
                } catch (cacheError) {
                    console.error('Favorite cache refresh error:', cacheError);
                }
            }
            const {
                libraryImported,
                ratingsImported,
                progressImported,
                skippedExistingLibrary,
                skippedExistingRatings,
                skippedExistingProgress,
            } = response.summary;
            const importedPieces = [
                libraryImported > 0 ? `${libraryImported} kütüphane kaydı` : null,
                ratingsImported > 0 ? `${ratingsImported} puan` : null,
                progressImported > 0 ? `${progressImported} ilerleme` : null,
            ].filter(Boolean) as string[];
            const skippedCount = skippedExistingLibrary + skippedExistingRatings + skippedExistingProgress;

            if (response.matchedEntries === 0) {
                toast.info(`${providerLabel} listesindeki kayıtlar için sitede eşleşen seri bulunamadı.`);
                return;
            }

            if (importedPieces.length === 0) {
                toast.info(`${providerLabel} içe aktarma tamamlandı. ${response.matchedEntries} seri eşleşti ama mevcut site kayıtları korunarak yeni veri yazılmadı.`);
                return;
            }

            const summaryText = `${providerLabel} içe aktarma tamamlandı: ${importedPieces.join(', ')} aktarıldı.`;

            if (response.unmatchedEntries > 0 || skippedCount > 0) {
                toast.warning(`${summaryText} ${response.unmatchedEntries} seri eşleşmedi, ${skippedCount} alan mevcut yerel veri olduğu için atlandı.`);
                return;
            }

            toast.success(summaryText);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Kütüphane içe aktarma başarısız oldu');
        } finally {
            await loadExternalStatuses();
            setProviderBusyState((current) => ({ ...current, [provider]: 'idle' }));
        }
    };

    const handleSyncProviderLibrary = async (provider: ExternalSyncProvider) => {
        if (!isOnline) {
            toast.error(onlineRequiredMessage);
            return;
        }

        try {
            setProviderBusyState((current) => ({ ...current, [provider]: 'syncing' }));
            const response = await syncLibraryToExternalProviders({ providers: [provider] });
            const { synced, skipped, failed, warnings } = response.summary;

            if (failed > 0) {
                toast.warning(`${externalStatuses[provider].connected ? (provider === 'myanimelist' ? 'MyAnimeList' : 'AniList') : 'Sağlayıcı'} senkronu tamamlandı: ${synced} başarılı, ${failed} hatalı, ${skipped} atlandı.`);
                return;
            }

            if (warnings > 0) {
                toast.warning(`${provider === 'myanimelist' ? 'MyAnimeList' : 'AniList'} senkronu tamamlandı: ${synced} başarılı, ${warnings} uyarı var.`);
                return;
            }

            if (synced === 0 && skipped > 0) {
                toast.info(`${provider === 'myanimelist' ? 'MyAnimeList' : 'AniList'} için senkronlanacak yeni değişiklik bulunmadı.`);
                return;
            }

            toast.success(`${provider === 'myanimelist' ? 'MyAnimeList' : 'AniList'} kütüphane senkronu tamamlandı. ${synced} kayıt güncellendi.`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Kütüphane senkronu başarısız oldu');
        } finally {
            await loadExternalStatuses();
            setProviderBusyState((current) => ({ ...current, [provider]: 'idle' }));
        }
    };

    const handleUnblockUser = async (blockedId: string) => {
        if (!user?.id) {
            return;
        }
        if (!isOnline) {
            toast.error(onlineRequiredMessage);
            return;
        }

        try {
            setUnblockingUserId(blockedId);
            const { error } = await unblockUser(user.id, blockedId);

            if (error) {
                toast.error('Engel kaldirilemedi');
                return;
            }

            setBlockedUsers((prev) => prev.filter((blockedUser) => blockedUser.id !== blockedId));
            toast.success('Engel kaldirildi');
        } catch {
            toast.error('Islem basarisiz oldu');
        } finally {
            setUnblockingUserId(null);
        }
    };

    const loadSessions = async () => {
        if (!isOnline) return;
        try {
            setIsSessionsLoading(true);
            const data = await getUserSessions();
            setSessions(data);
        } catch (err) {
            console.error('Session load error:', err);
            toast.error('Oturumlar yüklenemedi');
        } finally {
            setIsSessionsLoading(false);
        }
    };

    const handleRevokeSession = async (sessionId: string) => {
        if (!isOnline) {
            toast.error(onlineRequiredMessage);
            return;
        }
        try {
            setRevokingSessionId(sessionId);
            await revokeUserSession(sessionId);
            setSessions((prev) => prev.filter((s) => s.id !== sessionId));
            toast.success('Oturum kapatıldı');
        } catch (err) {
            toast.error('Oturum kapatılamadı');
        } finally {
            setRevokingSessionId(null);
        }
    };

    const handleRevokeAllOthers = async () => {
        if (!isOnline) {
            toast.error(onlineRequiredMessage);
            return;
        }
        try {
            setIsRevokingAll(true);
            await revokeAllOtherSessions();
            setSessions((prev) => prev.filter((s) => s.isCurrent));
            toast.success('Diğer tüm oturumlar kapatıldı');
        } catch (err) {
            toast.error('Oturumlar kapatılamadı');
        } finally {
            setIsRevokingAll(false);
        }
    };

    const getDeviceIcon = (deviceType: string) => {
        if (deviceType === 'mobile') return <Smartphone className="h-5 w-5" />;
        if (deviceType === 'tablet') return <Tablet className="h-5 w-5" />;
        return <Monitor className="h-5 w-5" />;
    };

    const formatSessionLocation = (session: UserSession) => {
        const parts = [session.city, session.region, session.country].filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : 'Konum bilinmiyor';
    };

    const formatSessionTime = (dateStr: string) => {
        try {
            const date = new Date(dateStr);
            if (Number.isNaN(date.getTime())) return 'Bilinmiyor';
            const now = Date.now();
            const diffMs = now - date.getTime();
            const diffMin = Math.floor(diffMs / 60000);
            if (diffMin < 1) return 'Az önce';
            if (diffMin < 60) return `${diffMin} dakika önce`;
            const diffHours = Math.floor(diffMin / 60);
            if (diffHours < 24) return `${diffHours} saat önce`;
            const diffDays = Math.floor(diffHours / 24);
            if (diffDays < 7) return `${diffDays} gün önce`;
            return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch {
            return 'Bilinmiyor';
        }
    };

    const formatSyncTimestamp = (value?: string | null) => {
        if (!value) {
            return 'Henüz yok';
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return 'Henüz yok';
        }

        return date.toLocaleString('tr-TR', {
            dateStyle: 'medium',
            timeStyle: 'short',
        });
    };

    const renderExternalProviderCard = (
        provider: ExternalSyncProvider,
        label: string,
        description: string,
    ) => {
        const providerPrefs = normalizedExternalPrefs.providers[provider];
        const providerStatus = externalStatuses[provider];
        const isBusy = providerBusyState[provider] !== 'idle';
        const fieldEntries = provider === 'anilist'
            ? [
                ['status', 'Liste durumu'],
                ['progress', 'Okunan bölüm sayısı'],
                ['score', 'Kullanıcı puanı'],
                ['dates', 'Başlama / bitiş tarihi'],
                ['favorite', 'Favori durumu'],
            ] as const
            : [
                ['status', 'Liste durumu'],
                ['progress', 'Okunan bölüm sayısı'],
                ['score', 'Kullanıcı puanı'],
                ['dates', 'Başlama / bitiş tarihi'],
            ] as const;

        return (
            <Card key={provider} className="border-border/50 bg-card/50 backdrop-blur-sm">
                <CardHeader className="gap-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                            <CardTitle className="flex items-center gap-2">
                                <Link2 className="h-5 w-5" />
                                {label}
                                <Badge variant={providerStatus.connected ? 'default' : 'secondary'}>
                                    {providerStatus.connected ? 'Bağlı' : 'Bağlı Değil'}
                                </Badge>
                            </CardTitle>
                            <CardDescription>{description}</CardDescription>
                        </div>

                        <div className="flex flex-wrap gap-2 sm:items-end">
                            {providerStatus.connected ? (
                                <>
                                        <Button
                                            variant="default"
                                            onClick={() => void handleImportProviderLibrary(provider)}
                                            disabled={isBusy || isUpdatingPrefs}
                                        >
                                            {providerBusyState[provider] === 'importing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            {providerBusyState[provider] !== 'importing' && <ArrowDownToLine className="mr-2 h-4 w-4" />}
                                            {providerBusyState[provider] === 'importing' ? 'İçe Aktarılıyor...' : 'Siteye Aktar'}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={() => void handleSyncProviderLibrary(provider)}
                                            disabled={isBusy || isUpdatingPrefs || !providerPrefs.enabled}
                                        >
                                            {providerBusyState[provider] === 'syncing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            {!providerPrefs.enabled && providerBusyState[provider] !== 'syncing' && <RefreshCcw className="mr-2 h-4 w-4" />}
                                            {providerBusyState[provider] !== 'syncing' ? 'Siteden Gönder' : 'Gönderiliyor...'}
                                        </Button>
                                        <Button
                                            variant="destructive"
                                        onClick={() => void handleDisconnectProvider(provider)}
                                        disabled={isBusy || isUpdatingPrefs}
                                    >
                                        {providerBusyState[provider] === 'disconnecting' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Bağlantıyı Kes
                                    </Button>
                                </>
                            ) : (
                                <Button
                                    variant="glow"
                                    onClick={() => void handleConnectProvider(provider)}
                                    disabled={isBusy || isUpdatingPrefs || !isOnline}
                                >
                                    {providerBusyState[provider] === 'connecting' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Bağla
                                </Button>
                            )}
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-border/60 bg-background/30 p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Son başarılı senkron</p>
                            <p className="mt-1 text-sm font-medium">{formatSyncTimestamp(providerStatus.lastSyncAt)}</p>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-background/30 p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Son hata</p>
                            <p className="mt-1 text-sm font-medium">{providerStatus.lastError || 'Yok'}</p>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <Label htmlFor={`${provider}-enabled`}>Sağlayıcı senkronunu aç</Label>
                            <p className="text-sm text-muted-foreground">
                                Bu kapalıysa {label} için otomatik tetikler durur ve manuel toplu senkron butonu pasif olur.
                            </p>
                        </div>
                        <Switch
                            id={`${provider}-enabled`}
                            checked={providerPrefs.enabled}
                            onCheckedChange={(checked) => void handleToggleProviderEnabled(provider, checked)}
                            disabled={isUpdatingPrefs}
                        />
                    </div>

                    <div className="space-y-3 rounded-xl border border-border/60 bg-background/30 p-4">
                        <div className="space-y-1">
                            <Label>{label} Alanları</Label>
                            <p className="text-sm text-muted-foreground">Hangi verilerin bu sağlayıcıyla içe ve dışa senkronlanacağını ayrı ayrı seçin.</p>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                            {fieldEntries.map(([field, fieldLabel]) => (
                                <div key={`${provider}-${field}`} className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2.5">
                                    <span className="text-sm">{fieldLabel}</span>
                                    <Switch
                                        checked={Boolean((providerPrefs.fieldToggles as Record<string, boolean>)[field])}
                                        onCheckedChange={(checked) => void handleToggleProviderField(provider, field, checked)}
                                        disabled={isUpdatingPrefs}
                                    />
                                </div>
                            ))}
                        </div>

                        {provider === 'myanimelist' && (
                            <p className="text-sm text-muted-foreground">
                                MyAnimeList resmi API&apos;si liste alanlarını yazabiliyor, fakat favori ekleme/çıkarma için resmi yazılabilir bir uç nokta sunmuyor.
                            </p>
                        )}

                        <p className="text-sm text-muted-foreground">
                            İçe aktarma yalnızca sitede {label} bağlantısı bulunan serilerde çalışır; kapalı alanları atlar ve mevcut yerel veriyi ezmeden yalnızca izin verilen eksik alanları doldurur.
                        </p>
                    </div>
                </CardContent>
            </Card>
        );
    };

    const renderPrivacySelector = (
        key: keyof PreferenceState['privacy'],
        label: string,
        description: string
    ) => (
        <div className="flex flex-col gap-4 border-t border-border/50 pt-6 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex min-w-0 flex-col space-y-1">
                <Label>{label}</Label>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 rounded-lg bg-secondary/30 p-1 lg:grid-cols-4 lg:w-auto">
                {PRIVACY_VISIBILITY_OPTIONS.map((option) => (
                    <button
                        key={`${String(key)}-${option.value}`}
                        onClick={() => handleUpdatePreferences({
                            ...prefs,
                            privacy: { ...prefs.privacy, [key]: option.value }
                        }, 'Gizlilik ayarlari guncellendi')}
                        className={`w-full rounded-md px-3 py-2 text-xs font-bold transition-all lg:py-1.5 ${
                            prefs.privacy?.[key] === option.value
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
        </div>
    );

    if (!user) {
        return (
            <div className="min-h-screen bg-background">
                <Header />
                <main className="container flex min-h-[60vh] items-center justify-center pt-20">
                    <p>Ayarları görmek için giriş yapmalısınız.</p>
                </main>
            </div>
        );
    }

    const qrCodeDataUrl = getTotpQrImageSrc(pendingEnrollment?.qrCodeSvg);
    const activeTotpFactor = mfaState.factors.find((factor) => factor.status === 'verified') || null;
    const authProviders = Array.isArray((supabaseUser?.app_metadata as any)?.providers)
        ? ((supabaseUser?.app_metadata as any)?.providers as string[]).map((provider) => provider.toLowerCase())
        : [];
    const primaryAuthProvider = typeof (supabaseUser?.app_metadata as any)?.provider === 'string'
        ? ((supabaseUser?.app_metadata as any)?.provider as string).toLowerCase()
        : null;
    const hasEmailAuth = primaryAuthProvider === 'email' || authProviders.includes('email');
    const hasGoogleAuth = primaryAuthProvider === 'google' || authProviders.includes('google');
    const shouldShowPasswordSettings = hasEmailAuth || !hasGoogleAuth;

    const openQrInNewTab = () => {
        if (!qrCodeDataUrl) {
            return;
        }

        const popup = window.open('', '_blank');

        if (!popup) {
            toast.error('Yeni sekme açılamadı. Tarayıcı popup engelliyor olabilir.');
            return;
        }

        const safeQrCodeSrc = qrCodeDataUrl.replace(/"/g, '&quot;');
        const qrMarkup = `<img src="${safeQrCodeSrc}" alt="Google Authenticator QR" style="width:320px;height:320px;display:block;" />`;

        popup.document.write(`
          <!doctype html>
          <html lang="tr">
            <head>
              <meta charset="utf-8" />
              <title>Google Authenticator QR</title>
              <style>
                body {
                  margin: 0;
                  min-height: 100vh;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  background: #ffffff;
                }
              </style>
            </head>
            <body>${qrMarkup}</body>
          </html>
        `);
        popup.document.close();
    };

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="container max-w-4xl py-20 sm:py-24">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold">Ayarlar</h1>
                    <p className="text-sm text-muted-foreground sm:text-base">Profilinizi ve güvenlik tercihlerinizi yönetin</p>
                </div>

                <Tabs value={activeSettingsTab} onValueChange={setActiveSettingsTab} className="space-y-6">
                    <TabsList className="grid h-auto w-full grid-cols-2 justify-start gap-2 rounded-2xl bg-secondary/50 p-1 md:flex md:flex-wrap md:justify-start">
                        <TabsTrigger value="profile" className="w-full gap-2 px-3 py-2 text-xs md:w-auto md:shrink-0 md:text-sm">
                            <User className="h-4 w-4" />
                            Profil
                        </TabsTrigger>
                        <TabsTrigger value="security" className="w-full gap-2 px-3 py-2 text-xs md:w-auto md:shrink-0 md:text-sm">
                            <ShieldCheck className="h-4 w-4" />
                            Güvenlik
                        </TabsTrigger>
                        <TabsTrigger value="notifications" className="w-full gap-2 px-3 py-2 text-xs md:w-auto md:shrink-0 md:text-sm">
                            <Bell className="h-4 w-4" />
                            Bildirimler
                        </TabsTrigger>
                        <TabsTrigger value="privacy" className="w-full gap-2 px-3 py-2 text-xs md:w-auto md:shrink-0 md:text-sm">
                            <EyeOff className="h-4 w-4" />
                            Gizlilik
                        </TabsTrigger>
                        <TabsTrigger value="sync" className="w-full gap-2 px-3 py-2 text-xs md:w-auto md:shrink-0 md:text-sm">
                            <Link2 className="h-4 w-4" />
                            Senkronizasyon
                        </TabsTrigger>
                        <TabsTrigger value="devices" className="w-full gap-2 px-3 py-2 text-xs md:w-auto md:shrink-0 md:text-sm" onClick={() => { if (!isSessionsLoading) void loadSessions(); }}>
                            <Monitor className="h-4 w-4" />
                            Cihazlar
                        </TabsTrigger>
                        <TabsTrigger value="preferences" className="w-full gap-2 px-3 py-2 text-xs md:w-auto md:shrink-0 md:text-sm">
                            <SlidersHorizontal className="h-4 w-4" />
                            Tercihler
                        </TabsTrigger>
                        <TabsTrigger value="blocked" className="w-full gap-2 px-3 py-2 text-xs md:w-auto md:shrink-0 md:text-sm">
                            <ShieldAlert className="h-4 w-4" />
                            Engellenenler
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="profile" className="mt-0 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                            <CardHeader>
                                <CardTitle>Genel Bilgiler</CardTitle>
                                <CardDescription>Herkese açık profil bilgilerinizi buradan düzenleyebilirsiniz.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* Avatar Section */}
                                <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
                                    <div className="relative group">
                                        <Avatar className="h-24 w-24 border-2 border-primary/20">
                                            <AvatarImage src={avatar} />
                                            <AvatarFallback className="text-xl">{user.username[0].toUpperCase()}</AvatarFallback>
                                        </Avatar>
                                        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                                            <Camera className="h-6 w-6 text-white" />
                                        </div>
                                    </div>
                                    <div className="flex-1 space-y-2 text-center sm:text-left">
                                        <Label htmlFor="avatar-url">Profil Fotoğrafı URL</Label>
                                        <Input
                                            id="avatar-url"
                                            placeholder="https://example.com/image.jpg"
                                            value={avatar}
                                            onChange={(e) => setAvatar(e.target.value)}
                                        />
                                        <p className="text-xs text-muted-foreground">Resim URL'si girerek profil fotoğrafınızı güncelleyebilirsiniz.</p>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="username">Kullanıcı Adı</Label>
                                        <Input
                                            id="username"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            disabled={isUpdatingProfile || isUsernameCooldownActive}
                                            className={isUsernameCooldownActive ? 'bg-secondary/30' : undefined}
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            {isUsernameCooldownActive && nextUsernameChangeAt
                                                ? `Kullanıcı adınızı haftada bir değiştirebilirsiniz. Sonraki değişiklik: ${nextUsernameChangeAt.toLocaleString('tr-TR')}`
                                                : 'Kullanıcı adınızı 7 günde bir değiştirebilirsiniz.'}
                                        </p>
                                    </div>
                            </CardContent>
                            <CardFooter className="flex-col gap-3 border-t border-border/50 pt-6 sm:flex-row">
                                <Button onClick={handleUpdateProfile} disabled={isUpdatingProfile} className="w-full gap-2 sm:ml-auto sm:w-auto">
                                    {isUpdatingProfile ? 'Güncelleniyor...' : <><Save className="h-4 w-4" /> Kaydet</>}
                                </Button>
                            </CardFooter>
                        </Card>
                    </TabsContent>

                    <TabsContent value="security" className="mt-0 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="grid gap-6">
                            {/* Email Section */}
                            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Mail className="h-5 w-5" />
                                        E-posta Adresi
                                    </CardTitle>
                                    <CardDescription>E-posta adresiniz güvenlik nedeniyle değiştirilemez.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="email">E-posta</Label>
                                        <Input
                                            id="email"
                                            type="email"
                                            value={user.email || ''}
                                            disabled
                                            className="bg-secondary/30"
                                        />
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Password Section */}
                            {shouldShowPasswordSettings && (
                                <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2">
                                            <Lock className="h-5 w-5" />
                                            Şifre Değiştir
                                        </CardTitle>
                                        <CardDescription>
                                            {user.twoFactorEnabled
                                                ? '2FA açık olduğu için şifre değiştirirken mevcut şifre yerine Authenticator kodu doğrulanır.'
                                                : '2FA kapalıysa şifrenizi değiştirmek için mevcut şifrenizi doğrulamanız gerekir.'}
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        {user.twoFactorEnabled ? (
                                            <div className="space-y-2">
                                                <Label htmlFor="password-change-mfa-code">Authenticator Kodu</Label>
                                                <Input
                                                    id="password-change-mfa-code"
                                                    inputMode="numeric"
                                                    placeholder="123456"
                                                    value={passwordChangeMfaCode}
                                                    onChange={(e) => setPasswordChangeMfaCode(sanitizeTotpCode(e.target.value))}
                                                    className="text-center tracking-[0.35em]"
                                                    maxLength={6}
                                                />
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                <Label htmlFor="current-password">Mevcut Şifre</Label>
                                                <Input
                                                    id="current-password"
                                                    type={showPassword ? 'text' : 'password'}
                                                    value={currentPassword}
                                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                                />
                                            </div>
                                        )}
                                        <div className="space-y-2">
                                            <Label htmlFor="new-password">Yeni Şifre</Label>
                                            <div className="relative">
                                                <Input
                                                    id="new-password"
                                                    type={showPassword ? 'text' : 'password'}
                                                    value={newPassword}
                                                    onChange={(e) => setNewPassword(e.target.value)}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowPassword(!showPassword)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                                >
                                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </button>
                                            </div>
                                            <p
                                                className={`text-xs ${
                                                    newPasswordStatus.tone === 'error'
                                                        ? 'text-amber-400'
                                                        : newPasswordStatus.tone === 'success'
                                                            ? 'text-emerald-400'
                                                            : 'text-muted-foreground'
                                                }`}
                                            >
                                                {newPasswordStatus.message}
                                            </p>
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="confirm-password">Şifre Tekrar</Label>
                                            <Input
                                                id="confirm-password"
                                                type={showPassword ? 'text' : 'password'}
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                            />
                                        </div>
                                        {!user.twoFactorEnabled && (
                                            <div className="rounded-lg border border-dashed border-border/60 bg-background/30 p-4 text-sm text-muted-foreground">
                                                Mevcut şifrenizi hatırlamıyorsanız e-posta adresinize şifre sıfırlama bağlantısı gönderebilirsiniz. O bağlantı açılınca yeni şifre ekranı gelir ve eski şifre istenmez.
                                            </div>
                                        )}
                                    </CardContent>
                                    <CardFooter className="flex-col gap-3 border-t border-border/50 pt-6 sm:flex-row">
                                        {!user.twoFactorEnabled && (
                                            <Button
                                                variant="outline"
                                                onClick={handleSendPasswordRecoveryLink}
                                                disabled={isSendingRecoveryLink || isUpdatingPassword}
                                                className="w-full sm:w-auto"
                                            >
                                                {isSendingRecoveryLink ? 'Gönderiliyor...' : 'Şifremi Unuttum'}
                                            </Button>
                                        )}
                                        <Button onClick={handleUpdatePassword} disabled={isUpdatingPassword} className="w-full gap-2 sm:ml-auto sm:w-auto">
                                            {isUpdatingPassword ? 'Güncelleniyor...' : 'Şifreyi Kaydet'}
                                        </Button>
                                    </CardFooter>
                                </Card>
                            )}
                            {/* Two-Factor Authentication Section */}
                            <Card className="border-border/50 bg-card/50 backdrop-blur-sm border-primary/20">
                                <CardHeader>
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="space-y-1">
                                            <CardTitle className="flex items-center gap-2">
                                                <ShieldCheck className="h-5 w-5 text-primary" />
                                                İki Faktörlü Doğrulama (2FA)
                                            </CardTitle>
                                            <CardDescription>
                                                Google Authenticator uyumlu TOTP kodları ile hesabınızı koruyun.
                                            </CardDescription>
                                        </div>
                                        <Badge className="self-start sm:self-auto" variant={user.twoFactorEnabled ? 'default' : 'secondary'}>
                                            {user.twoFactorEnabled ? 'Etkin' : 'Kapalı'}
                                        </Badge>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="rounded-lg border border-primary/10 bg-primary/5 p-4">
                                        <p className="text-sm text-primary/90">
                                            2FA etkin olduğunda giriş şifreniz doğru olsa bile Google Authenticator uygulamasındaki 6 haneli kod olmadan hesabınıza erişilemez.
                                        </p>
                                    </div>

                                    {activeTotpFactor ? (
                                        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="space-y-1">
                                                    <p className="flex items-center gap-2 text-sm font-medium">
                                                        <Smartphone className="h-4 w-4 text-primary" />
                                                        ToonParrot
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {user.email || activeTotpFactor.friendlyName || 'Google Authenticator'}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        Bu faktör doğrulanmış durumda. 2FA'yı kapatmak için yeni bir 6 haneli kod girmeniz gerekir.
                                                    </p>
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    className="w-full gap-2 sm:w-auto"
                                                    onClick={() => {
                                                        setDisableCode('');
                                                        setDisableDialogOpen(true);
                                                    }}
                                                >
                                                    <ShieldOff className="h-4 w-4" />
                                                    2FA'yı Kapat
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
                                            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-muted-foreground">
                                                Authenticator uygulamasında bu kayıt `ToonParrot` olarak görünecek ve hesap etiketi olarak `{user.email || 'e-posta adresiniz'}` kullanılacak.
                                            </div>
                                            <Button
                                                type="button"
                                                className="w-full gap-2 sm:w-auto"
                                                onClick={handleStartTwoFactorSetup}
                                                disabled={isTwoFactorBusy || Boolean(pendingEnrollment)}
                                            >
                                                {isTwoFactorBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                                                Google Authenticator Kur
                                            </Button>

                                            {pendingEnrollment && (
                                                <div className="space-y-5 rounded-2xl border border-primary/20 bg-background/60 p-5">
                                                    <div className="space-y-1">
                                                        <p className="text-base font-semibold">Google Authenticator Kurulumu</p>
                                                        <p className="text-sm text-muted-foreground">
                                                            QR kodu Google Authenticator ile tarayın. Tarayamıyorsanız alttaki gizli anahtarı manuel girin ve ardından 6 haneli kodu doğrulayın.
                                                        </p>
                                                    </div>

                                                    {qrCodeDataUrl && (
                                                        <div className="flex flex-col items-center gap-3">
                                                            <div className="select-none rounded-2xl bg-white p-4 shadow-xl" data-allow-image-interaction="true">
                                                                <img
                                                                    src={qrCodeDataUrl}
                                                                    alt="Google Authenticator QR"
                                                                    className="h-52 w-52"
                                                                    data-allow-image-interaction="true"
                                                                />
                                                            </div>
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                className="w-full border-white/15 sm:w-auto"
                                                                onClick={openQrInNewTab}
                                                            >
                                                                QR&apos;ı Yeni Sekmede Aç
                                                            </Button>
                                                        </div>
                                                    )}

                                                    <div className="space-y-2">
                                                        <Label htmlFor="totp-secret">Kurulum Anahtarı</Label>
                                                        <div className="flex flex-col gap-2 sm:flex-row">
                                                            <Input
                                                                id="totp-secret"
                                                                value={pendingEnrollment.secret || ''}
                                                                readOnly
                                                                className="font-mono tracking-[0.2em]"
                                                            />
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                className="w-full sm:w-auto"
                                                                onClick={async () => {
                                                                    if (!pendingEnrollment.secret) {
                                                                        return;
                                                                    }

                                                                    await navigator.clipboard.writeText(pendingEnrollment.secret);
                                                                    toast.success('Kurulum anahtarı kopyalandı');
                                                                }}
                                                            >
                                                                <Copy className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </div>

                                                    <div className="space-y-2">
                                                        <Label htmlFor="setup-code">Authenticator Kodu</Label>
                                                        <Input
                                                            id="setup-code"
                                                            inputMode="numeric"
                                                            placeholder="123456"
                                                            value={setupCode}
                                                            onChange={(e) => setSetupCode(sanitizeTotpCode(e.target.value))}
                                                            className="text-center text-lg tracking-[0.35em]"
                                                            maxLength={6}
                                                        />
                                                    </div>

                                                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                                                        <Button className="w-full sm:w-auto" type="button" variant="ghost" onClick={() => void closeSetupDialog()} disabled={isTwoFactorBusy}>
                                                            Vazgeç
                                                        </Button>
                                                        <Button className="w-full sm:w-auto" type="button" onClick={handleVerifyTwoFactorSetup} disabled={isTwoFactorBusy || setupCode.length !== 6}>
                                                            {isTwoFactorBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Doğrula ve Etkinleştir'}
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <Alert>
                                        <TriangleAlert className="h-4 w-4" />
                                        <AlertTitle>Önemli</AlertTitle>
                                        <AlertDescription>
                                            Şifre sıfırlama bağlantısı yalnızca şifreyi yeniler. Google Authenticator açıksa sonraki girişte yine TOTP kodu gerekir.
                                        </AlertDescription>
                                    </Alert>
                                </CardContent>
                            </Card>

                            <Card className="border-border/50 bg-card/50 backdrop-blur-sm border-blue-500/20">
                                <CardHeader>
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="space-y-1">
                                            <CardTitle className="flex items-center gap-2">
                                                <WifiOff className="h-5 w-5 text-blue-400" />
                                                Çevrimdışı Mod
                                            </CardTitle>
                                            <CardDescription>
                                                Açıkken internetin olsa bile site çevrimdışı gibi davranır ve öncelik yalnızca indirilen içeriklere verilir.
                                            </CardDescription>
                                        </div>
                                        <Switch
                                            className="self-start sm:self-auto"
                                            checked={offlinePreferences.forceOfflineMode}
                                            onCheckedChange={(checked) => {
                                                updateOfflinePreferences({ forceOfflineMode: checked });
                                                toast.success(checked ? 'Çevrimdışı mod açıldı' : 'Çevrimdışı mod kapatıldı');
                                            }}
                                        />
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="rounded-lg border border-blue-500/15 bg-blue-500/5 p-4 text-sm text-blue-100/90">
                                        Bu modda ana sayfa, seri sayfaları ve okuyucu indirilen içeriklere göre çalışır. Yeni yorum, takip, favori ve benzeri online işlemler pasif olur.
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    <TabsContent value="notifications" className="mt-0 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Bell className="h-5 w-5" />
                                    Bildirim Tercihleri
                                </CardTitle>
                                <CardDescription>Hangi durumlarda bildirim almak istediğinizi seçin.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                    <div className="flex min-w-0 flex-col space-y-1">
                                        <Label htmlFor="new-chapter">Yeni Bölüm Bildirimleri</Label>
                                        <p className="text-sm text-muted-foreground">Takip ettiğiniz mangalara yeni bölüm eklendiğinde haber ver.</p>
                                    </div>
                                    <Switch
                                        id="new-chapter"
                                        checked={prefs.notifications.new_chapter}
                                        onCheckedChange={(checked) => handleUpdatePreferences({
                                            ...prefs,
                                            notifications: { ...prefs.notifications, new_chapter: checked }
                                        }, 'Bildirim tercihleri güncellendi')}
                                        disabled={isUpdatingPrefs}
                                    />
                                </div>
                                <div className="flex flex-col gap-3 border-t border-border/50 pt-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                    <div className="flex min-w-0 flex-col space-y-1">
                                        <Label htmlFor="replies">Yanıt Bildirimleri</Label>
                                        <p className="text-sm text-muted-foreground">Yorumlarınıza yanıt geldiğinde haber ver.</p>
                                    </div>
                                    <Switch
                                        id="replies"
                                        checked={prefs.notifications.replies}
                                        onCheckedChange={(checked) => handleUpdatePreferences({
                                            ...prefs,
                                            notifications: { ...prefs.notifications, replies: checked }
                                        }, 'Bildirim tercihleri güncellendi')}
                                        disabled={isUpdatingPrefs}
                                    />
                                </div>
                                <div className="flex flex-col gap-3 border-t border-border/50 pt-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                    <div className="flex min-w-0 flex-col space-y-1">
                                        <Label htmlFor="likes">Beğeni Bildirimleri</Label>
                                        <p className="text-sm text-muted-foreground">Yorumlarınız beğenildiğinde haber ver.</p>
                                    </div>
                                    <Switch
                                        id="likes"
                                        checked={prefs.notifications.likes}
                                        onCheckedChange={(checked) => handleUpdatePreferences({
                                            ...prefs,
                                            notifications: { ...prefs.notifications, likes: checked }
                                        }, 'Bildirim tercihleri güncellendi')}
                                        disabled={isUpdatingPrefs}
                                    />
                                </div>
                                <div className="flex flex-col gap-3 border-t border-border/50 pt-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                    <div className="flex min-w-0 flex-col space-y-1">
                                        <Label htmlFor="follows">Takip Bildirimleri</Label>
                                        <p className="text-sm text-muted-foreground">Biri sizi takip ettiğinde haber ver.</p>
                                    </div>
                                    <Switch
                                        id="follows"
                                        checked={prefs.notifications.follows}
                                        onCheckedChange={(checked) => handleUpdatePreferences({
                                            ...prefs,
                                            notifications: { ...prefs.notifications, follows: checked }
                                        }, 'Bildirim tercihleri güncellendi')}
                                        disabled={isUpdatingPrefs}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                    <TabsContent value="privacy" className="mt-0 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <EyeOff className="h-5 w-5" />
                                    Gizlilik Ayarları
                                </CardTitle>
                                <CardDescription>Profildeki her bölüm için görünürlük seviyesini ayrı ayrı belirleyin.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {renderPrivacySelector(
                                    'visibility',
                                    'Profil Görünürlüğü',
                                    'Profilinizi genel olarak kimler görebilir? Bu ana kilittir.'
                                )}
                                {renderPrivacySelector(
                                    'reading_history_visibility',
                                    'Okuma Geçmişi',
                                    'Heatmap ve son okunan seriler bloğunu kimler görebilir?'
                                )}
                                {renderPrivacySelector(
                                    'comments_visibility',
                                    'Son Yorumlar',
                                    'Profilinizdeki yorum sekmesini ve son yorumlarınızı kimler görebilir?'
                                )}
                                {renderPrivacySelector(
                                    'reading_lists_visibility',
                                    'Okuma Listeleri',
                                    'Profilinizdeki okuma listelerini kimler görebilir?'
                                )}
                                {renderPrivacySelector(
                                    'tier_lists_visibility',
                                    'Tier Listeleri',
                                    'Profilinizdeki tier listelerini kimler görebilir?'
                                )}
                                {renderPrivacySelector(
                                    'followed_manga_visibility',
                                    'Takip / Favori İçerikler',
                                    'Takip ettiğiniz serileri kimler görebilir?'
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                    <TabsContent value="sync" className="mt-0 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="space-y-6">
                            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <RefreshCcw className="h-5 w-5" />
                                        Harici Senkron
                                    </CardTitle>
                                    <CardDescription>MyAnimeList ve AniList hesaplarınızı bağlayıp hangi verilerin dış listeye yazılacağını seçin.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="space-y-1">
                                            <Label htmlFor="external-auto-sync">Otomatik senkron</Label>
                                            <p className="text-sm text-muted-foreground">Okuma, puan, kategori ve favori değişikliklerini desteklenen sağlayıcılara otomatik gönder.</p>
                                        </div>
                                        <Switch
                                            id="external-auto-sync"
                                            checked={normalizedExternalPrefs.global.autoSync}
                                            onCheckedChange={(checked) => void handleUpdatePreferences({
                                                ...prefs,
                                                externalSync: {
                                                    ...prefs.externalSync,
                                                    global: {
                                                        ...prefs.externalSync.global,
                                                        autoSync: checked,
                                                    },
                                                },
                                            }, checked ? 'Otomatik senkron açıldı' : 'Otomatik senkron kapatıldı')}
                                            disabled={isUpdatingPrefs}
                                        />
                                    </div>

                                </CardContent>
                            </Card>

                            {isExternalStatusesLoading ? (
                                <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                                    <CardContent className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Harici bağlantılar yükleniyor...
                                    </CardContent>
                                </Card>
                            ) : (
                                <>
                                    {renderExternalProviderCard('myanimelist', 'MyAnimeList', 'Manga puanı, durum, bölüm ilerlemesi ve tarih alanlarını senkronlar.')}
                                    {renderExternalProviderCard('anilist', 'AniList', 'Manga puanı, durum, bölüm ilerlemesi, tarih ve favori bilgisini senkronlar.')}
                                </>
                            )}
                        </div>
                    </TabsContent>
                    <TabsContent value="devices" className="mt-0 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                            <CardHeader>
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="space-y-1">
                                        <CardTitle className="flex items-center gap-2">
                                            <Monitor className="h-5 w-5" />
                                            Aktif Oturumlar
                                        </CardTitle>
                                        <CardDescription>Hesabınıza giriş yapılmış tüm cihazları görün ve yönetin.</CardDescription>
                                    </div>
                                    {sessions.filter((s) => !s.isCurrent).length > 0 && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300 sm:w-auto"
                                            onClick={handleRevokeAllOthers}
                                            disabled={isRevokingAll}
                                        >
                                            {isRevokingAll ? (
                                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Kapatılıyor...</>
                                            ) : (
                                                <><LogOut className="mr-2 h-4 w-4" />Diğer Tüm Oturumları Kapat</>
                                            )}
                                        </Button>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {!isOnline ? (
                                    <Alert className="border-amber-500/20 bg-amber-500/10">
                                        <WifiOff className="h-4 w-4 text-amber-200" />
                                        <AlertTitle>Çevrimdışısınız</AlertTitle>
                                        <AlertDescription>
                                            Cihazlar ve aktif oturum yönetimi internet bağlantısı gerektirir. Çevrimiçi olduğunuzda bu liste tekrar yüklenir.
                                        </AlertDescription>
                                    </Alert>
                                ) : isSessionsLoading ? (
                                    <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Oturumlar yükleniyor...
                                    </div>
                                ) : sessions.length > 0 ? (
                                    sessions.map((session) => (
                                        <div
                                            key={session.id}
                                            className={`rounded-xl border p-4 transition-colors ${
                                                session.isCurrent
                                                    ? 'border-emerald-500/30 bg-emerald-500/5'
                                                    : 'border-border/60 bg-background/40 hover:bg-secondary/20'
                                            }`}
                                        >
                                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="flex items-start gap-4">
                                                    <div className={`mt-0.5 rounded-lg p-2.5 ${
                                                        session.isCurrent
                                                            ? 'bg-emerald-500/15 text-emerald-400'
                                                            : 'bg-secondary/60 text-muted-foreground'
                                                    }`}>
                                                        {getDeviceIcon(session.deviceType)}
                                                    </div>
                                                    <div className="min-w-0 space-y-1.5">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <p className="font-semibold">
                                                                {session.browser}{session.os && session.os !== 'Unknown' ? ` · ${session.os}` : ''}
                                                            </p>
                                                            {session.isCurrent && (
                                                                <Badge className="gap-1 border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10">
                                                                    Bu Cihaz
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                                            <span className="flex items-center gap-1.5">
                                                                <Globe className="h-3.5 w-3.5" />
                                                                {formatSessionLocation(session)}
                                                            </span>
                                                            <span className="flex items-center gap-1.5">
                                                                <Clock className="h-3.5 w-3.5" />
                                                                {formatSessionTime(session.lastActiveAt)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                {!session.isCurrent && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="w-full border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300 sm:w-auto"
                                                        disabled={revokingSessionId === session.id}
                                                        onClick={() => handleRevokeSession(session.id)}
                                                    >
                                                        {revokingSessionId === session.id ? (
                                                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Kapatılıyor...</>
                                                        ) : (
                                                            <><LogOut className="mr-2 h-4 w-4" />Çıkış Yap</>
                                                        )}
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="rounded-xl border border-dashed border-border/60 bg-background/20 py-12 text-center">
                                        <Monitor className="mx-auto mb-4 h-10 w-10 text-muted-foreground/60" />
                                        <p className="font-medium">Aktif oturum bulunamadı</p>
                                        <p className="mt-1 text-sm text-muted-foreground">Oturum verileri bir sonraki girişte kaydedilecek.</p>
                                        <Button variant="outline" size="sm" className="mt-4" onClick={() => void loadSessions()} disabled={isSessionsLoading}>
                                            Yenile
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                    <TabsContent value="preferences" className="mt-0 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <SlidersHorizontal className="h-5 w-5" />
                                    Diğer Tercihler
                                </CardTitle>
                                <CardDescription>Üst çubuk, yorum görünümü ve genel kullanım davranışlarını buradan belirleyebilirsiniz.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                    <div className="flex min-w-0 flex-col space-y-1">
                                        <Label htmlFor="manga-hover-preview">Manga Önizleme Kartını Göster</Label>
                                        <p className="text-sm text-muted-foreground">Manga kartına hover yapınca veya odaklanınca çıkan detay preview kartını göster.</p>
                                    </div>
                                    <Switch
                                        id="manga-hover-preview"
                                        checked={prefs.appearance?.manga_hover_preview ?? false}
                                        onCheckedChange={(checked) => handleUpdatePreferences({
                                            ...prefs,
                                            appearance: { ...prefs.appearance, manga_hover_preview: checked }
                                        }, 'Tercihler güncellendi')}
                                        disabled={isUpdatingPrefs}
                                    />
                                </div>
                                <div className="flex flex-col gap-3 border-t border-border/50 pt-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                    <div className="flex min-w-0 flex-col space-y-1">
                                        <Label htmlFor="show-header-offline-toggle">Üst Çubukta Çevrimdışı Mod Butonunu Göster</Label>
                                        <p className="text-sm text-muted-foreground">Header içindeki hızlı çevrimdışı mod düğmesini görünür tut.</p>
                                    </div>
                                    <Switch
                                        id="show-header-offline-toggle"
                                        checked={prefs.appearance?.show_header_offline_toggle ?? true}
                                        onCheckedChange={(checked) => handleUpdatePreferences({
                                            ...prefs,
                                            appearance: { ...prefs.appearance, show_header_offline_toggle: checked }
                                        }, 'Tercihler güncellendi')}
                                        disabled={isUpdatingPrefs}
                                    />
                                </div>
                                <div className="flex flex-col gap-3 border-t border-border/50 pt-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                    <div className="flex min-w-0 flex-col space-y-1">
                                        <Label htmlFor="show-chapter-card-images">Seri Sayfasında Bölüm Görsellerini Göster</Label>
                                        <p className="text-sm text-muted-foreground">Bölüm listesinde kart görsellerini yükler ve gösterir. Performans için varsayılan olarak kapalıdır.</p>
                                    </div>
                                    <Switch
                                        id="show-chapter-card-images"
                                        checked={prefs.appearance?.show_chapter_card_images ?? false}
                                        onCheckedChange={(checked) => handleUpdatePreferences({
                                            ...prefs,
                                            appearance: { ...prefs.appearance, show_chapter_card_images: checked }
                                        }, 'Tercihler güncellendi')}
                                        disabled={isUpdatingPrefs}
                                    />
                                </div>
                                <div className="flex flex-col gap-3 border-t border-border/50 pt-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                    <div className="flex min-w-0 flex-col space-y-1">
                                        <Label htmlFor="auto-show-replies">Yanıtları Otomatik Aç</Label>
                                        <p className="text-sm text-muted-foreground">Yorum başlıklarının altındaki yanıtlar varsayılan olarak açık gelsin.</p>
                                    </div>
                                    <Switch
                                        id="auto-show-replies"
                                        checked={prefs.comments?.auto_show_replies ?? false}
                                        onCheckedChange={(checked) => handleUpdatePreferences({
                                            ...prefs,
                                            comments: { ...prefs.comments, auto_show_replies: checked }
                                        }, 'Tercihler güncellendi')}
                                        disabled={isUpdatingPrefs}
                                    />
                                </div>
                                <div className="flex flex-col gap-3 border-t border-border/50 pt-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                    <div className="flex min-w-0 flex-col space-y-1">
                                        <Label htmlFor="auto-show-media">Yorum Medyalarını Otomatik Aç</Label>
                                        <p className="text-sm text-muted-foreground">Yorumlardaki görselleri butona basmadan direkt göster.</p>
                                    </div>
                                    <Switch
                                        id="auto-show-media"
                                        checked={prefs.comments?.auto_show_media ?? false}
                                        onCheckedChange={(checked) => handleUpdatePreferences({
                                            ...prefs,
                                            comments: { ...prefs.comments, auto_show_media: checked }
                                        }, 'Tercihler güncellendi')}
                                        disabled={isUpdatingPrefs}
                                    />
                                </div>
                                <div className="flex flex-col gap-3 border-t border-border/50 pt-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                    <div className="flex min-w-0 flex-col space-y-1">
                                        <Label htmlFor="auto-show-gifs">Yorum GIF'lerini Otomatik Aç</Label>
                                        <p className="text-sm text-muted-foreground">GIF içeren yorumları varsayılan olarak açık göster.</p>
                                    </div>
                                    <Switch
                                        id="auto-show-gifs"
                                        checked={prefs.comments?.auto_show_gifs ?? false}
                                        onCheckedChange={(checked) => handleUpdatePreferences({
                                            ...prefs,
                                            comments: { ...prefs.comments, auto_show_gifs: checked }
                                        }, 'Tercihler güncellendi')}
                                        disabled={isUpdatingPrefs}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                    <TabsContent value="blocked" className="mt-0 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <ShieldAlert className="h-5 w-5 text-red-500" />
                                    Engellenen Kullanıcılar
                                </CardTitle>
                                <CardDescription>Kimi engellediğinizi görebilir ve isterseniz engeli kaldırabilirsiniz.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {isBlockedUsersLoading ? (
                                    <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Engellenenler yukleniyor...
                                    </div>
                                ) : blockedUsers.length > 0 ? (
                                    blockedUsers.map((blockedUser) => (
                                        <div key={blockedUser.id} className="flex flex-col gap-4 rounded-xl border border-border/60 bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="flex items-center gap-3">
                                                <Avatar className="h-12 w-12 border border-border/60">
                                                    <AvatarImage src={blockedUser.avatar} />
                                                    <AvatarFallback>{blockedUser.username?.slice(0, 2).toUpperCase() || '??'}</AvatarFallback>
                                                </Avatar>
                                                <div>
                                                    <p className="font-semibold">{blockedUser.username}</p>
                                                    <p className="text-sm text-muted-foreground">Bu kullanıcı profilinizi ve yorumlarınızı göremez.</p>
                                                </div>
                                            </div>

                                            <Button
                                                variant="outline"
                                                className="w-full border-red-500/40 text-red-500 hover:bg-red-500/10 hover:text-red-400 sm:w-auto"
                                                disabled={unblockingUserId === blockedUser.id}
                                                onClick={() => handleUnblockUser(blockedUser.id)}
                                            >
                                                {unblockingUserId === blockedUser.id ? (
                                                    <>
                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                        Kaldiriliyor...
                                                    </>
                                                ) : 'Engeli Kaldir'}
                                            </Button>
                                        </div>
                                    ))
                                ) : (
                                    <div className="rounded-xl border border-dashed border-border/60 bg-background/20 py-12 text-center">
                                        <ShieldAlert className="mx-auto mb-4 h-10 w-10 text-muted-foreground/60" />
                                        <p className="font-medium">Engellenen kullanıcı yok</p>
                                        <p className="mt-1 text-sm text-muted-foreground">Engellediğiniz kişiler burada listelenecek.</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>

                <Dialog
                    open={disableDialogOpen}
                    onOpenChange={(open) => {
                        setDisableDialogOpen(open);
                        if (!open) {
                            setDisableCode('');
                        }
                    }}
                >
                    <DialogContent className="max-w-md border-white/10 bg-[#0f0f10] text-white">
                        <DialogHeader>
                            <DialogTitle>2FA'yı Kapat</DialogTitle>
                            <DialogDescription>
                                Güvenlik gereği 2FA'yı kapatmadan önce authenticator uygulamanızdaki güncel 6 haneli kodu doğrulamanız gerekiyor.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-2">
                            <Label htmlFor="disable-code">Authenticator Kodu</Label>
                            <Input
                                id="disable-code"
                                inputMode="numeric"
                                placeholder="123456"
                                value={disableCode}
                                onChange={(e) => setDisableCode(sanitizeTotpCode(e.target.value))}
                                className="text-center text-lg tracking-[0.35em]"
                                maxLength={6}
                            />
                        </div>

                        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
                            <Button className="w-full sm:w-auto" type="button" variant="ghost" onClick={() => setDisableDialogOpen(false)} disabled={isTwoFactorBusy}>
                                İptal
                            </Button>
                            <Button className="w-full sm:w-auto" type="button" variant="destructive" onClick={handleDisableTwoFactor} disabled={isTwoFactorBusy || disableCode.length !== 6}>
                                {isTwoFactorBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : '2FA\'yı Kapat'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </main >
        </div >
    );
};

export default Settings;
