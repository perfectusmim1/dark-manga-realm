type ModuleLoader = () => Promise<unknown>;

export const routeModuleLoaders = {
    Index: () => import('@/pages/Index'),
    TopTen: () => import('@/pages/TopTen'),
    Browse: () => import('@/pages/Browse'),
    MangaDetail: () => import('@/pages/MangaDetail'),
    Reader: () => import('@/pages/Reader'),
    Auth: () => import('@/pages/Auth'),
    Favorites: () => import('@/pages/Favorites'),
    History: () => import('@/pages/History'),
    LatestChapters: () => import('@/pages/LatestChapters'),
    Bookmarks: () => import('@/pages/Bookmarks'),
    Library: () => import('@/pages/Library'),
    Downloads: () => import('@/pages/Downloads'),
    Notifications: () => import('@/pages/Notifications'),
    Announcements: () => import('@/pages/Announcements'),
    ReadingLists: () => import('@/pages/ReadingLists'),
    ReadingTime: () => import('@/pages/ReadingTime'),
    ReadingTimeMangaDetail: () => import('@/pages/ReadingTimeMangaDetail'),
    ReadingListDetail: () => import('@/pages/ReadingListDetail'),
    SeriesRequests: () => import('@/pages/SeriesRequests'),
    Settings: () => import('@/pages/Settings'),
    Support: () => import('@/pages/support/Support'),
    NotFound: () => import('@/pages/NotFound'),
    Profile: () => import('@/pages/Profile'),
    Community: () => import('@/pages/Community'),
    ForumTopicDetail: () => import('@/pages/ForumTopicDetail'),
    TierLists: () => import('@/pages/TierLists'),
    TierListEditor: () => import('@/pages/TierListEditor'),
    TierListView: () => import('@/pages/TierListView'),
    CharacterDetail: () => import('@/pages/CharacterDetail'),
    AuthorDetail: () => import('@/pages/AuthorDetail'),
    ArtistDetail: () => import('@/pages/ArtistDetail'),
    CharactersBrowse: () => import('@/pages/CharactersBrowse'),
    AuthorsBrowse: () => import('@/pages/AuthorsBrowse'),
    ArtistsBrowse: () => import('@/pages/ArtistsBrowse'),
    AdminLogin: () => import('@/pages/admin/AdminLogin'),
    AdminLayout: () => import('@/pages/admin/AdminLayout'),
    AdminDashboard: () => import('@/pages/admin/AdminDashboard'),
    AdminMangaList: () => import('@/pages/admin/AdminMangaList'),
    AdminMangaEditor: () => import('@/pages/admin/AdminMangaEditor'),
    AdminComments: () => import('@/pages/admin/AdminComments'),
    AdminReviews: () => import('@/pages/admin/AdminReviews'),
    AdminUsers: () => import('@/pages/admin/AdminUsers'),
    AdminUserManagement: () => import('@/pages/admin/AdminUserManagement'),
    AdminScraper: () => import('@/pages/admin/AdminScraper'),
    AdminMetadataImport: () => import('@/pages/admin/AdminMetadataImport'),
    AdminChapterScraper: () => import('@/pages/admin/AdminChapterScraper'),
    AdminAutomation: () => import('@/pages/admin/AdminAutomation'),
    AdminEntities: () => import('@/pages/admin/AdminEntities'),
    AdminTags: () => import('@/pages/admin/AdminTags'),
    AdminAnnouncements: () => import('@/pages/admin/AdminAnnouncements'),
    AdminReports: () => import('@/pages/admin/AdminReports'),
    AdminSiteSettings: () => import('@/pages/admin/AdminSiteSettings'),
    AdminTickets: () => import('@/pages/admin/AdminTickets'),
    AdminSeriesRequests: () => import('@/pages/admin/AdminSeriesRequests'),
};

const prefetchedLoaders = new Set<ModuleLoader>();

const prefetchLoader = (loader?: ModuleLoader) => {
    if (!loader || prefetchedLoaders.has(loader)) {
        return;
    }

    prefetchedLoaders.add(loader);
    void loader().catch(() => {
        prefetchedLoaders.delete(loader);
    });
};

const ROUTE_PREFIX_LOADERS: Array<[RegExp, ModuleLoader]> = [
    [/^\/$/, routeModuleLoaders.Index],
    [/^\/browse(?:\/|$)/, routeModuleLoaders.Browse],
    [/^\/top-ten(?:\/|$)/, routeModuleLoaders.TopTen],
    [/^\/latest-chapters(?:\/|$)/, routeModuleLoaders.LatestChapters],
    [/^\/community\/topic\/[^/]+/, routeModuleLoaders.ForumTopicDetail],
    [/^\/community(?:\/|$)/, routeModuleLoaders.Community],
    [/^\/manga\/[^/]+\/chapter\/[^/]+/, routeModuleLoaders.Reader],
    [/^\/manga\/[^/]+/, routeModuleLoaders.MangaDetail],
    [/^\/favorites(?:\/|$)/, routeModuleLoaders.Favorites],
    [/^\/history(?:\/|$)/, routeModuleLoaders.History],
    [/^\/bookmarks(?:\/|$)/, routeModuleLoaders.Bookmarks],
    [/^\/library(?:\/|$)/, routeModuleLoaders.Library],
    [/^\/downloads(?:\/|$)/, routeModuleLoaders.Downloads],
    [/^\/notifications(?:\/|$)/, routeModuleLoaders.Notifications],
    [/^\/announcements(?:\/|$)/, routeModuleLoaders.Announcements],
    [/^\/reading-lists\/[^/]+/, routeModuleLoaders.ReadingListDetail],
    [/^\/reading-lists(?:\/|$)/, routeModuleLoaders.ReadingLists],
    [/^\/tier-lists\/create(?:\/|$)/, routeModuleLoaders.TierListEditor],
    [/^\/tier-lists\/[^/]+\/edit(?:\/|$)/, routeModuleLoaders.TierListEditor],
    [/^\/tier-lists\/[^/]+/, routeModuleLoaders.TierListView],
    [/^\/tier-lists(?:\/|$)/, routeModuleLoaders.TierLists],
    [/^\/reading-time\/manga\/[^/]+/, routeModuleLoaders.ReadingTimeMangaDetail],
    [/^\/reading-time(?:\/|$)/, routeModuleLoaders.ReadingTime],
    [/^\/series-requests(?:\/|$)/, routeModuleLoaders.SeriesRequests],
    [/^\/settings(?:\/|$)/, routeModuleLoaders.Settings],
    [/^\/support(?:\/|$)/, routeModuleLoaders.Support],
    [/^\/profile(?:\/|$)/, routeModuleLoaders.Profile],
    [/^\/characters(?:\/|$)/, routeModuleLoaders.CharactersBrowse],
    [/^\/character\/[^/]+/, routeModuleLoaders.CharacterDetail],
    [/^\/authors(?:\/|$)/, routeModuleLoaders.AuthorsBrowse],
    [/^\/author\/[^/]+/, routeModuleLoaders.AuthorDetail],
    [/^\/artists(?:\/|$)/, routeModuleLoaders.ArtistsBrowse],
    [/^\/artist\/[^/]+/, routeModuleLoaders.ArtistDetail],
    [/^\/auth(?:\/|$)/, routeModuleLoaders.Auth],
    [/^\/admin\/reports(?:\/|$)/, routeModuleLoaders.AdminReports],
    [/^\/admin(?:\/|$)/, routeModuleLoaders.AdminLayout],
];

export const prefetchRouteForPathname = (pathname: string) => {
    if (!pathname) {
        return;
    }

    const cleanPathname = pathname.split('?')[0].split('#')[0] || '/';
    for (const [pattern, loader] of ROUTE_PREFIX_LOADERS) {
        if (pattern.test(cleanPathname)) {
            prefetchLoader(loader);
            return;
        }
    }
};

export const prefetchPrimaryNavRoutes = () => {
    if (typeof navigator !== 'undefined') {
        const connection = (navigator as Navigator & {
            connection?: { saveData?: boolean; effectiveType?: string };
        }).connection;
        if (connection?.saveData || connection?.effectiveType === '2g') {
            return;
        }
    }

    prefetchLoader(routeModuleLoaders.Index);
    prefetchLoader(routeModuleLoaders.Browse);
    prefetchLoader(routeModuleLoaders.Community);
    prefetchLoader(routeModuleLoaders.TopTen);
    prefetchLoader(routeModuleLoaders.LatestChapters);
};
