import { Skeleton } from "@/components/ui/skeleton";

const LibrarySkeleton = () => {
    return (
        <div className="min-h-screen bg-background">
            <div className="pt-20 container pb-12">
                <div className="mb-8">
                    <Skeleton className="h-10 w-48 mb-2" />
                    <Skeleton className="h-5 w-64" />
                </div>

                <div className="mb-6 flex gap-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-24" />
                    ))}
                </div>

                <div className="space-y-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
                            <Skeleton className="h-24 w-16 rounded-lg" />
                            <div className="flex-1">
                                <Skeleton className="h-6 w-48 mb-2" />
                                <Skeleton className="h-4 w-32 mb-2" />
                                <div className="flex gap-2">
                                    <Skeleton className="h-5 w-20" />
                                    <Skeleton className="h-5 w-16" />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Skeleton className="h-9 w-24" />
                                <Skeleton className="h-9 w-24" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default LibrarySkeleton;
