export const OPEN_PAGE_COMMENT_EVENT = 'toonparrot:open-page-comment';
export const PAGE_COMMENTS_UPDATED_EVENT = 'toonparrot:page-comments-updated';

export interface OpenPageCommentDetail {
    pageNumber: number;
}

export interface PageCommentsUpdatedDetail {
    mangaId: string;
    chapterId: string;
    pageNumber: number;
}

export const dispatchOpenPageComment = (detail: OpenPageCommentDetail) => {
    window.dispatchEvent(new CustomEvent<OpenPageCommentDetail>(OPEN_PAGE_COMMENT_EVENT, { detail }));
};

export const dispatchPageCommentsUpdated = (detail: PageCommentsUpdatedDetail) => {
    window.dispatchEvent(new CustomEvent<PageCommentsUpdatedDetail>(PAGE_COMMENTS_UPDATED_EVENT, { detail }));
};
