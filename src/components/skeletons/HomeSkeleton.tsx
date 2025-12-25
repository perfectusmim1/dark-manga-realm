import { Skeleton } from "@/components/ui/skeleton";

const HomeSkeleton = () => {
    return (
        <div className="min-h-screen bg-background">
            <div className="container pb-12 pt-20">
                {/* Hero Section Skeleton */}
                <div className="relative overflow-hidden rounded-2xl bg-card/50 mb-10">
                    <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-center md:p-8">
                        {/* Cover Skeleton */}
                        <Skeleton className="h-64 w-44 shrink-0 rounded-xl md:h-80 md:w-56" />

                        {/* Info Skeleton */}
                        <div className="flex flex-1 flex-col gap-4">
                            <div className="flex flex-wrap gap-2">
                                <Skeleton className="h-6 w-16" />
                                <Skeleton className="h-6 w-24" />
                                <Skeleton className="h-6 w-12" />
                            </div>
                            <Skeleton className="h-10 w-3/4 max-w-md" />
                            <Skeleton className="h-4 w-32" />
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-full" />
                                <Skeleton className="h-4 w-full" />
                                <Skeleton className="h-4 w-2/3" />
                            </div>
                            <div className="flex gap-2">
                                <Skeleton className="h-6 w-16" />
                                <Skeleton className="h-6 w-16" />
                                <Skeleton className="h-6 w-16" />
                            </div>
                            <div className="flex flex-wrap gap-3 pt-2">
                                <Skeleton className="h-12 w-40 rounded-md" />
                                <Skeleton className="h-12 w-40 rounded-md" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Continue Reading Section Skeleton */}
                <div className="mt-10 mb-6 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-8 w-8 rounded-full" />
                        <Skeleton className="h-8 w-48" />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6 mb-10">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="aspect-[3/4] rounded-xl overflow-hidden">
                            <Skeleton className="h-full w-full" />
                        </div>
                    ))}
                </div>

                {/* Recently Updated Section Skeleton */}
                <div className="mt-10 mb-6 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-8 w-8 rounded-full" />
                        <Skeleton className="h-8 w-48" />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                    {Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} className="aspect-[3/4] rounded-xl overflow-hidden">
                            <Skeleton className="h-full w-full" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default HomeSkeleton;
