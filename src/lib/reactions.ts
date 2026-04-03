export type ReactionType = 'like' | 'dislike';

type ReactableEntity = {
    likes: number;
    dislikes: number;
    likedBy: string[];
    dislikedBy: string[];
};

const removeUserReaction = (userIds: string[], userId: string) => (
    userIds.filter((currentUserId) => currentUserId !== userId)
);

const addUserReaction = (userIds: string[], userId: string) => (
    userIds.includes(userId) ? userIds : [...userIds, userId]
);

export const hasReaction = (
    entity: Pick<ReactableEntity, 'likedBy' | 'dislikedBy'>,
    userId: string | undefined,
    reactionType: ReactionType,
) => {
    if (!userId) {
        return false;
    }

    return reactionType === 'like'
        ? entity.likedBy.includes(userId)
        : entity.dislikedBy.includes(userId);
};

export const getReactionScore = (
    entity: Pick<ReactableEntity, 'likes' | 'dislikes'>,
) => entity.likes - entity.dislikes;

export const applyOptimisticReaction = <T extends ReactableEntity>(
    entity: T,
    userId: string,
    reactionType: ReactionType,
): T => {
    const wasLiked = entity.likedBy.includes(userId);
    const wasDisliked = entity.dislikedBy.includes(userId);

    let likes = entity.likes;
    let dislikes = entity.dislikes;
    let likedBy = entity.likedBy;
    let dislikedBy = entity.dislikedBy;

    if (reactionType === 'like') {
        if (wasLiked) {
            likes = Math.max(0, likes - 1);
            likedBy = removeUserReaction(likedBy, userId);
        } else {
            likes += 1;
            likedBy = addUserReaction(likedBy, userId);

            if (wasDisliked) {
                dislikes = Math.max(0, dislikes - 1);
                dislikedBy = removeUserReaction(dislikedBy, userId);
            }
        }
    } else if (wasDisliked) {
        dislikes = Math.max(0, dislikes - 1);
        dislikedBy = removeUserReaction(dislikedBy, userId);
    } else {
        dislikes += 1;
        dislikedBy = addUserReaction(dislikedBy, userId);

        if (wasLiked) {
            likes = Math.max(0, likes - 1);
            likedBy = removeUserReaction(likedBy, userId);
        }
    }

    return {
        ...entity,
        likes,
        dislikes,
        likedBy,
        dislikedBy,
    };
};
