const COMMENT_QUERY_PARAM = 'commentId';
const COMMENT_HASH_PREFIX = '#comment-';
const COMMENT_SCOPE_QUERY_PARAM = 'commentScope';
const COMMENT_PAGE_QUERY_PARAM = 'commentPage';

export const normalizeCommentNavigationLink = (link?: string | null): string | undefined => {
    if (!link) {
        return undefined;
    }

    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://toonparrot.local';
    const url = new URL(link, baseUrl);

    if (url.hash.startsWith(COMMENT_HASH_PREFIX)) {
        const commentId = decodeURIComponent(url.hash.slice(COMMENT_HASH_PREFIX.length));
        if (commentId) {
            url.searchParams.set(COMMENT_QUERY_PARAM, commentId);
        }
        url.hash = '';
    }

    return `${url.pathname}${url.search}${url.hash}`;
};

export const getTargetCommentIdFromLocation = (search: string, hash: string): string | null => {
    const params = new URLSearchParams(search);
    const commentId = params.get(COMMENT_QUERY_PARAM);
    if (commentId) {
        return commentId;
    }

    if (hash.startsWith(COMMENT_HASH_PREFIX)) {
        return decodeURIComponent(hash.slice(COMMENT_HASH_PREFIX.length));
    }

    return null;
};

export const getTargetCommentScopeFromLocation = (search: string): 'chapter' | 'page' | null => {
    const params = new URLSearchParams(search);
    const scope = params.get(COMMENT_SCOPE_QUERY_PARAM);

    if (scope === 'chapter' || scope === 'page') {
        return scope;
    }

    return null;
};

export const getTargetCommentPageNumberFromLocation = (search: string): number | null => {
    const params = new URLSearchParams(search);
    const value = Number.parseInt(params.get(COMMENT_PAGE_QUERY_PARAM) || '', 10);

    return Number.isFinite(value) && value > 0 ? value : null;
};

export const clearTargetCommentFromCurrentUrl = () => {
    if (typeof window === 'undefined') {
        return;
    }

    const url = new URL(window.location.href);
    let changed = false;

    if (url.searchParams.has(COMMENT_QUERY_PARAM)) {
        url.searchParams.delete(COMMENT_QUERY_PARAM);
        changed = true;
    }

    if (url.searchParams.has(COMMENT_SCOPE_QUERY_PARAM)) {
        url.searchParams.delete(COMMENT_SCOPE_QUERY_PARAM);
        changed = true;
    }

    if (url.searchParams.has(COMMENT_PAGE_QUERY_PARAM)) {
        url.searchParams.delete(COMMENT_PAGE_QUERY_PARAM);
        changed = true;
    }

    if (url.hash.startsWith(COMMENT_HASH_PREFIX)) {
        url.hash = '';
        changed = true;
    }

    if (changed) {
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
};

export const getLocationWithoutTargetComment = (
    pathname: string,
    search: string,
    hash: string,
): { pathname: string; search: string; hash: string } | null => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://toonparrot.local';
    const url = new URL(`${pathname}${search}${hash}`, baseUrl);
    let changed = false;

    if (url.searchParams.has(COMMENT_QUERY_PARAM)) {
        url.searchParams.delete(COMMENT_QUERY_PARAM);
        changed = true;
    }

    if (url.searchParams.has(COMMENT_SCOPE_QUERY_PARAM)) {
        url.searchParams.delete(COMMENT_SCOPE_QUERY_PARAM);
        changed = true;
    }

    if (url.searchParams.has(COMMENT_PAGE_QUERY_PARAM)) {
        url.searchParams.delete(COMMENT_PAGE_QUERY_PARAM);
        changed = true;
    }

    if (url.hash.startsWith(COMMENT_HASH_PREFIX)) {
        url.hash = '';
        changed = true;
    }

    if (!changed) {
        return null;
    }

    return {
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
    };
};
