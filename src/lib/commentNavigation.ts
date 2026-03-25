const COMMENT_QUERY_PARAM = 'commentId';
const COMMENT_HASH_PREFIX = '#comment-';

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

    if (url.hash.startsWith(COMMENT_HASH_PREFIX)) {
        url.hash = '';
        changed = true;
    }

    if (changed) {
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
};
